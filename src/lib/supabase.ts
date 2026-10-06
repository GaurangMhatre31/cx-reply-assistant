import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

// The anon key is public by design: it only identifies the project. Every
// table is protected by RLS, so what a browser can read depends on the signed
// in agent's brand memberships, not on this key.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const DEMO_ACCOUNTS = [
  { label: 'Demo agent: both brands (admin)', email: 'demo.agent@example.com', password: 'demo-cx-2026' },
  { label: 'Dewdrop-only agent', email: 'dewdrop.agent@example.com', password: 'demo-cx-2026' },
] as const;
