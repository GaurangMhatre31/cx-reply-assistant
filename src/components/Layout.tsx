import { NavLink, Outlet } from 'react-router';
import { BookOpen, LogOut, MessagesSquare, ScrollText } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Inbox', icon: MessagesSquare, end: false },
  { to: '/knowledge', label: 'Knowledge base', icon: BookOpen, end: true },
  { to: '/logs', label: 'AI logs', icon: ScrollText, end: true },
];

export function Layout({ session }: { session: Session }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white">
            <MessagesSquare className="size-4.5" />
          </div>
          <span className="hidden font-semibold tracking-tight text-slate-900 sm:inline">CX Reply Assistant</span>
        </div>

        <nav className="flex items-center gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <Icon className="size-4" />
              <span className="hidden md:inline">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-slate-500 lg:inline">{session.user.email}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
