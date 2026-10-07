import { useState, type FormEvent } from 'react';
import { MessagesSquare } from 'lucide-react';
import { DEMO_ACCOUNTS, configProblem, isConfigured, supabase } from '../lib/supabase';
import { Button, ErrorNote, Field, inputClass } from '../components/ui';

export function LoginPage() {
  const [email, setEmail] = useState<string>(DEMO_ACCOUNTS[0].email);
  const [password, setPassword] = useState<string>(DEMO_ACCOUNTS[0].password);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(e?: FormEvent, creds = { email, password }) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword(creds);
    if (error) setError(error.message);
    setLoading(false);
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
            <MessagesSquare className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">CX Reply Assistant</h1>
            <p className="mt-1 text-sm text-slate-500">AI-drafted replies, grounded in each brand’s own policies.</p>
          </div>
        </div>

        {!isConfigured && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
            Supabase is not configured: {configProblem} Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then rebuild (see README).
          </p>
        )}

        <form onSubmit={signIn} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <Field label="Email">
            <input className={inputClass} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" loading={loading} className="w-full">
            Sign in
          </Button>
        </form>

        <div className="mt-6 space-y-2">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-slate-400">Demo accounts</p>
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.email}
              onClick={() => {
                setEmail(acc.email);
                setPassword(acc.password);
                void signIn(undefined, { email: acc.email, password: acc.password });
              }}
              className="flex w-full items-center justify-between rounded-xl bg-white px-4 py-2.5 text-left text-sm ring-1 ring-slate-200 hover:ring-indigo-300"
            >
              <span className="font-medium text-slate-700">{acc.label}</span>
              <span className="text-xs text-slate-400">{acc.email}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
