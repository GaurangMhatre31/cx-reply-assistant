import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  AGENT_ALL,
  AGENT_DEWDROP,
  AGENT_KESARI_READONLY,
  BRAND_DEWDROP,
  BRAND_KESARI,
  asAgent,
  createTestDb,
} from './helpers/db';

const CONV_PRIYA_KESARI = 'e0000000-0000-0000-0000-000000000001';
const CONV_MEERA_DEWDROP = 'e0000000-0000-0000-0000-000000000004';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

type Hit = { id: string; category: string; title: string; content: string; score: number };

async function search(agentId: string, brandId: string, query: string, categories: string[] = []) {
  return asAgent(db, agentId, async (tx) => {
    const { rows } = await tx.query<Hit>('select * from public.search_kb($1, $2, $3)', [brandId, query, categories]);
    return rows;
  });
}

describe('tenant isolation (RLS)', () => {
  it('an agent only sees conversations of brands they belong to', async () => {
    const rows = await asAgent(db, AGENT_DEWDROP, async (tx) =>
      (await tx.query<{ brand_id: string }>('select brand_id from public.conversations')).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.brand_id === BRAND_DEWDROP)).toBe(true);
  });

  it('brand-scoped tables never leak the other brand', async () => {
    for (const table of ['brands', 'customers', 'orders', 'messages', 'kb_entries', 'ai_generations']) {
      const col = table === 'brands' ? 'id' : 'brand_id';
      const rows = await asAgent(db, AGENT_DEWDROP, async (tx) =>
        (await tx.query<{ b: string }>(`select ${col} as b from public.${table}`)).rows,
      );
      expect(rows.some((r) => r.b === BRAND_KESARI), table).toBe(false);
    }
  });

  it('an unauthenticated (anon) request sees nothing', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.exec('set local role anon;');
      return (await tx.query('select id from public.kb_entries').catch(() => ({ rows: [] }))).rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('search_kb for another brand returns nothing, even if the brand id is passed explicitly', async () => {
    const hits = await search(AGENT_DEWDROP, BRAND_KESARI, 'refund policy', ['refunds']);
    expect(hits).toHaveLength(0);
  });

  it('cannot post into another brand’s conversation via RPC', async () => {
    await expect(
      asAgent(db, AGENT_DEWDROP, (tx) =>
        tx.query('select public.simulate_customer_message($1, $2)', [CONV_PRIYA_KESARI, 'hi']),
      ),
    ).rejects.toThrow(/not found/i);
    await expect(
      asAgent(db, AGENT_DEWDROP, (tx) =>
        tx.query('select public.send_agent_message($1, $2)', [CONV_PRIYA_KESARI, 'hi']),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('the schema rejects a message whose brand differs from its conversation (composite FK)', async () => {
    await expect(
      db.query(
        `insert into public.messages (brand_id, conversation_id, sender_type, body) values ($1, $2, 'customer', 'x')`,
        [BRAND_DEWDROP, CONV_PRIYA_KESARI],
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it('agents cannot write messages directly (writes go through RPCs)', async () => {
    await expect(
      asAgent(db, AGENT_ALL, (tx) =>
        tx.query(
          `insert into public.messages (brand_id, conversation_id, sender_type, body) values ($1, $2, 'agent', 'x')`,
          [BRAND_KESARI, CONV_PRIYA_KESARI],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});

describe('knowledge base management', () => {
  it('a brand admin can create, edit and delete entries for their brand', async () => {
    await asAgent(db, AGENT_ALL, async (tx) => {
      const { rows } = await tx.query<{ id: string; updated_by: string }>(
        `insert into public.kb_entries (brand_id, category, title, content) values ($1, 'general', 'Gift wrapping', 'Gift wrapping costs ₹50.') returning id, updated_by`,
        [BRAND_KESARI],
      );
      expect(rows[0].updated_by).toBe(AGENT_ALL);
      const upd = await tx.query(`update public.kb_entries set content = 'Gift wrapping is free.' where id = $1`, [rows[0].id]);
      expect(upd.affectedRows).toBe(1);
      const del = await tx.query(`delete from public.kb_entries where id = $1`, [rows[0].id]);
      expect(del.affectedRows).toBe(1);
    });
  });

  it('a non-admin agent cannot modify the knowledge base', async () => {
    await expect(
      asAgent(db, AGENT_KESARI_READONLY, (tx) =>
        tx.query(`insert into public.kb_entries (brand_id, category, title, content) values ($1, 'general', 't', 'c')`, [BRAND_KESARI]),
      ),
    ).rejects.toThrow(/row-level security/i);

    const upd = await asAgent(db, AGENT_KESARI_READONLY, (tx) =>
      tx.query(`update public.kb_entries set content = 'hacked' where brand_id = $1`, [BRAND_KESARI]),
    );
    expect(upd.affectedRows).toBe(0);
  });

  it('an admin of one brand cannot edit or move entries into another brand', async () => {
    const upd = await asAgent(db, AGENT_DEWDROP, (tx) =>
      tx.query(`update public.kb_entries set content = 'hacked' where brand_id = $1`, [BRAND_KESARI]),
    );
    expect(upd.affectedRows).toBe(0);

    await expect(
      asAgent(db, AGENT_DEWDROP, (tx) =>
        tx.query(`update public.kb_entries set brand_id = $1 where brand_id = $2`, [BRAND_KESARI, BRAND_DEWDROP]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('an edited policy is immediately what retrieval returns', async () => {
    const after = await asAgent(db, AGENT_ALL, async (tx) => {
      await tx.query(
        `update public.kb_entries set content = 'Refunds are permitted within 14 days of delivery.' where id = 'f0000000-0000-0000-0000-0000000000a1'`,
      );
      return (await tx.query<Hit>('select * from public.search_kb($1, $2, $3)', [BRAND_KESARI, 'can I get a refund', ['refunds']])).rows;
    });
    expect(after[0].content).toContain('14 days');
  });
});

describe('retrieval quality (search_kb)', () => {
  it('finds the damage policy for the brief’s scenario, using the brand’s own wording', async () => {
    const hits = await search(AGENT_ALL, BRAND_KESARI, 'My order was delivered but the bottle is broken. What can I do?');
    expect(hits[0]?.category).toBe('damaged_items');
    expect(hits[0]?.content).toContain('48 hours');
  });

  it('finds the refund policy for a refund question', async () => {
    const hits = await search(AGENT_ALL, BRAND_KESARI, 'I received this 20 days ago. Can I get a refund?');
    expect(hits[0]?.category).toBe('refunds');
    expect(hits[0]?.content).toContain('7 days');
  });

  it('returns the other brand’s policy for the same question (different windows)', async () => {
    const hits = await search(AGENT_ALL, BRAND_DEWDROP, 'I received this 20 days ago. Can I get a refund?');
    expect(hits[0]?.category).toBe('refunds');
    expect(hits[0]?.content).toContain('30 days');
    expect(hits.every((h) => !h.content.includes('7 days of delivery. After 7 days'))).toBe(true);
  });

  it('a detected intent pulls in its category even without word overlap', async () => {
    const hits = await search(AGENT_ALL, BRAND_DEWDROP, 'I want my money back', ['refunds']);
    expect(hits.map((h) => h.category)).toContain('refunds');
  });

  it('returns nothing when the knowledge base does not cover the question', async () => {
    const hits = await search(
      AGENT_ALL,
      BRAND_DEWDROP,
      'Do you have a physical store in Bangalore where I can try the products before buying?',
    );
    expect(hits).toHaveLength(0);
  });

  it('copes with empty and punctuation-only queries', async () => {
    expect(await search(AGENT_ALL, BRAND_KESARI, '')).toHaveLength(0);
    expect(await search(AGENT_ALL, BRAND_KESARI, "?!' & | :*")).toHaveLength(0);
  });

  it('ignores deactivated entries', async () => {
    const hits = await asAgent(db, AGENT_ALL, async (tx) => {
      await tx.query(`update public.kb_entries set is_active = false where id = 'f0000000-0000-0000-0000-0000000000a1'`);
      return (await tx.query<Hit>('select * from public.search_kb($1, $2, $3)', [BRAND_KESARI, 'refund', ['refunds']])).rows;
    });
    expect(hits.some((h) => h.id === 'f0000000-0000-0000-0000-0000000000a1')).toBe(false);
  });
});

describe('message & draft workflow', () => {
  async function insertPendingDraft(conversationId: string, brandId: string, aiResponse: string) {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.ai_generations (brand_id, conversation_id, customer_message, prompt_version, ai_response, grounding_status)
       values ($1, $2, 'q', 'test', $3, 'grounded') returning id`,
      [brandId, conversationId, aiResponse],
    );
    return rows[0].id;
  }

  it('customer and agent messages update the conversation status', async () => {
    const statuses = await asAgent(db, AGENT_ALL, async (tx) => {
      await tx.query('select public.send_agent_message($1, $2)', [CONV_MEERA_DEWDROP, 'Hi Meera!']);
      const a = (await tx.query<{ status: string }>('select status from public.conversations where id = $1', [CONV_MEERA_DEWDROP])).rows[0].status;
      await tx.query('select public.simulate_customer_message($1, $2)', [CONV_MEERA_DEWDROP, 'Thanks']);
      const b = (await tx.query<{ status: string }>('select status from public.conversations where id = $1', [CONV_MEERA_DEWDROP])).rows[0].status;
      return [a, b];
    });
    expect(statuses).toEqual(['pending', 'open']);
  });

  it('approving an unedited draft sends it and logs outcome=approved', async () => {
    const genId = await insertPendingDraft(CONV_MEERA_DEWDROP, BRAND_DEWDROP, 'Hello Meera, yes you can.');
    const gen = await asAgent(
      db,
      AGENT_ALL,
      async (tx) => {
        await tx.query('select public.approve_ai_generation($1, $2)', [genId, '  Hello Meera, yes you can. ']);
        return (await tx.query<Record<string, unknown>>('select * from public.ai_generations where id = $1', [genId])).rows[0];
      },
      { commit: true },
    );
    expect(gen.outcome).toBe('approved');
    expect(gen.agent_edited_response).toBeNull();
    expect(gen.final_response).toBe('Hello Meera, yes you can.');
    expect(gen.final_message_id).toBeTruthy();
  });

  it('approving an edited draft records both versions, and cannot be sent twice', async () => {
    const genId = await insertPendingDraft(CONV_MEERA_DEWDROP, BRAND_DEWDROP, 'AI version');
    await asAgent(db, AGENT_ALL, (tx) => tx.query('select public.approve_ai_generation($1, $2)', [genId, 'Agent version']), {
      commit: true,
    });
    const { rows } = await db.query<Record<string, unknown>>('select * from public.ai_generations where id = $1', [genId]);
    expect(rows[0].outcome).toBe('approved_with_edits');
    expect(rows[0].ai_response).toBe('AI version');
    expect(rows[0].agent_edited_response).toBe('Agent version');
    expect(rows[0].final_response).toBe('Agent version');

    await expect(
      asAgent(db, AGENT_ALL, (tx) => tx.query('select public.approve_ai_generation($1, $2)', [genId, 'again'])),
    ).rejects.toThrow(/already approved_with_edits/);
  });

  it('only one pending draft can exist per conversation', async () => {
    await insertPendingDraft(CONV_PRIYA_KESARI, BRAND_KESARI, 'one');
    await expect(insertPendingDraft(CONV_PRIYA_KESARI, BRAND_KESARI, 'two')).rejects.toThrow(/unique/i);
  });

  it('another brand’s agent cannot approve or even see a draft', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.ai_generations where conversation_id = $1 and outcome = 'pending'`,
      [CONV_PRIYA_KESARI],
    );
    await expect(
      asAgent(db, AGENT_DEWDROP, (tx) => tx.query('select public.approve_ai_generation($1, $2)', [rows[0].id, 'x'])),
    ).rejects.toThrow(/not found/i);
  });

  it('discarding keeps the agent’s edit for later analysis', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.ai_generations where conversation_id = $1 and outcome = 'pending'`,
      [CONV_PRIYA_KESARI],
    );
    await asAgent(db, AGENT_ALL, (tx) => tx.query('select public.discard_ai_generation($1, $2)', [rows[0].id, 'better']), {
      commit: true,
    });
    const after = await db.query<Record<string, unknown>>('select * from public.ai_generations where id = $1', [rows[0].id]);
    expect(after.rows[0].outcome).toBe('discarded');
    expect(after.rows[0].agent_edited_response).toBe('better');
  });

  it('start_test_conversation opens a clean thread for the order’s own customer and brand', async () => {
    const conv = await asAgent(db, AGENT_ALL, async (tx) =>
      (await tx.query<{ brand_id: string; customer_id: string }>(
        `select * from public.start_test_conversation('d0000000-0000-0000-0000-000000000005')`,
      )).rows[0],
    );
    expect(conv.brand_id).toBe(BRAND_DEWDROP);
    expect(conv.customer_id).toBe('c0000000-0000-0000-0000-000000000005');

    await expect(
      asAgent(db, AGENT_DEWDROP, (tx) => tx.query(`select public.start_test_conversation('d0000000-0000-0000-0000-000000000001')`)),
    ).rejects.toThrow(/not found/i);
  });
});
