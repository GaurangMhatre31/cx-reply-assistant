import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Headset, Sparkles, User } from 'lucide-react';
import { DraftError, fetchConversation, fetchMessages, fetchPendingDraft, generateReply, sendAgentMessage, sendCustomerMessage } from '../../lib/api';
import { formatTime } from '../../lib/format';
import type { AiGeneration, Message } from '../../lib/types';
import { keys, useBrandMap, useRealtimeInvalidation } from '../../hooks/queries';
import { Badge, Button, EmptyState, ErrorNote, Spinner, brandTone, cx } from '../../components/ui';
import { Composer } from './Composer';
import { ContextPanel } from './ContextPanel';
import { DraftPanel } from './DraftPanel';

type View = 'agent' | 'customer';

export function ConversationView({ conversationId }: { conversationId: string }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const brandMap = useBrandMap();
  const [view, setView] = useState<View>((location.state as { view?: View } | null)?.view ?? 'agent');
  const [draftError, setDraftError] = useState<DraftError | null>(null);

  const conversation = useQuery({ queryKey: keys.conversation(conversationId), queryFn: () => fetchConversation(conversationId) });
  const messages = useQuery({ queryKey: keys.messages(conversationId), queryFn: () => fetchMessages(conversationId) });
  const draft = useQuery({ queryKey: keys.draft(conversationId), queryFn: () => fetchPendingDraft(conversationId) });

  useRealtimeInvalidation(`conversation-${conversationId}`, [
    { table: 'messages', filter: `conversation_id=eq.${conversationId}`, key: keys.messages(conversationId) },
    { table: 'ai_generations', filter: `conversation_id=eq.${conversationId}`, key: keys.draft(conversationId) },
  ]);

  const afterSend = () => {
    queryClient.invalidateQueries({ queryKey: keys.messages(conversationId) });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const sendAgent = useMutation({ mutationFn: (body: string) => sendAgentMessage(conversationId, body), onSuccess: afterSend });
  const sendCustomer = useMutation({ mutationFn: (body: string) => sendCustomerMessage(conversationId, body), onSuccess: afterSend });

  const generate = useMutation({
    mutationFn: () => generateReply(conversationId),
    onMutate: () => setDraftError(null),
    onSuccess: (generation) => queryClient.setQueryData<AiGeneration | null>(keys.draft(conversationId), generation),
    onError: (err) => setDraftError(err instanceof DraftError ? err : new DraftError(String(err), null)),
  });

  const list = messages.data ?? [];
  const last = list.at(-1);
  const lastCustomer = [...list].reverse().find((m) => m.sender_type === 'customer');
  const canGenerate = last?.sender_type === 'customer';

  if (conversation.isLoading) return <Spinner />;
  if (conversation.error) return <div className="p-4"><ErrorNote error={conversation.error} /></div>;
  if (!conversation.data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState title="Conversation not found">It doesn’t exist, or it belongs to a brand you don’t have access to.</EmptyState>
      </div>
    );
  }

  const conv = conversation.data;
  const brand = brandMap.get(conv.brand_id);

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <Link to="/" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Back to inbox">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold text-slate-900">{conv.customer?.name}</h1>
              <Badge tone={brandTone(brand?.slug)}>{brand?.name}</Badge>
            </div>
            <p className="text-xs text-slate-500">
              {conv.order?.order_number} · via {conv.channel === 'web' ? 'web chat' : conv.channel}
            </p>
          </div>

          <ViewToggle view={view} onChange={setView} />
        </div>

        {/* Messages */}
        <MessageList messages={list} view={view} loading={messages.isLoading} customerName={conv.customer?.name ?? 'Customer'} />

        {/* Bottom area */}
        {view === 'agent' ? (
          <div className="space-y-3 border-t border-slate-200 bg-white p-3">
            {generate.isPending && <GeneratingNotice brandName={brand?.name} />}
            {!generate.isPending && draftError && (
              <div className="space-y-2">
                <ErrorNote error={draftError} />
              </div>
            )}
            {!generate.isPending && draft.data && (
              <DraftPanel
                key={draft.data.id}
                draft={draft.data}
                stale={Boolean(lastCustomer && draft.data.customer_message_id && lastCustomer.id !== draft.data.customer_message_id)}
                onRegenerate={() => generate.mutate()}
                onDone={() => {
                  queryClient.setQueryData(keys.draft(conversationId), null);
                  afterSend();
                }}
              />
            )}
            <Composer
              key="agent"
              placeholder={`Reply to ${conv.customer?.name?.split(' ')[0] ?? 'the customer'} manually…`}
              sendLabel="Send"
              onSend={(body) => sendAgent.mutateAsync(body)}
              error={sendAgent.error}
              extra={
                !draft.data && (
                  <Button
                    variant="primary"
                    icon={<Sparkles className="size-4" />}
                    loading={generate.isPending}
                    disabled={!canGenerate}
                    title={canGenerate ? 'Draft a reply using this brand’s knowledge base' : 'The latest message is from the agent — nothing to reply to yet'}
                    onClick={() => generate.mutate()}
                  >
                    Generate reply
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="space-y-2 border-t border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-xs text-emerald-800">
              <strong>Customer simulator.</strong> Messages you send here arrive in the agent inbox exactly like an incoming
              WhatsApp/email message would. Switch to <em>Agent</em> to draft the reply.
            </p>
            <Composer
              key="customer"
              placeholder={`Type as ${conv.customer?.name ?? 'the customer'}…`}
              sendLabel="Send as customer"
              tone="customer"
              onSend={(body) => sendCustomer.mutateAsync(body)}
              error={sendCustomer.error}
            />
          </div>
        )}
      </div>

      <ContextPanel conversation={conv} brand={brand} />
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const options: Array<{ value: View; label: string; icon: typeof User }> = [
    { value: 'agent', label: 'Agent', icon: Headset },
    { value: 'customer', label: 'Customer', icon: User },
  ];
  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="hidden text-xs text-slate-500 lg:inline">Acting as</span>
      <div role="radiogroup" aria-label="Acting as" className="flex rounded-lg bg-slate-100 p-0.5">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            role="radio"
            aria-checked={view === value}
            onClick={() => onChange(value)}
            className={cx(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              view === value
                ? value === 'agent'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageList({ messages, view, loading, customerName }: { messages: Message[]; view: View; loading: boolean; customerName: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, view]);

  return (
    <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
      {loading && <Spinner />}
      {!loading && messages.length === 0 && (
        <EmptyState title="No messages yet">
          {view === 'customer' ? 'Send the first message as the customer.' : 'Switch to the Customer side to send the first message.'}
        </EmptyState>
      )}
      {messages.map((m) => {
        const mine = view === 'agent' ? m.sender_type === 'agent' : m.sender_type === 'customer';
        return (
          <div key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
            <div className="max-w-[78%] space-y-1">
              <div
                className={cx(
                  'whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm shadow-xs',
                  m.sender_type === 'agent' && 'bg-indigo-600 text-white',
                  m.sender_type === 'customer' && (view === 'customer' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-200'),
                  m.sender_type === 'system' && 'bg-slate-200 text-slate-600',
                  mine ? 'rounded-br-md' : 'rounded-bl-md',
                )}
              >
                {m.body}
              </div>
              <div className={cx('flex items-center gap-1.5 px-1 text-[11px] text-slate-400', mine && 'justify-end')}>
                <span>{m.sender_type === 'customer' ? customerName : m.sender_type === 'agent' ? 'Agent' : 'System'}</span>
                <span>·</span>
                <span>{formatTime(m.created_at)}</span>
                {m.ai_generation_id && (
                  <span className="flex items-center gap-0.5 text-indigo-400" title="Sent from an approved AI draft">
                    <Sparkles className="size-3" /> AI-assisted
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function GeneratingNotice({ brandName }: { brandName?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-800 ring-1 ring-inset ring-indigo-200">
      <Sparkles className="size-4 animate-pulse" />
      Searching {brandName ? `${brandName}’s` : 'the'} knowledge base and drafting a reply…
    </div>
  );
}
