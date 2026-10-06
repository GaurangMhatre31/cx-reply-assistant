import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from './hooks/useSession';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { InboxPage } from './pages/InboxPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { LogsPage } from './pages/LogsPage';

export function App() {
  const session = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  // Cached data belongs to the agent who fetched it: drop it whenever the
  // signed-in user changes, so switching accounts never shows another
  // agent's brands, even for a moment.
  useEffect(() => {
    queryClient.clear();
  }, [userId, queryClient]);

  if (session === undefined) return <Spinner />;
  if (session === null) return <LoginPage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout session={session} />}>
          <Route index element={<InboxPage />} />
          <Route path="c/:conversationId" element={<InboxPage />} />
          <Route path="knowledge" element={<KnowledgeBasePage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
