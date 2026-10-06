// Supabase Edge Function: POST /functions/v1/generate-reply  { conversation_id }
//
// Security model:
//   * The caller's JWT is verified, and every READ (conversation, order,
//     messages, knowledge base) runs through a client scoped to that user, so
//     Postgres RLS decides what this request may see. The brand is taken from
//     the conversation row — never from the request body.
//   * Only the audit-log WRITE uses the service role, so agents cannot forge
//     or alter AI generation records from the browser.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { runReplyPipeline, DEFAULT_TOP_K } from '../_shared/pipeline.ts';
import { callLlm, llmConfigFromEnv } from '../_shared/llm.ts';
import type { ChatMessage, KbHit, OrderInfo, ReplyContext } from '../_shared/types.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HISTORY_FETCH = 12;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function env(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? fallback;
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

async function loadContext(db: SupabaseClient, conversationId: string): Promise<ReplyContext | Response> {
  const { data: conv, error } = await db
    .from('conversations')
    .select('id, brand_id, customer_id, order_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!conv) return json(404, { error: 'Conversation not found' });

  const [brand, customer, order, messages] = await Promise.all([
    db.from('brands').select('id, name, tone, support_email').eq('id', conv.brand_id).single(),
    db.from('customers').select('name').eq('id', conv.customer_id).single(),
    conv.order_id
      ? db.from('orders').select('order_number, status, items, total_amount, currency, placed_at, delivered_at').eq('id', conv.order_id).single()
      : Promise.resolve({ data: null, error: null }),
    db
      .from('messages')
      .select('id, sender_type, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_FETCH),
  ]);
  for (const r of [brand, customer, order, messages]) if (r.error) throw r.error;

  const history = ((messages.data ?? []) as ChatMessage[]).reverse();
  const last = history.at(-1);
  if (!last || last.sender_type !== 'customer') {
    return json(409, {
      error: last
        ? 'The latest message is already from the agent. AI drafts reply to a new customer message.'
        : 'This conversation has no customer message to reply to yet.',
    });
  }

  return {
    brand: brand.data!,
    customer: customer.data!,
    order: order.data ? ({ ...order.data, total_amount: Number(order.data.total_amount) } as OrderInfo) : null,
    history,
    target: last,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = env('SUPABASE_URL');
    const anonKey = env('SUPABASE_ANON_KEY');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { error: 'Not signed in' });

    // Client that acts AS the agent: every query below is filtered by RLS.
    const userDb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await userDb.auth.getUser(token);
    if (authError || !auth.user) return json(401, { error: 'Session expired, please sign in again' });

    const body = await req.json().catch(() => ({}));
    const conversationId = body?.conversation_id;
    if (typeof conversationId !== 'string' || !UUID.test(conversationId)) {
      return json(400, { error: 'conversation_id (uuid) is required' });
    }

    const ctx = await loadContext(userDb, conversationId);
    if (ctx instanceof Response) return ctx;

    const result = await runReplyPipeline(
      ctx,
      {
        now: () => new Date(),
        searchKb: async ({ brandId, query, categories, limit }) => {
          const { data, error } = await userDb.rpc('search_kb', {
            p_brand_id: brandId,
            p_query: query,
            p_categories: categories,
            p_limit: limit,
          });
          if (error) throw error;
          return (data ?? []) as KbHit[];
        },
        // Provider is chosen by secrets: OPENAI_API_KEY → OpenAI, OPENROUTER_API_KEY → OpenRouter.
        callLlm: (messages) => callLlm(messages, llmConfigFromEnv((name) => Deno.env.get(name))),
      },
      { topK: Number(Deno.env.get('KB_TOP_K') ?? DEFAULT_TOP_K) },
    );

    // Persist the attempt (successful or not) with the service role.
    const adminDb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Regenerate: the previous undecided draft is superseded, not deleted.
    const { error: supersedeError } = await adminDb
      .from('ai_generations')
      .update({ outcome: 'superseded', decided_at: new Date().toISOString(), decided_by: auth.user.id })
      .eq('conversation_id', conversationId)
      .eq('outcome', 'pending');
    if (supersedeError) throw supersedeError;

    const failed = result.status === 'error';
    const { data: generation, error: insertError } = await adminDb
      .from('ai_generations')
      .insert({
        brand_id: ctx.brand.id,
        conversation_id: conversationId,
        customer_message_id: ctx.target.id,
        customer_message: ctx.target.body,
        retrieved_context: result.retrieved.map(({ id, label, title, category, content, score }) => ({
          id, label, title, category, content, score: Math.round(score * 1000) / 1000,
        })),
        order_facts: { ...result.orderFacts, eligibility_checks: result.windowChecks.map((c) => c.description), intents: result.intents },
        model: result.model,
        prompt_version: result.promptVersion,
        ai_response: failed ? null : result.reply,
        grounding_status: result.status,
        confidence: result.confidence,
        cited_entry_ids: result.citedEntryIds,
        missing_info: result.missingInfo ?? result.needsHumanReason,
        guardrail_flags: result.flags,
        outcome: failed ? 'failed' : 'pending',
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        cost_usd: result.costUsd,
        latency_ms: result.latencyMs,
        error: result.error,
        created_by: auth.user.id,
      })
      .select()
      .single();

    if (insertError) {
      // Unique violation on the one-pending-draft index: a concurrent click won.
      if (insertError.code === '23505') return json(409, { error: 'Another draft is being generated for this conversation. Please retry.' });
      throw insertError;
    }

    if (failed) {
      return json(502, { error: `AI draft unavailable: ${result.error}. You can still reply manually.`, generation });
    }
    return json(200, { generation });
  } catch (err) {
    console.error('generate-reply failed', err);
    return json(500, { error: 'Something went wrong while generating the draft. You can still reply manually.' });
  }
});
