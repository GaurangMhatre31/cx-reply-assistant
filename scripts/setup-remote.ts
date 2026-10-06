/**
 * One-command setup of a hosted Supabase project, via the Supabase Management API.
 *
 *   npm run setup:remote
 *
 * Needs in .env: SUPABASE_URL, SUPABASE_ACCESS_TOKEN (personal access token with
 * database, edge-function-secrets and auth-config access) and OPENAI_API_KEY or
 * OPENROUTER_API_KEY.
 *
 * 1. applies supabase/migrations/*.sql (skipped if the schema already exists)
 * 2. applies supabase/seed.sql (idempotent)
 * 3. stores the LLM settings as edge-function secrets (never printed)
 * 4. disables public sign-up (demo accounts are created by `npm run seed:users`)
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref || !token) {
  console.error('Set SUPABASE_URL (https://<ref>.supabase.co) and SUPABASE_ACCESS_TOKEN in .env.');
  process.exit(1);
}

const API = `https://api.supabase.com/v1/projects/${ref}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

const sql = (query: string) => api('/database/query', { method: 'POST', body: JSON.stringify({ query }) });

// 1. Migrations
const existing = (await sql(`select to_regclass('public.brands') is not null as present`)) as Array<{ present: boolean }>;
if (existing[0]?.present) {
  console.log('• Schema already present, skipping migrations');
} else {
  const dir = join('supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await sql(readFileSync(join(dir, file), 'utf8'));
    console.log(`✓ migration ${file}`);
  }
}

// 2. Seed
await sql(readFileSync(join('supabase', 'seed.sql'), 'utf8'));
const counts = (await sql(
  `select (select count(*) from public.brands) as brands, (select count(*) from public.kb_entries) as kb_entries,
          (select count(*) from public.conversations) as conversations, (select count(*) from public.messages) as messages`,
)) as Array<Record<string, number>>;
console.log(`✓ seed data: ${JSON.stringify(counts[0])}`);

// 3. Edge-function secrets (LLM provider settings only; values are never logged)
const SECRET_NAMES = [
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_FALLBACK_MODELS',
  'LLM_PRICE_INPUT_PER_M', 'LLM_PRICE_OUTPUT_PER_M', 'LLM_TIMEOUT_MS', 'KB_TOP_K', 'APP_URL',
];
const secrets = SECRET_NAMES.filter((n) => process.env[n]?.trim()).map((name) => ({ name, value: process.env[name]!.trim() }));
if (!secrets.some((s) => s.name.endsWith('_API_KEY'))) {
  console.warn('! No OPENAI_API_KEY or OPENROUTER_API_KEY in .env, so the AI function will not work until one is set.');
}
if (secrets.length) {
  await api('/secrets', { method: 'POST', body: JSON.stringify(secrets) });
  console.log(`✓ edge-function secrets set: ${secrets.map((s) => s.name).join(', ')}`);
}

// 4. Auth: no public sign-up; demo accounts are provisioned by an admin script.
await api('/config/auth', { method: 'PATCH', body: JSON.stringify({ disable_signup: true }) });
console.log('✓ public sign-up disabled');

console.log('\nNext: npm run seed:users  →  npx supabase functions deploy generate-reply --use-api --no-verify-jwt');
