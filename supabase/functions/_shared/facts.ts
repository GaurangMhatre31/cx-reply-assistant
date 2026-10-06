import type { OrderFacts, OrderInfo, RetrievedSnippet, WindowCheck } from './types.ts';

const HOUR_MS = 60 * 60 * 1000;
const TIME_ZONE = 'Asia/Kolkata';

export function formatDate(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TIME_ZONE }).format(
    typeof iso === 'string' ? new Date(iso) : iso,
  );
}

function formatMoney(amount: number, currency: string): string {
  return currency === 'INR' ? `₹${amount}` : `${amount} ${currency}`;
}

/**
 * Facts the model must not compute itself. LLMs are unreliable at date
 * arithmetic, and "how long ago was this delivered?" is exactly the fact that
 * decides refund eligibility.
 */
export function computeOrderFacts(order: OrderInfo | null, now: Date): OrderFacts {
  const facts: OrderFacts = { today: formatDate(now) };
  if (!order) return facts;

  const hoursSinceDelivery = order.delivered_at
    ? Math.max(0, Math.floor((now.getTime() - new Date(order.delivered_at).getTime()) / HOUR_MS))
    : null;

  return {
    ...facts,
    order_number: order.order_number,
    order_status: order.status,
    items: order.items.map((i) => `${i.qty} x ${i.name} (${formatMoney(i.price, order.currency)})`).join('; '),
    order_total: formatMoney(Number(order.total_amount), order.currency),
    placed_on: formatDate(order.placed_at),
    delivered_on: order.delivered_at ? formatDate(order.delivered_at) : null,
    hours_since_delivery: hoursSinceDelivery,
    days_since_delivery: hoursSinceDelivery === null ? null : Math.floor(hoursSinceDelivery / 24),
    hours_since_order: Math.max(0, Math.floor((now.getTime() - new Date(order.placed_at).getTime()) / HOUR_MS)),
  };
}

// "within 7 days of delivery", "within 48 hours of delivery",
// "within 24 hours of being placed", "within 15 days from delivery"
const WINDOW_PATTERN =
  /within\s+(\d+)\s*(?:-\s*)?(hours?|days?)\s+(?:of|from|after)\s+(delivery|being placed|placing|ordering|the order|purchase)/gi;

/**
 * Finds time windows in the retrieved policies and checks this order against
 * them. The result is handed to the model as a pre-computed fact AND used by
 * the post-generation guardrail that blocks out-of-window promises.
 */
export function checkPolicyWindows(snippets: RetrievedSnippet[], facts: OrderFacts): WindowCheck[] {
  const checks: WindowCheck[] = [];
  for (const s of snippets) {
    for (const m of s.content.matchAll(WINDOW_PATTERN)) {
      const limit = Number(m[1]);
      const unit: WindowCheck['unit'] = m[2].toLowerCase().startsWith('hour') ? 'hours' : 'days';
      const from: WindowCheck['from'] = m[3].toLowerCase() === 'delivery' ? 'delivery' : 'order';
      const elapsedHours = from === 'delivery' ? facts.hours_since_delivery ?? null : facts.hours_since_order ?? null;
      const limitHours = unit === 'hours' ? limit : limit * 24;
      const within = elapsedHours === null ? null : elapsedHours <= limitHours;
      const elapsed = elapsedHours === null ? null : unit === 'hours' ? elapsedHours : Math.floor(elapsedHours / 24);

      const windowText = `${limit} ${unit} from ${from === 'delivery' ? 'delivery' : 'order placement'}`;
      let description: string;
      if (elapsed === null) {
        description = `${s.label} (${s.title}): ${windowText}. Cannot be checked: ${from === 'delivery' ? 'the order has not been delivered' : 'no order on file'}.`;
      } else {
        description = `${s.label} (${s.title}): ${windowText}. It has been ${elapsed} ${unit} — this order is ${within ? 'WITHIN' : 'OUTSIDE'} the window.`;
      }
      if (!checks.some((c) => c.description === description)) {
        checks.push({ label: s.label, category: s.category, limit, unit, from, elapsed, within, description });
      }
    }
  }
  return checks;
}
