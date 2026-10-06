import type { LlmMessage, LlmResult } from './types.ts';

/**
 * LLM client for any OpenAI-compatible chat-completions API.
 * Supported providers: OpenAI directly, or OpenRouter (any model, one key).
 */
export type LlmProvider = 'openai' | 'openrouter';

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  /** Primary model, e.g. "gpt-4.1-mini" (OpenAI) or "anthropic/claude-haiku-4.5" (OpenRouter). */
  model: string;
  /** Tried in order when the primary model fails (outage, rate limit, unknown model). */
  fallbackModels?: string[];
  timeoutMs?: number;
  /** Retries per model on timeouts, 429s and 5xx. */
  maxRetries?: number;
  appUrl?: string;
  /** USD per 1M tokens; used to estimate cost when the provider doesn't report it (OpenAI). */
  pricing?: { inputPerM: number; outputPerM: number };
  fetchImpl?: typeof fetch;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** False for errors no other model can fix (bad API key, no credit). */
    readonly fallbackable = true,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: unknown;
}

const ENDPOINTS: Record<LlmProvider, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

const DEFAULTS: Record<LlmProvider, { model: string; fallbacks: string[] }> = {
  openai: { model: 'gpt-4.1-mini', fallbacks: ['gpt-4o-mini'] },
  openrouter: { model: 'anthropic/claude-haiku-4.5', fallbacks: ['openai/gpt-4.1-mini'] },
};

/**
 * OpenAI list prices in USD per 1M tokens (input, output), used only to
 * estimate cost for the logs. Verify against current pricing; override with
 * LLM_PRICE_INPUT_PER_M / LLM_PRICE_OUTPUT_PER_M.
 */
