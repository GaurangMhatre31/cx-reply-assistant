/**
 * Creates the demo agent accounts and their brand memberships.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:users
 *
 * Idempotent: existing users are reused and their password reset to the demo one.
 * Run after the migrations and seed.sql have been applied.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const KESARI = '11111111-1111-1111-1111-111111111111';
const DEWDROP = '22222222-2222-2222-2222-222222222222';
const PASSWORD = 'demo-cx-2026';

const ACCOUNTS = [
  {
    email: 'demo.agent@example.com',
    name: 'Demo Agent',
    brands: [
      { brand_id: KESARI, role: 'admin' },
      { brand_id: DEWDROP, role: 'admin' },
    ],
  },
  {
    email: 'dewdrop.agent@example.com',
    name: 'Dewdrop Agent',
    brands: [{ brand_id: DEWDROP, role: 'admin' }],
  },
];

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. in .env).');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
}

for (const account of ACCOUNTS) {
  let userId = await findUserId(account.email);
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
    if (error) throw error;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email: account.email, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
  }

  const { error: agentError } = await admin.from('agents').upsert({ id: userId, display_name: account.name });
  if (agentError) throw agentError;

  const { error: membershipError } = await admin
    .from('agent_brands')
    .upsert(account.brands.map((b) => ({ agent_id: userId, ...b })));
  if (membershipError) throw membershipError;

  console.log(`✓ ${account.email} → ${account.brands.length} brand(s)`);
}

console.log(`\nDemo password for all accounts: ${PASSWORD}`);
