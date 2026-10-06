import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Inbox, Mail, MessageCircle, Plus, Globe } from 'lucide-react';
import { fetchConversations } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { keys, useBrandMap, useBrands, useRealtimeInvalidation } from '../../hooks/queries';
import { Badge, Button, EmptyState, ErrorNote, Spinner, brandTone, cx, inputClass } from '../../components/ui';
import { NewConversationDialog } from './NewConversationDialog';

const CHANNEL_ICON = { whatsapp: MessageCircle, email: Mail, web: Globe };

export function ConversationList({ activeId }: { activeId?: string }) {
  const [brandId, setBrandId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: brands } = useBrands();
  const brandMap = useBrandMap();
  const { data, isLoading, error } = useQuery({
    queryKey: keys.conversations(brandId),
    queryFn: () => fetchConversations(brandId),
  });

  useRealtimeInvalidation('inbox', [{ table: 'conversations', key: ['conversations'] }]);

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="space-y-3 border-b border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Conversations</h2>
          <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            New test chat
          </Button>
        </div>
        <select
          aria-label="Filter by brand"
          className={inputClass}
          value={brandId ?? ''}
          onChange={(e) => setBrandId(e.target.value || null)}
        >
          <option value="">All my brands</option>
          {brands?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {isLoading && <Spinner />}
        {error && <div className="p-3"><ErrorNote error={error} /></div>}
        {data?.length === 0 && <EmptyState icon={<Inbox className="size-8" />} title="No conversations" />}
        <ul>
          {data?.map((c) => {
            const brand = brandMap.get(c.brand_id);
            const ChannelIcon = CHANNEL_ICON[c.channel];
            const awaitingAgent = c.last_message_sender === 'customer';
            return (
              <li key={c.id}>
                <Link
                  to={`/c/${c.id}`}
                  className={cx(
                    'block border-b border-slate-100 px-3 py-3 transition-colors',
                    c.id === activeId ? 'bg-indigo-50/70' : 'hover:bg-slate-50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    {awaitingAgent && <span className="size-2 shrink-0 rounded-full bg-indigo-500" title="Awaiting agent reply" />}
                    <span className={cx('truncate text-sm', awaitingAgent ? 'font-semibold text-slate-900' : 'font-medium text-slate-700')}>
                      {c.customer?.name ?? 'Unknown customer'}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-slate-400">{timeAgo(c.last_message_at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                    {c.last_message_sender === 'agent' && <span className="text-slate-400">You: </span>}
                    {c.last_message_preview ?? 'No messages yet'}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Badge tone={brandTone(brand?.slug)}>{brand?.name ?? '…'}</Badge>
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <ChannelIcon className="size-3.5" />
                      {c.order?.order_number}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <NewConversationDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
