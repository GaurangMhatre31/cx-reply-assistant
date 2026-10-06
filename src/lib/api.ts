import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type {
  AiGeneration,
  Brand,
  ConversationDetail,
  ConversationListItem,
  KbEntry,
  KbEntryInput,
  Membership,
  Message,
} from './types';

// Every function here runs as the signed-in agent. Postgres RLS decides what
// comes back; nothing in this file filters by brand for security reasons —
// brand filters below are UX only.

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------------------------------------------------------------------------
// Brands & memberships
// ---------------------------------------------------------------------------
export async function fetchBrands(): Promise<Brand[]> {
  return unwrap(await supabase.from('brands').select('id, slug, name, tone, support_email').order('name'));
}

export async function fetchMemberships(): Promise<Membership[]> {
  return unwrap(await supabase.from('agent_brands').select('brand_id, role'));
}

// ---------------------------------------------------------------------------
// Conversations & messages
// ---------------------------------------------------------------------------
const LIST_COLUMNS = `
  id, brand_id, channel, status, last_message_at, last_message_preview, last_message_sender,
  customer:customers!conversations_customer_fk(name),
  order:orders!conversations_order_fk(order_number)
`;

export async function fetchConversations(brandId: string | null): Promise<ConversationListItem[]> {
  let query = supabase.from('conversations').select(LIST_COLUMNS).order('last_message_at', { ascending: false }).limit(100);
  if (brandId) query = query.eq('brand_id', brandId);
  return unwrap(await query) as unknown as ConversationListItem[];
}

export async function fetchConversation(id: string): Promise<ConversationDetail | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select(
      `id, brand_id, channel, status, last_message_at, last_message_preview, last_message_sender,
       customer:customers!conversations_customer_fk(id, name, phone, email),
       order:orders!conversations_order_fk(id, order_number, status, items, total_amount, currency, placed_at, delivered_at)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as ConversationDetail | null;
}

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  return unwrap(
    await supabase
      .from('messages')
      .select('id, conversation_id, sender_type, sender_agent_id, body, ai_generation_id, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
  );
}

export async function sendAgentMessage(conversationId: string, body: string): Promise<Message> {
  return unwrap(await supabase.rpc('send_agent_message', { p_conversation_id: conversationId, p_body: body }));
}

export async function sendCustomerMessage(conversationId: string, body: string): Promise<Message> {
  return unwrap(await supabase.rpc('simulate_customer_message', { p_conversation_id: conversationId, p_body: body }));
}

export interface OrderOption {
  id: string;
  brand_id: string;
  order_number: string;
  status: string;
  customer: { name: string } | null;
}

export async function fetchOrders(): Promise<OrderOption[]> {
  return unwrap(
    await supabase
      .from('orders')
      .select('id, brand_id, order_number, status, customer:customers!orders_customer_fk(name)')
      .order('placed_at', { ascending: false }),
  ) as unknown as OrderOption[];
}

export async function startTestConversation(orderId: string, channel: string): Promise<{ id: string }> {
  return unwrap(await supabase.rpc('start_test_conversation', { p_order_id: orderId, p_channel: channel }));
}

// ---------------------------------------------------------------------------
// AI drafts
// ---------------------------------------------------------------------------
export async function fetchPendingDraft(conversationId: string): Promise<AiGeneration | null> {
  const { data, error } = await supabase
    .from('ai_generations')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('outcome', 'pending')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as AiGeneration | null;
}

export class DraftError extends Error {
  constructor(message: string, readonly generation: AiGeneration | null) {
    super(message);
  }
}

export async function generateReply(conversationId: string): Promise<AiGeneration> {
  const { data, error } = await supabase.functions.invoke<{ generation: AiGeneration }>('generate-reply', {
    body: { conversation_id: conversationId },
  });
  if (error) {
    // Surface the function's own error message (e.g. "AI unavailable, reply manually").
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new DraftError(payload?.error ?? error.message, payload?.generation ?? null);
    }
    throw new DraftError(error.message, null);
  }
  return data!.generation;
}

export async function approveDraft(generationId: string, finalText: string): Promise<Message> {
  return unwrap(await supabase.rpc('approve_ai_generation', { p_generation_id: generationId, p_final_text: finalText }));
}

export async function discardDraft(generationId: string, editedText: string): Promise<void> {
  unwrap(await supabase.rpc('discard_ai_generation', { p_generation_id: generationId, p_edited_text: editedText }));
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------
export async function fetchKbEntries(brandId: string): Promise<KbEntry[]> {
  return unwrap(
    await supabase
      .from('kb_entries')
      .select('id, brand_id, category, title, content, keywords, is_active, updated_at')
      .eq('brand_id', brandId)
      .order('category')
      .order('title'),
  );
}

export async function createKbEntry(input: KbEntryInput): Promise<void> {
  unwrap(await supabase.from('kb_entries').insert(input));
}

export async function updateKbEntry(id: string, input: Partial<KbEntryInput>): Promise<void> {
  const { data, error } = await supabase.from('kb_entries').update(input).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('You do not have permission to edit this entry.');
}

export async function deleteKbEntry(id: string): Promise<void> {
  const { data, error } = await supabase.from('kb_entries').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('You do not have permission to delete this entry.');
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------
export interface GenerationLogRow extends AiGeneration {
  conversation: { customer: { name: string } | null } | null;
}

export async function fetchGenerations(filters: { brandId: string | null; status: string | null }): Promise<GenerationLogRow[]> {
  let query = supabase
    .from('ai_generations')
    .select('*, conversation:conversations!ai_generations_conversation_fk(customer:customers!conversations_customer_fk(name))')
    .order('created_at', { ascending: false })
    .limit(200);
  if (filters.brandId) query = query.eq('brand_id', filters.brandId);
  if (filters.status) query = query.eq('grounding_status', filters.status);
  return unwrap(await query) as unknown as GenerationLogRow[];
}
