/**
 * In-process Postgres (PGlite) loaded with the real migrations + seed, plus a
 * minimal stand-in for the parts of Supabase the schema depends on (the
 * `auth` schema, `auth.uid()`, and the anon/authenticated/service_role roles).
 *
 * This lets the RLS policies, RPCs and full-text retrieval be tested without
 * Docker or a Supabase project.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

export const BRAND_KESARI = '11111111-1111-1111-1111-111111111111';
export const BRAND_DEWDROP = '22222222-2222-2222-2222-222222222222';

/** Admin of both brands — the account reviewers use. */
export const AGENT_ALL = 'aaaaaaaa-0000-0000-0000-000000000001';
/** Admin of Dewdrop only — proves cross-brand isolation. */
export const AGENT_DEWDROP = 'aaaaaaaa-0000-0000-0000-000000000002';
/** Plain agent (not admin) of Kesari only — proves KB write restrictions. */
export const AGENT_KESARI_READONLY = 'aaaaaaaa-0000-0000-0000-000000000003';

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key, email text unique);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;
`;

const DEMO_AGENTS = `
  insert into auth.users (id, email) values
    ('${AGENT_ALL}', 'demo@cx.example'),
    ('${AGENT_DEWDROP}', 'dewdrop@cx.example'),
    ('${AGENT_KESARI_READONLY}', 'kesari.agent@cx.example');
  insert into public.agents (id, display_name) values
    ('${AGENT_ALL}', 'Demo Agent'),
    ('${AGENT_DEWDROP}', 'Dewdrop Agent'),
    ('${AGENT_KESARI_READONLY}', 'Kesari Agent');
  insert into public.agent_brands (agent_id, brand_id, role) values
    ('${AGENT_ALL}', '${BRAND_KESARI}', 'admin'),
    ('${AGENT_ALL}', '${BRAND_DEWDROP}', 'admin'),
    ('${AGENT_DEWDROP}', '${BRAND_DEWDROP}', 'admin'),
    ('${AGENT_KESARI_READONLY}', '${BRAND_KESARI}', 'agent');
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);

  const migrationsDir = join(ROOT, 'supabase', 'migrations');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  await db.exec(readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8'));
  await db.exec(DEMO_AGENTS);
  await db.exec('grant all on all tables in schema public to service_role;');
  return db;
}

/**
 * Run `fn` as a signed-in agent: role `authenticated` + JWT subject, exactly
 * how PostgREST executes a request from the browser. Rolled back afterwards
 * unless `commit` is true.
 */
export async function asAgent<T>(
  db: PGlite,
  agentId: string,
  fn: (tx: Transaction) => Promise<T>,
  { commit = false }: { commit?: boolean } = {},
): Promise<T> {
  let result!: T;
  try {
    await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated; set local request.jwt.claim.sub = '${agentId}';`);
      result = await fn(tx);
      if (!commit) throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return result;
}

class Rollback extends Error {}
