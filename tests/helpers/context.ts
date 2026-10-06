import type { PGlite } from '@electric-sql/pglite';
import type { KbCategory, KbHit, ReplyContext, SearchKbArgs } from '../../supabase/functions/_shared/types';
import { AGENT_ALL, asAgent } from './db';

/** Loads a seeded conversation into the pipeline's ReplyContext — the same shape the edge function builds. */
export async function loadContext(db: PGlite, conversationId: string, extraCustomerMessage?: string): Promise<ReplyContext> {
  const conv = (await db.query<any>('select * from public.conversations where id = $1', [conversationId])).rows[0];
  const brand = (await db.query<any>('select id, name, tone, support_email from public.brands where id = $1', [conv.brand_id])).rows[0];
  const customer = (await db.query<any>('select name from public.customers where id = $1', [conv.customer_id])).rows[0];
  const order = conv.order_id
    ? (await db.query<any>('select * from public.orders where id = $1', [conv.order_id])).rows[0]
    : null;
  const history = (
    await db.query<any>('select id, sender_type, body, created_at from public.messages where conversation_id = $1 order by created_at', [conversationId])
  ).rows.map((m) => ({ ...m, created_at: new Date(m.created_at).toISOString() }));

  if (extraCustomerMessage) {
    history.push({ id: `extra-${history.length}`, sender_type: 'customer', body: extraCustomerMessage, created_at: new Date().toISOString() });
  }
  const target = [...history].reverse().find((m) => m.sender_type === 'customer');

  return {
    brand,
    customer,
    order: order && {
      order_number: order.order_number,
      status: order.status,
      items: order.items,
      total_amount: Number(order.total_amount),
      currency: order.currency,
      placed_at: new Date(order.placed_at).toISOString(),
      delivered_at: order.delivered_at ? new Date(order.delivered_at).toISOString() : null,
    },
    history,
    target,
  };
}

/** search_kb executed as a signed-in agent, i.e. with RLS — exactly like the edge function's user-scoped client. */
export function pgliteSearch(db: PGlite) {
  return ({ brandId, query, categories, limit }: SearchKbArgs) =>
    asAgent(db, AGENT_ALL, async (tx) =>
      (await tx.query<KbHit>('select id, category, title, content, score from public.search_kb($1, $2, $3, $4)', [
        brandId,
        query,
        categories as KbCategory[],
        limit,
      ])).rows,
    );
}
