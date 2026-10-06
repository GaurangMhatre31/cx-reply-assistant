import type {
  ChatMessage,
  GroundingStatus,
  KbCategory,
  ModelStatus,
  OrderFacts,
  ParsedDraft,
  RetrievedSnippet,
  WindowCheck,
} from './types.ts';

const MODEL_STATUSES: ModelStatus[] = ['answered', 'partial', 'cannot_answer', 'no_policy_needed'];

/** Confidence below this is treated as a request for human review. */
export const MIN_CONFIDENCE = 0.6;

/**
 * Parses the model's JSON. Tolerates markdown fences and stray prose around
 * the object; returns null if the shape is unusable (caller retries once).
 */
export function parseDraft(raw: string): ParsedDraft | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }

  const reply = typeof obj.reply === 'string' ? obj.reply.trim() : '';
  const status = MODEL_STATUSES.includes(obj.status as ModelStatus) ? (obj.status as ModelStatus) : null;
  if (!reply || !status) return null;

  const cited = Array.isArray(obj.cited_policies) ? obj.cited_policies : [];
  const confidence = typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
    ? Math.min(1, Math.max(0, obj.confidence))
    : null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null);

  return {
    reply,
    status,
    citedLabels: [...new Set(cited.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toUpperCase()))],
    confidence,
    missingInfo: str(obj.missing_info),
    needsHumanReason: str(obj.needs_human_reason),
  };
}

// ---------------------------------------------------------------------------
// Unverified numbers: every number in the reply must appear somewhere in what
// the model was given. A reply saying "within 10 days" when the policy says
// 7 is the most common, most damaging hallucination in CX — and it is cheap
// to detect deterministically.
// ---------------------------------------------------------------------------
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUMBER_PATTERN) ?? []).map((n) => n.replace(/,/g, '')));
}

export function findUnverifiedNumbers(reply: string, sources: string[]): string[] {
  const allowed = new Set<string>(['0', '1']);
  for (const s of sources) for (const n of numbersIn(s)) allowed.add(n);
  return [...numbersIn(reply)].filter((n) => !allowed.has(n));
}

// ---------------------------------------------------------------------------
// Promises made outside a policy window: if the system computed that the
// customer is OUTSIDE e.g. the refund window, a sentence that affirmatively
// offers a refund is blocked. Sentences containing a negation are skipped, so
// "we can't offer a refund" passes while "we'll process your refund" does not.
// ---------------------------------------------------------------------------
const ACTION_WORDS: Record<KbCategory, string> = {
  refunds: 'refund',
  returns: '(?:return|pick ?up)',
  cancellation: 'cancel',
  damaged_items: '(?:replace|replacement|refund)',
  shipping: '(?!)',
  general: '(?!)',
};

// A sentence containing any of these is treated as a refusal, not a promise.
// Heuristic by design: it can only let a sentence skip this one check; the
// prompt rules and the other checks still apply.
const NEGATION =
  /\b(not|never|unable|cannot|unfortunately|no longer|outside|beyond|expired|ineligible|not eligible)\b|n['’]t\b/i;

function promisePattern(action: string): RegExp {
  return new RegExp(
    [
      // "we'll process your refund", "I have initiated a full refund"
      `\\b(?:we|i)(?:'ll|'ve|\\s+will|\\s+can|\\s+have|\\s+shall|\\s+are\\s+happy\\s+to|\\s+would\\s+be\\s+happy\\s+to)\\s+(?:\\w+\\s+){0,3}?\\w*${action}`,
      // "you are eligible for a refund", "you'll receive a full refund"
      `\\byou(?:'re|\\s+are|'ll|\\s+will|\\s+can)\\s+(?:\\w+\\s+){0,3}?\\w*${action}`,
      // "your refund has been approved"
      `\\byour\\s+\\w*${action}\\w*\\s+(?:has\\s+been|is|will\\s+be)\\s+(?:approved|processed|initiated|confirmed|scheduled)`,
    ].join('|'),
    'i',
  );
}

// Reassurances that contain a negation word but are not refusals.
const REASSURANCE = /\b(?:don['’]t|do not|never) (?:you )?worry\b|\bno (?:worries|problem)\b|\bnot a problem\b|\bnot to worry\b/gi;

export function findOutOfWindowPromises(reply: string, checks: WindowCheck[]): WindowCheck[] {
  const sentences = reply
    .split(/(?<=[.!?\n])\s+/)
    .filter((s) => !NEGATION.test(s.replace(REASSURANCE, '')));
  return checks.filter((c) => c.within === false && sentences.some((s) => promisePattern(ACTION_WORDS[c.category]).test(s)));
}

const COMMITMENT = /\b(refund|replace|replacement|return|pick ?up|cancel|compensat|discount|voucher|coupon|free|credit)\w*/i;

// ---------------------------------------------------------------------------
// Final decision
// ---------------------------------------------------------------------------
export interface EvaluateInput {
  draft: ParsedDraft;
  snippets: RetrievedSnippet[];
  checks: WindowCheck[];
  facts: OrderFacts;
  history: ChatMessage[];
  injectionSuspected: boolean;
}

export interface Evaluation {
  status: Exclude<GroundingStatus, 'error'>;
  flags: string[];
  citedEntryIds: string[];
}

/**
 * Turns the model's self-reported answer into a status the agent can trust.
 * The model's own "status" and "confidence" are inputs, never the verdict:
 * code checks citations, numbers and eligibility independently, and any
 * failed check downgrades the draft to "needs_review". Every rule fails safe.
 */
export function evaluateDraft({ draft, snippets, checks, facts, history, injectionSuspected }: EvaluateInput): Evaluation {
  const flags: string[] = [];
  const byLabel = new Map(snippets.map((s) => [s.label, s]));

  const validLabels = draft.citedLabels.filter((l) => byLabel.has(l));
  if (validLabels.length < draft.citedLabels.length) flags.push('invalid_citation');
  const citedEntryIds = validLabels.map((l) => byLabel.get(l)!.id);

  if (snippets.length === 0) flags.push('no_knowledge_retrieved');
  // Nothing was retrieved, yet the model says it answered: whatever it asserted came from its own head.
  if (snippets.length === 0 && (draft.status === 'answered' || draft.status === 'partial')) flags.push('answered_without_policy');

  if (draft.status === 'answered' && snippets.length > 0 && validLabels.length === 0) flags.push('uncited_answer');
  if (draft.status === 'partial') flags.push('partial_answer');
  if (draft.status === 'cannot_answer') flags.push('model_could_not_answer');
  if (draft.status === 'no_policy_needed' && COMMITMENT.test(draft.reply)) flags.push('commitment_without_policy');

  const sources = [
    ...snippets.map((s) => s.content),
    JSON.stringify(facts),
    ...history.map((m) => m.body),
  ];
  if (findUnverifiedNumbers(draft.reply, sources).length > 0) flags.push('unverified_number');

  if (findOutOfWindowPromises(draft.reply, checks).length > 0) flags.push('promise_outside_policy_window');

  if (draft.confidence !== null && draft.confidence < MIN_CONFIDENCE) flags.push('low_confidence');
  if (injectionSuspected) flags.push('possible_prompt_injection');

  let status: Evaluation['status'];
  if (snippets.length === 0 && draft.status !== 'no_policy_needed') {
    status = 'no_knowledge';
  } else if (draft.status === 'cannot_answer') {
    status = 'needs_review';
  } else {
    const blocking = flags.filter((f) => f !== 'no_knowledge_retrieved');
    status = blocking.length > 0 ? 'needs_review' : 'grounded';
  }

  return { status, flags, citedEntryIds };
}
