// Shared types for the reply pipeline. Plain TypeScript with no runtime
// imports, so the same code runs in the Deno edge function and in Node tests.

export type KbCategory = 'returns' | 'refunds' | 'shipping' | 'cancellation' | 'damaged_items' | 'general';

export type GroundingStatus = 'grounded' | 'needs_review' | 'no_knowledge' | 'error';

export type ModelStatus = 'answered' | 'partial' | 'cannot_answer' | 'no_policy_needed';

export interface KbHit {
  id: string;
  category: KbCategory;
  title: string;
  content: string;
  score: number;
}

/** A KB hit as shown to the model and stored in the log, with a short label (P1, P2...). */
export interface RetrievedSnippet extends KbHit {
  label: string;
}

export interface ChatMessage {
  id: string;
  sender_type: 'customer' | 'agent' | 'system';
  body: string;
  created_at: string;
}

export interface OrderItem {
  name: string;
  qty: number;
  price: number;
}

export interface OrderInfo {
  order_number: string;
  status: 'placed' | 'dispatched' | 'delivered' | 'cancelled' | 'returned';
  items: OrderItem[];
  total_amount: number;
  currency: string;
  placed_at: string;
  delivered_at: string | null;
}

export interface ReplyContext {
  brand: { id: string; name: string; tone: string; support_email: string | null };
  customer: { name: string };
  order: OrderInfo | null;
  /** Chronological, ending with (or including) the target customer message. */
  history: ChatMessage[];
  /** The customer message being replied to. */
  target: ChatMessage;
}

/** Deterministic facts computed in code, so the model never has to do date maths. */
export interface OrderFacts {
  today: string;
  order_number?: string;
  order_status?: string;
  items?: string;
  order_total?: string;
  placed_on?: string;
  delivered_on?: string | null;
  days_since_delivery?: number | null;
  hours_since_delivery?: number | null;
  hours_since_order?: number;
}

/** A time window found in a retrieved policy, checked against this order. */
export interface WindowCheck {
  label: string;
  category: KbCategory;
  limit: number;
  unit: 'hours' | 'days';
  from: 'delivery' | 'order';
  elapsed: number | null;
  within: boolean | null;
  description: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
}

export interface SearchKbArgs {
  brandId: string;
  query: string;
  categories: KbCategory[];
  limit: number;
}

export interface PipelineDeps {
  now: () => Date;
  searchKb: (args: SearchKbArgs) => Promise<KbHit[]>;
  callLlm: (messages: LlmMessage[]) => Promise<LlmResult>;
}

export interface ParsedDraft {
  reply: string;
  status: ModelStatus;
  citedLabels: string[];
  confidence: number | null;
  missingInfo: string | null;
  needsHumanReason: string | null;
}

export interface PipelineResult {
  status: GroundingStatus;
  reply: string;
  confidence: number | null;
  citedEntryIds: string[];
  missingInfo: string | null;
  needsHumanReason: string | null;
  flags: string[];
  retrieved: RetrievedSnippet[];
  orderFacts: OrderFacts;
  windowChecks: WindowCheck[];
  intents: KbCategory[];
  model: string | null;
  promptVersion: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  error: string | null;
}
