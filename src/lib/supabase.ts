import { createClient } from '@supabase/supabase-js';

/** Tolerates values pasted with quotes, spaces or a leading "NAME=" into a hosting dashboard. */
export function cleanEnv(value: unknown, name: string): string {
  const unquote = (s: string) => s.trim().replace(/^["']+|["']+$/g, '').trim();
  return unquote(unquote(String(value ?? '')).replace(new RegExp(`^${name}\\s*=\\s*`), ''));
}

const url = cleanEnv(import.meta.env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
const anonKey = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY, 'VITE_SUPABASE_ANON_KEY');
const urlIsValid = /^https?:\/\/[^\s/]+/.test(url);

export const isConfigured = urlIsValid && anonKey.length > 0;

/** Human-readable reason the app can't reach Supabase, shown on the login page. */
export const configProblem = !url
  ? 'VITE_SUPABASE_URL is not set.'
  : !urlIsValid
    ? 'VITE_SUPABASE_URL is not a valid https:// URL. Check its value in your hosting settings.'
    : !anonKey
      ? 'VITE_SUPABASE_ANON_KEY is not set.'
      : null;

// The anon key is public by design: it only identifies the project. Every
// table is protected by RLS, so what a browser can read depends on the signed
// in agent's brand memberships, not on this key.
// A placeholder URL keeps the app rendering (with a config warning) instead of
// crashing to a blank page when the environment is misconfigured.
export const supabase = createClient(urlIsValid ? url : 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const DEMO_ACCOUNTS = [
  { label: 'Demo agent: both brands (admin)', email: 'demo.agent@example.com', password: 'demo-cx-2026' },
  { label: 'Dewdrop-only agent', email: 'dewdrop.agent@example.com', password: 'demo-cx-2026' },
] as const;