const OPENAI_PRICES: Record<string, [number, number]> = {
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4.1': [2, 8],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reasoning models (o-series, gpt-5) reject a custom temperature and spend tokens on hidden reasoning. */
function isReasoningModel(model: string): boolean {
  return /^(openai\/)?(o\d|gpt-5)/i.test(model);
}

function requestBody(messages: LlmMessage[], model: string, provider: LlmProvider) {
  const reasoning = isReasoningModel(model);
  return {
    model,
    messages,
    response_format: { type: 'json_object' },
    ...(reasoning ? { reasoning_effort: 'low' } : { temperature: 0.2 }),
    ...(provider === 'openai'
      ? { max_completion_tokens: reasoning ? 4000 : 700 }
      : { max_tokens: reasoning ? 4000 : 700, usage: { include: true } }),
  };
}

function estimateCost(cfg: LlmConfig, model: string, promptTokens: number | null, completionTokens: number | null): number | null {
  if (promptTokens === null || completionTokens === null) return null;
  const known = Object.entries(OPENAI_PRICES).find(([name]) => model === name || model.startsWith(`${name}-20`));
  const price = cfg.pricing ?? (known ? { inputPerM: known[1][0], outputPerM: known[1][1] } : null);
  if (!price) return null;
  return (promptTokens * price.inputPerM + completionTokens * price.outputPerM) / 1_000_000;
}

/** One model, with a hard timeout and retries on transient failures. */
async function callModel(messages: LlmMessage[], model: string, cfg: LlmConfig): Promise<LlmResult> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const maxRetries = cfg.maxRetries ?? 1;
  const timeoutMs = cfg.timeoutMs ?? 25_000;
  const label = cfg.provider === 'openai' ? 'OpenAI' : 'OpenRouter';
  let lastError: LlmError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(600 * 2 ** (attempt - 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(ENDPOINTS[cfg.provider], {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          ...(cfg.provider === 'openrouter'
            ? { 'HTTP-Referer': cfg.appUrl ?? 'https://github.com/cx-reply-assistant', 'X-Title': 'CX Reply Assistant' }
            : {}),
        },
        body: JSON.stringify(requestBody(messages, model, cfg.provider)),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const retryable = res.status === 429 && !/insufficient_quota/.test(body) ? true : res.status >= 500;
        // A bad key or an empty account won't be fixed by another model.
        const fallbackable = !(res.status === 401 || res.status === 403 || /insufficient_quota|invalid_api_key/.test(body));
        lastError = new LlmError(`${label} HTTP ${res.status} (${model}): ${body.slice(0, 300)}`, retryable, fallbackable);
        if (retryable) continue;
        throw lastError;
      }

      const data = (await res.json()) as ChatCompletionResponse;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        // Some providers return 200 with an error payload or an empty completion.
        lastError = new LlmError(`${label} returned no content (${model}): ${JSON.stringify(data?.error ?? data).slice(0, 300)}`, true);
        continue;
      }

      const promptTokens = data.usage?.prompt_tokens ?? null;
      const completionTokens = data.usage?.completion_tokens ?? null;
      const usedModel = typeof data.model === 'string' ? data.model : model;
      return {
        content,
        model: usedModel,
        promptTokens,
        completionTokens,
        costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : estimateCost(cfg, usedModel, promptTokens, completionTokens),
      };
    } catch (err) {
      if (err instanceof LlmError && !err.retryable) throw err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      lastError = err instanceof LlmError
        ? err
        : new LlmError(aborted ? `${label} timed out after ${timeoutMs} ms (${model})` : `${label} request failed (${model}): ${String(err)}`, true);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new LlmError(`${label} request failed (${model})`, true);
}

/**
 * One chat completion with reliability built in: per-attempt timeout, retry
 * with backoff on transient errors (never on 4xx), then the next fallback
 * model, so a single model outage or a mistyped model id doesn't take replies
 * down. Usage and cost are returned so every call can be logged.
 */
export async function callLlm(messages: LlmMessage[], cfg: LlmConfig): Promise<LlmResult> {
  const models = [...new Set([cfg.model, ...(cfg.fallbackModels ?? [])])];
  let lastError: unknown = null;
  for (const model of models) {
    try {
      return await callModel(messages, model, cfg);
    } catch (err) {
      lastError = err;
      if (err instanceof LlmError && !err.fallbackable) break;
    }
  }
  throw lastError ?? new LlmError('LLM request failed', true);
}

/**
 * Builds the config from environment variables (Deno.env.get or process.env).
 * Provider: LLM_PROVIDER, else "openai" when OPENAI_API_KEY is set, else "openrouter".
 */
export function llmConfigFromEnv(get: (name: string) => string | undefined): LlmConfig {
  const provider: LlmProvider =
    get('LLM_PROVIDER') === 'openai' || get('LLM_PROVIDER') === 'openrouter'
      ? (get('LLM_PROVIDER') as LlmProvider)
      : get('OPENAI_API_KEY')
        ? 'openai'
        : 'openrouter';

  const apiKey = provider === 'openai' ? get('OPENAI_API_KEY') : get('OPENROUTER_API_KEY');
  if (!apiKey) throw new Error(`Missing ${provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY'}`);

  const fallbacks = get('LLM_FALLBACK_MODELS') ?? get('OPENROUTER_FALLBACK_MODELS');
  const inputPerM = Number(get('LLM_PRICE_INPUT_PER_M'));
  const outputPerM = Number(get('LLM_PRICE_OUTPUT_PER_M'));

  return {
    provider,
    apiKey,
    model: get('LLM_MODEL') ?? (provider === 'openrouter' ? get('OPENROUTER_MODEL') : undefined) ?? DEFAULTS[provider].model,
    fallbackModels: fallbacks !== undefined ? fallbacks.split(',').map((m) => m.trim()).filter(Boolean) : DEFAULTS[provider].fallbacks,
    timeoutMs: Number(get('LLM_TIMEOUT_MS') ?? 25_000),
    appUrl: get('APP_URL'),
    pricing: inputPerM > 0 && outputPerM > 0 ? { inputPerM, outputPerM } : undefined,
  };
}
