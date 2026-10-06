import { describe, expect, it } from 'vitest';
import { callLlm, llmConfigFromEnv, LlmError, type LlmConfig } from '../supabase/functions/_shared/llm';

type Reply = { status: number; body: unknown } | 'hang';

/** A scripted fetch: returns queued replies in order and records each request. */
function fakeFetch(...replies: Reply[]) {
  const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, any> }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const next = replies.shift();
    if (next === undefined) throw new Error('fake fetch: nothing queued');
    if (next === 'hang') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, requests };
}

const ok = (content: string, model = 'gpt-4.1-mini-2025-04-14') => ({
  status: 200,
  body: { model, choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } },
});

const base = (fetchImpl: typeof fetch, overrides: Partial<LlmConfig> = {}): LlmConfig => ({
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'gpt-4.1-mini',
  fallbackModels: ['gpt-4o-mini'],
  maxRetries: 1,
  timeoutMs: 200,
  fetchImpl,
  ...overrides,
});

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('LLM client', () => {
  it('sends an OpenAI-shaped request and estimates cost from list prices', async () => {
    const f = fakeFetch(ok('{"reply":"x"}'));
    const result = await callLlm(messages, base(f.impl));

    expect(f.requests[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(f.requests[0].headers.Authorization).toBe('Bearer sk-test');
    expect(f.requests[0].body).toMatchObject({ model: 'gpt-4.1-mini', temperature: 0.2, max_completion_tokens: 700, response_format: { type: 'json_object' } });
    expect(f.requests[0].body).not.toHaveProperty('max_tokens');
    expect(f.requests[0].body).not.toHaveProperty('usage');
    // 1000 * 0.40/M + 200 * 1.60/M
    expect(result.costUsd).toBeCloseTo(0.00072, 8);
    expect(result).toMatchObject({ promptTokens: 1000, completionTokens: 200, model: 'gpt-4.1-mini-2025-04-14' });
  });

  it('omits temperature and allows reasoning tokens for reasoning models', async () => {
    const f = fakeFetch(ok('{}', 'gpt-5-mini'));
    await callLlm(messages, base(f.impl, { model: 'gpt-5-mini', fallbackModels: [] }));
    expect(f.requests[0].body).not.toHaveProperty('temperature');
    expect(f.requests[0].body).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 4000 });
  });

  it('sends an OpenRouter-shaped request and uses the reported cost', async () => {
    const f = fakeFetch({ status: 200, body: { model: 'anthropic/claude-haiku-4.5', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0123 } } });
    const result = await callLlm(messages, base(f.impl, { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' }));
    expect(f.requests[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(f.requests[0].headers['X-Title']).toBe('CX Reply Assistant');
    expect(f.requests[0].body).toMatchObject({ max_tokens: 700, usage: { include: true } });
    expect(result.costUsd).toBe(0.0123);
  });

  it('retries a 5xx on the same model, then succeeds', async () => {
    const f = fakeFetch({ status: 503, body: 'busy' }, ok('{}'));
    await callLlm(messages, base(f.impl));
    expect(f.requests.map((r) => r.body.model)).toEqual(['gpt-4.1-mini', 'gpt-4.1-mini']);
  });

  it('falls back to the next model when the primary is unknown (404), without retrying it', async () => {
    const f = fakeFetch({ status: 404, body: '{"error":{"code":"model_not_found"}}' }, ok('{}', 'gpt-4o-mini'));
    const result = await callLlm(messages, base(f.impl));
    expect(f.requests.map((r) => r.body.model)).toEqual(['gpt-4.1-mini', 'gpt-4o-mini']);
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('falls back after repeated timeouts', async () => {
    const f = fakeFetch('hang', 'hang', ok('{}', 'gpt-4o-mini'));
    const result = await callLlm(messages, base(f.impl));
    expect(f.requests).toHaveLength(3);
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('does not retry or fall back on a bad API key or an empty account', async () => {
    const bad = fakeFetch({ status: 401, body: '{"error":{"code":"invalid_api_key"}}' });
    await expect(callLlm(messages, base(bad.impl))).rejects.toThrow(/HTTP 401/);
    expect(bad.requests).toHaveLength(1);

    const broke = fakeFetch({ status: 429, body: '{"error":{"code":"insufficient_quota"}}' });
    await expect(callLlm(messages, base(broke.impl))).rejects.toBeInstanceOf(LlmError);
    expect(broke.requests).toHaveLength(1);
  });
});

describe('llmConfigFromEnv', () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];

  it('uses OpenAI when an OpenAI key is present', () => {
    const cfg = llmConfigFromEnv(env({ OPENAI_API_KEY: 'sk-1' }));
    expect(cfg).toMatchObject({ provider: 'openai', apiKey: 'sk-1', model: 'gpt-4.1-mini', fallbackModels: ['gpt-4o-mini'] });
  });

  it('uses OpenRouter when only an OpenRouter key is present, honouring legacy variable names', () => {
    const cfg = llmConfigFromEnv(env({ OPENROUTER_API_KEY: 'or-1', OPENROUTER_MODEL: 'x/y', OPENROUTER_FALLBACK_MODELS: 'a/b, c/d' }));
    expect(cfg).toMatchObject({ provider: 'openrouter', model: 'x/y', fallbackModels: ['a/b', 'c/d'] });
  });

  it('respects an explicit provider, model and pricing', () => {
    const cfg = llmConfigFromEnv(env({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENROUTER_API_KEY: 'o', LLM_MODEL: 'gpt-4o', LLM_PRICE_INPUT_PER_M: '1', LLM_PRICE_OUTPUT_PER_M: '2' }));
    expect(cfg).toMatchObject({ provider: 'openai', model: 'gpt-4o', pricing: { inputPerM: 1, outputPerM: 2 } });
  });

  it('fails clearly when no key is configured', () => {
    expect(() => llmConfigFromEnv(env({}))).toThrow(/OPENROUTER_API_KEY/);
    expect(() => llmConfigFromEnv(env({ LLM_PROVIDER: 'openai' }))).toThrow(/OPENAI_API_KEY/);
  });
});
