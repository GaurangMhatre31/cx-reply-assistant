import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOrders, startTestConversation } from '../../lib/api';
import { keys, useBrandMap } from '../../hooks/queries';
import { Button, ErrorNote, Field, Modal, inputClass } from '../../components/ui';

/**
 * Opens a clean conversation for an existing mock order, then lands on the
 * Customer view so the reviewer can type the first message as the customer.
 */
export function NewConversationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const brandMap = useBrandMap();
  const [orderId, setOrderId] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const { data: orders } = useQuery({ queryKey: keys.orders, queryFn: fetchOrders, enabled: open });

  const start = useMutation({
    mutationFn: () => startTestConversation(orderId, channel),
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onClose();
      navigate(`/c/${conv.id}`, { state: { view: 'customer' } });
    },
  });

  const grouped = [...brandMap.values()].map((brand) => ({
    brand,
    orders: (orders ?? []).filter((o) => o.brand_id === brand.id),
  }));

  return (
    <Modal open={open} title="Start a test conversation" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start.mutate();
        }}
      >
        <p className="text-sm text-slate-600">
          Opens an empty conversation for one of the mock orders. You’ll land on the <strong>Customer</strong> side to send the
          first message, then switch to <strong>Agent</strong> to draft the reply.
        </p>
        <Field label="Customer & order" hint="The brand is taken from the order, never chosen separately.">
          <select className={inputClass} value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
            <option value="" disabled>
              Select an order…
            </option>
            {grouped.map(({ brand, orders }) => (
              <optgroup key={brand.id} label={brand.name}>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.customer?.name} · {o.order_number} · {o.status}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Channel">
          <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="web">Web chat</option>
          </select>
        </Field>
        <ErrorNote error={start.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={start.isPending} disabled={!orderId}>
            Start conversation
          </Button>
        </div>
      </form>
    </Modal>
  );
}
