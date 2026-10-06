// Row shapes as returned by the Supabase API. Kept by hand (instead of
// `supabase gen types`) because the app only touches a handful of columns.

export type KbCategory = 'returns' | 'refunds' | 'shipping' | 'cancellation' | 'damaged_items' | 'general';
export type GroundingStatus = 'grounded' | 'needs_review' | 'no_knowledge' | 'error';
export type Outcome = 'pending' | 'approved' | 'approved_with_edits' | 'discarded' | 'superseded' | 'failed';
export type SenderType = 'customer' | 'agent' | 'system';

export interface Brand {
  id: string;
  slug: string;
  name: string;
  tone: string;
  support_email: string | null;
}

export interface Membership {
  brand_id: string;
  role: 'agent' | 'admin';
}

export interface ConversationListItem {
  id: string;
  brand_id: string;
  channel: 'whatsapp' | 'email' | 'web';
  status: 'open' | 'pending' | 'resolved';
  last_message_at: string;
  last_message_preview: string | null;
  last_message_sender: SenderType | null;
  customer: { name: string } | null;
  order: { order_number: string } | null;
}

export interface OrderItem {
  name: string;
  qty: number;
  price: number;
}

export interface ConversationDetail extends ConversationListItem {
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
  order: {
    id: string;
    order_number: string;
    status: string;
    items: OrderItem[];
    total_amount: number;
    currency: string;
    placed_at: string;
    delivered_at: string | null;
  } | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_agent_id: string | null;
  body: string;
  ai_generation_id: string | null;
  created_at: string;
}

export interface RetrievedEntry {
  id: string;
  label: string;
  title: string;
  category: KbCategory;
  content: string;
  score: number;
}

export interface AiGeneration {
  id: string;
  brand_id: string;
  conversation_id: string;
  customer_message_id: string | null;
  customer_message: string;
  retrieved_context: RetrievedEntry[];
  order_facts: (Record<string, unknown> & { eligibility_checks?: string[]; intents?: string[] }) | null;
  model: string | null;
  prompt_version: string;
  ai_response: string | null;
  grounding_status: GroundingStatus;
  confidence: number | null;
  cited_entry_ids: string[];
  missing_info: string | null;
  guardrail_flags: string[];
  agent_edited_response: string | null;
  final_response: string | null;
  outcome: Outcome;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface KbEntry {
  id: string;
  brand_id: string;
  category: KbCategory;
  title: string;
  content: string;
  keywords: string;
  is_active: boolean;
  updated_at: string;
}

export type KbEntryInput = Pick<KbEntry, 'brand_id' | 'category' | 'title' | 'content' | 'keywords' | 'is_active'>;
