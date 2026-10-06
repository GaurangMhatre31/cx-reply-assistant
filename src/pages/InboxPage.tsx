import { useParams } from 'react-router';
import { MessagesSquare } from 'lucide-react';
import { ConversationList } from '../features/inbox/ConversationList';
import { ConversationView } from '../features/inbox/ConversationView';
import { EmptyState, cx } from '../components/ui';

export function InboxPage() {
  const { conversationId } = useParams();

  return (
    <div className="flex h-full">
      <aside
        className={cx(
          'w-full shrink-0 border-r border-slate-200 bg-white md:w-80',
          conversationId ? 'hidden md:flex' : 'flex',
        )}
      >
        <ConversationList activeId={conversationId} />
      </aside>

      <section className={cx('min-w-0 flex-1', conversationId ? 'flex' : 'hidden md:flex')}>
        {conversationId ? (
          <ConversationView key={conversationId} conversationId={conversationId} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={<MessagesSquare className="size-10" />} title="Select a conversation">
              Pick a conversation on the left, or start a fresh test conversation to try the reply loop end-to-end.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}
