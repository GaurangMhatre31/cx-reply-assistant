import type { GroundingStatus, KbCategory, Outcome } from './types';

const IST = 'Asia/Kolkata';

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: IST }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: IST }).format(new Date(iso));
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function daysSince(iso: string, now = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

export function money(amount: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export const CATEGORY_LABELS: Record<KbCategory, string> = {
  refunds: 'Refunds',
  returns: 'Returns',
  shipping: 'Shipping',
  cancellation: 'Cancellation',
  damaged_items: 'Damaged items',
  general: 'General',
};

export const STATUS_META: Record<GroundingStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'slate'; help: string }> = {
  grounded: {
    label: 'Grounded',
    tone: 'green',
    help: 'Every claim is backed by a cited policy and all automated checks passed. Still read it before sending.',
  },
  needs_review: {
    label: 'Needs review',
    tone: 'amber',
    help: 'An automated check failed (see below). Verify the draft against the policies before sending.',
  },
  no_knowledge: {
    label: 'No policy found',
    tone: 'red',
    help: 'The knowledge base has nothing relevant to this question. The draft only acknowledges it and defers. Check with your lead, or add a KB entry.',
  },
  error: {
    label: 'AI unavailable',
    tone: 'slate',
    help: 'The draft could not be generated. Reply manually or try again.',
  },
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  pending: 'Awaiting decision',
  approved: 'Sent as drafted',
  approved_with_edits: 'Sent with edits',
  discarded: 'Discarded',
  superseded: 'Regenerated',
  failed: 'Failed',
};

/** Plain-language explanations of guardrail flags, shown to the agent. */
export const FLAG_LABELS: Record<string, string> = {
  no_knowledge_retrieved: 'No knowledge-base entry matched this message.',
  answered_without_policy: 'The AI answered anyway, without any policy. Any facts in the draft are unverified; remove them before sending.',
  invalid_citation: 'The model cited a policy it was not given.',
  uncited_answer: 'The draft claims to answer but cites no policy.',
  partial_answer: 'The policies cover only part of the question.',
  model_could_not_answer: 'The model said the policies do not answer this.',
  commitment_without_policy: 'The draft mentions a refund, return or similar without citing a policy.',
  unverified_number: 'The draft contains a number that does not appear in the policies or order.',
  promise_outside_policy_window: 'The draft appears to promise something outside the policy time window.',
  low_confidence: 'The model reported low confidence.',
  possible_prompt_injection: 'The customer message looks like an attempt to instruct the AI.',
  llm_error: 'The AI provider failed or timed out.',
  unparseable_model_output: 'The model returned an unusable response.',
};
