import { describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
const { cleanEnv } = await import('../src/lib/supabase');

describe('cleanEnv (values pasted into a hosting dashboard)', () => {
  const URL = 'https://abc.supabase.co';
  it.each([
    [URL],
    [` ${URL} `],
    [`"${URL}"`],
    [`'${URL}'`],
    [`VITE_SUPABASE_URL=${URL}`],
    [`"VITE_SUPABASE_URL=${URL} "`],
    [`VITE_SUPABASE_URL = "${URL}"`],
  ])('%s', (raw) => {
    expect(cleanEnv(raw, 'VITE_SUPABASE_URL')).toBe(URL);
  });

  it('returns an empty string for missing values', () => {
    expect(cleanEnv(undefined, 'VITE_SUPABASE_URL')).toBe('');
  });
});
