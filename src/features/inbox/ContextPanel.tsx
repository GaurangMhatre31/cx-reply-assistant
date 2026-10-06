import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BookOpen, Mail, Package, Phone, Store, User } from 'lucide-react';
import { daysSince, formatDate, money } from '../../lib/format';
import type { Brand, ConversationDetail } from '../../lib/types';
import { Badge, type Tone } from '../../components/ui';

const ORDER_TONE: Record<string, Tone> = {
  placed: 'slate',
  dispatched: 'sky',
  delivered: 'green',
  cancelled: 'red',
  returned: 'amber',
};

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-slate-100 px-4 py-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{children}</span>
    </div>
  );
}

export function ContextPanel({ conversation, brand }: { conversation: ConversationDetail; brand?: Brand }) {
  const { customer, order } = conversation;

  return (
    <aside className="scroll-thin hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white xl:block">
      <Section icon={<User className="size-3.5" />} title="Customer">
        <p className="text-sm font-semibold text-slate-900">{customer?.name}</p>
        {customer?.phone && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Phone className="size-3.5 text-slate-400" /> {customer.phone}
          </p>
        )}
        {customer?.email && (
          <p className="flex items-center gap-2 truncate text-sm text-slate-600">
            <Mail className="size-3.5 shrink-0 text-slate-400" /> {customer.email}
          </p>
        )}
      </Section>

      <Section icon={<Package className="size-3.5" />} title="Order">
        {order ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">{order.order_number}</span>
              <Badge tone={ORDER_TONE[order.status] ?? 'slate'}>{order.status}</Badge>
            </div>
            <ul className="space-y-1.5">
              {order.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-3 text-sm">
                  <span className="text-slate-600">
                    {item.qty} × {item.name}
                  </span>
                  <span className="shrink-0 text-slate-500">{money(item.price * item.qty, order.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
              <Row label="Total">{money(Number(order.total_amount), order.currency)}</Row>
              <Row label="Placed">{formatDate(order.placed_at)}</Row>
              <Row label="Delivered">
                {order.delivered_at ? (
                  <>
                    {formatDate(order.delivered_at)}
                    <span className="block text-xs font-normal text-slate-500">
                      {daysSince(order.delivered_at) === 0 ? 'today' : `${daysSince(order.delivered_at)} days ago`}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400">Not yet</span>
                )}
              </Row>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">No order linked.</p>
        )}
      </Section>

      <Section icon={<Store className="size-3.5" />} title="Brand">
        <p className="text-sm font-semibold text-slate-900">{brand?.name}</p>
        {brand?.support_email && <p className="text-sm text-slate-600">{brand.support_email}</p>}
        <p className="text-xs leading-relaxed text-slate-500">{brand?.tone}</p>
        <Link
          to={`/knowledge?brand=${conversation.brand_id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          <BookOpen className="size-4" /> View {brand?.name} policies
        </Link>
      </Section>
    </aside>
  );
}
