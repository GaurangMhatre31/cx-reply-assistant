/**
 * End-to-end smoke test against the deployed project, through the same public
 * API the browser uses (anon key + agent login, so RLS applies).
 *
 *   npm run smoke
 *
 * Opens a fresh test conversation (seeded threads are left untouched), sends a
 * customer message, generates a draft via the edge function, approves it, and
 * checks the audit log, then verifies a Dewdrop-only agent cannot see or
 * draft for Kesari data.
 */
import 'dotenv/config';
import { createClient, FunctionsHttpError } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.');
  process.exit(1);
}

const PRIYA_ORDER = 'd0000000-0000-0000-0000-000000000001'; // Kesari, delivered 3 h ago
const KESARI_CONV = 'e0000000-0000-0000-0000-000000000001';
let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};

async function signIn(email: string) {
  const client = createClient(url!, anon!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: 'demo-cx-2026' });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

// --- Demo agent: the full reply loop -----------------------------------------
const agent = await signIn('demo.agent@example.com');
check(true, 'demo agent signed in');

const { data: brands } = await agent.from('brands').select('name');
check(brands?.length === 2, 'demo agent sees both brands', brands?.map((b) => b.name).join(', '));

const { data: conv, error: convErr } = await agent.rpc('start_test_conversation', { p_order_id: PRIYA_ORDER, p_channel: 'whatsapp' });
if (convErr) throw convErr;
check(Boolean(conv?.id), 'test conversation created');

const { error: msgErr } = await agent.rpc('simulate_customer_message', {
  p_conversation_id: conv.id,
  p_body: 'Hi, my order arrived today but one of the oil bottles is cracked and leaking. What can I do?',
});
check(!msgErr, 'customer message sent (simulator)', msgErr?.message);

const started = Date.now();
const { data: gen, error: genErr } = await agent.functions.invoke('generate-reply', { body: { conversation_id: conv.id } });
if (genErr) {
  const detail = genErr instanceof FunctionsHttpError ? await genErr.context.text() : genErr.message;
  check(false, 'generate-reply', detail);
  process.exit(1);
}
const draft = gen.generation;
check(draft.grounding_status === 'grounded', 'AI draft generated', `${draft.grounding_status} in ${Date.now() - started} ms via ${draft.model}`);
check(draft.retrieved_context[0]?.title === 'Damaged or leaking bottles', 'retrieved the damage policy', draft.retrieved_context.map((r: { title: string }) => r.title).join(', '));
console.log(`  draft: ${draft.ai_response}`);

const edited = `${draft.ai_response}`.replace(/\s+$/, '') + ' 🙏';
const { error: approveErr } = await agent.rpc('approve_ai_generation', { p_generation_id: draft.id, p_final_text: edited });
check(!approveErr, 'edited draft approved and sent', approveErr?.message);

const { error: againErr } = await agent.rpc('approve_ai_generation', { p_generation_id: draft.id, p_final_text: edited });
check(Boolean(againErr), 'second approval rejected (no double send)', againErr?.message);

const { data: log } = await agent.from('ai_generations').select('outcome, agent_edited_response, final_response, prompt_tokens, cost_usd').eq('id', draft.id).single();
check(log?.outcome === 'approved_with_edits' && log.final_response === edited.trim(), 'audit log has AI + edited + final response', `${log?.prompt_tokens} prompt tokens, $${log?.cost_usd}`);

const { data: msgs } = await agent.from('messages').select('sender_type, ai_generation_id').eq('conversation_id', conv.id).order('created_at');
check(msgs?.length === 2 && msgs[1].sender_type === 'agent' && msgs[1].ai_generation_id === draft.id, 'reply is in the conversation, linked to the draft');

// --- Dewdrop-only agent: isolation -----------------------------------------
const dewdrop = await signIn('dewdrop.agent@example.com');
const { data: dBrands } = await dewdrop.from('brands').select('name');
check(dBrands?.length === 1 && dBrands[0].name === 'Dewdrop Skincare', 'Dewdrop agent sees only Dewdrop', dBrands?.map((b) => b.name).join(', '));

const { data: leaked } = await dewdrop.from('kb_entries').select('id').eq('brand_id', '11111111-1111-1111-1111-111111111111');
check(leaked?.length === 0, 'Dewdrop agent cannot read Kesari policies');

const { error: crossErr } = await dewdrop.functions.invoke('generate-reply', { body: { conversation_id: KESARI_CONV } });
const crossStatus = crossErr instanceof FunctionsHttpError ? crossErr.context.status : null;
check(crossStatus === 404, 'Dewdrop agent cannot draft for a Kesari conversation', `HTTP ${crossStatus}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll live checks passed');
process.exit(failures ? 1 : 0);
