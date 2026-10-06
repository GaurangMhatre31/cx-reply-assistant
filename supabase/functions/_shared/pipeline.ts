import { computeOrderFacts, checkPolicyWindows } from './facts.ts';
import { evaluateDraft, parseDraft } from './guardrails.ts';
import { detectIntents, looksLikePromptInjection } from './intents.ts';
import { buildMessages, JSON_RETRY_MESSAGE, PROMPT_VERSION } from './prompt.ts';
import type { KbHit, ParsedDraft, PipelineDeps, PipelineResult, ReplyContext, RetrievedSnippet } from './types.ts';

export const DEFAULT_TOP_K = 3;

/**
 * The reply pipeline, independent of Supabase and of any HTTP framework:
 *
 *   1. detect intents          (deterministic, free)
 *   2. retrieve brand KB       (brand id comes from the server-side context)
 *   3. compute facts + checks  (deterministic: dates, policy windows)
 *   4. call the LLM            (JSON output, one repair retry)
 *   5. evaluate the draft      (deterministic guardrails decide the status)
 *
 * Never throws for model failures; returns status "error" so the caller can
 * log the attempt and the agent can fall back to replying manually.
 */
export async function runReplyPipeline(
  ctx: ReplyContext,
  deps: PipelineDeps,
  opts: { topK?: number } = {},
): Promise<PipelineResult> {
  const started = Date.now();
  const now = deps.now();
  const topK = opts.topK ?? DEFAULT_TOP_K;

  // 1. Intents from the message being answered.
  const intents = detectIntents(ctx.target.body);

  // 2. Retrieval. If the latest message alone matches nothing (a follow-up like
  //    "and what about the other bottle?"), retry with the previous customer
  //    message included for context.
  let hits: KbHit[] = await deps.searchKb({ brandId: ctx.brand.id, query: ctx.target.body, categories: intents, limit: topK });
  if (hits.length === 0) {
    const previous = [...ctx.history]
      .filter((m) => m.sender_type === 'customer' && m.id !== ctx.target.id && m.created_at <= ctx.target.created_at)
      .at(-1);
    if (previous) {
      const query = `${previous.body}\n${ctx.target.body}`;
      hits = await deps.searchKb({ brandId: ctx.brand.id, query, categories: detectIntents(query), limit: topK });
    }
  }
  const retrieved: RetrievedSnippet[] = hits.map((h, i) => ({ ...h, label: `P${i + 1}` }));

  // 3. Facts the model must not compute itself.
  const orderFacts = computeOrderFacts(ctx.order, now);
  const windowChecks = checkPolicyWindows(retrieved, orderFacts);
  const injectionSuspected = looksLikePromptInjection(ctx.target.body);

  const base = {
    retrieved,
    orderFacts,
    windowChecks,
    intents,
    promptVersion: PROMPT_VERSION,
  };

  // 4. Generate, with one repair attempt if the JSON is unusable.
  const messages = buildMessages(ctx, retrieved, orderFacts, windowChecks);
  let draft: ParsedDraft | null = null;
  let model: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd: number | null = null;

  try {
    let result = await deps.callLlm(messages);
    ({ model } = result);
    promptTokens += result.promptTokens ?? 0;
    completionTokens += result.completionTokens ?? 0;
    costUsd = result.costUsd;
    draft = parseDraft(result.content);

    if (!draft) {
      result = await deps.callLlm([...messages, { role: 'assistant', content: result.content }, JSON_RETRY_MESSAGE]);
      model = result.model;
      promptTokens += result.promptTokens ?? 0;
      completionTokens += result.completionTokens ?? 0;
      costUsd = costUsd === null && result.costUsd === null ? null : (costUsd ?? 0) + (result.costUsd ?? 0);
      draft = parseDraft(result.content);
    }
  } catch (err) {
    return {
      ...base,
      status: 'error',
      reply: '',
      confidence: null,
      citedEntryIds: [],
      missingInfo: null,
      needsHumanReason: null,
      flags: ['llm_error'],
      model,
      promptTokens: promptTokens || null,
      completionTokens: completionTokens || null,
      costUsd,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!draft) {
    return {
      ...base,
      status: 'error',
      reply: '',
      confidence: null,
      citedEntryIds: [],
      missingInfo: null,
      needsHumanReason: null,
      flags: ['unparseable_model_output'],
      model,
      promptTokens: promptTokens || null,
      completionTokens: completionTokens || null,
      costUsd,
      latencyMs: Date.now() - started,
      error: 'The model did not return a usable draft after a retry.',
    };
  }

  // 5. Deterministic guardrails make the final call.
  const evaluation = evaluateDraft({
    draft,
    snippets: retrieved,
    checks: windowChecks,
    facts: orderFacts,
    history: ctx.history,
    injectionSuspected,
  });

  return {
    ...base,
    status: evaluation.status,
    reply: draft.reply,
    confidence: draft.confidence,
    citedEntryIds: evaluation.citedEntryIds,
    missingInfo: draft.missingInfo,
    needsHumanReason: draft.needsHumanReason,
    flags: evaluation.flags,
    model,
    promptTokens: promptTokens || null,
    completionTokens: completionTokens || null,
    costUsd,
    latencyMs: Date.now() - started,
    error: null,
  };
}
