import { Fragment, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ScrollText } from 'lucide-react';
import { fetchGenerations, type GenerationLogRow } from '../lib/api';
import { FLAG_LABELS, OUTCOME_LABELS, STATUS_META, formatDateTime } from '../lib/format';
import type { GroundingStatus } from '../lib/types';
import { keys, useBrandMap, useBrands } from '../hooks/queries';
import { Badge, EmptyState, ErrorNote, Spinner, StatusBadge, brandTone, cx, inputClass } from '../components/ui';

export function LogsPage() {
  const [brandId, setBrandId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { data: brands } = useBrands();
  const brandMap = useBrandMap();
  const { data, isLoading, error } = useQuery({
    queryKey: keys.generations(brandId, status),
    queryFn: () => fetchGenerations({ brandId, status }),
  });

  const rows = data ?? [];
  const decided = rows.filter((r) => r.outcome === 'approved' || r.outcome === 'approved_with_edits' || r.outcome === 'discarded');
  const sentAsIs = decided.filter((r) => r.outcome === 'approved').length;
  const cost = rows.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  const avgLatency = rows.length ? rows.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / rows.length : 0;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">AI generation log</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every draft: the customer message, the knowledge retrieved, what the AI wrote, what the agent changed, and what was sent.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Drafts generated" value={rows.length} />
          <Stat
            label="Sent without edits"
            value={decided.length ? `${Math.round((sentAsIs / decided.length) * 100)}%` : '—'}
            hint={`${sentAsIs} of ${decided.length} decided drafts`}
          />
          <Stat label="Avg. latency" value={rows.length ? `${(avgLatency / 1000).toFixed(1)}s` : '—'} />
          <Stat label="AI cost (shown)" value={`$${cost.toFixed(4)}`} />
        </div>

        <div className="grid gap-3 sm:grid-cols-[14rem_14rem]">
          <select aria-label="Brand" className={inputClass} value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value || null)}>
            <option value="">All brands</option>
            {brands?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select aria-label="Status" className={inputClass} value={status ?? ''} onChange={(e) => setStatus(e.target.value || null)}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_META) as GroundingStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>

        <ErrorNote error={error} />
        {isLoading && <Spinner />}
        {!isLoading && rows.length === 0 && (
          <EmptyState icon={<ScrollText className="size-8" />} title="No drafts yet">
            Generate a reply from the inbox and it will appear here.
          </EmptyState>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl bg-white shadow-xs ring-1 ring-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Brand</th>
                  <th className="px-3 py-2.5 font-medium">Customer message</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const brand = brandMap.get(r.brand_id);
                  const expanded = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(expanded ? null : r.id)}>
                        <td className="px-3 py-2.5 text-slate-400">
                          <ChevronRight className={cx('size-4 transition-transform', expanded && 'rotate-90')} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDateTime(r.created_at)}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={brandTone(brand?.slug)}>{brand?.name ?? '…'}</Badge>
                        </td>
                        <td className="max-w-md px-3 py-2.5">
                          <span className="font-medium text-slate-700">{r.conversation?.customer?.name}: </span>
                          <span className="line-clamp-1 text-slate-600">{r.customer_message}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={r.grounding_status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{OUTCOME_LABELS[r.outcome]}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50/70 px-4 py-4">
                            <LogDetail row={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3 shadow-xs ring-1 ring-slate-200">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

function TextBox({ text, empty = '—' }: { text: string | null; empty?: string }) {
  return (
    <p className={cx('whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200', text ? 'text-slate-700' : 'text-slate-400')}>
      {text || empty}
    </p>
  );
}

function LogDetail({ row }: { row: GenerationLogRow }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <Block title="Customer message">
          <TextBox text={row.customer_message} />
        </Block>
        <Block title={`Retrieved knowledge (${row.retrieved_context.length})`}>
          {row.retrieved_context.length === 0 && <TextBox text={null} empty="Nothing relevant found in the knowledge base." />}
          {row.retrieved_context.map((e) => (
            <div key={e.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-800">{e.title}</span>
                {row.cited_entry_ids.includes(e.id) && <Badge tone="green">cited</Badge>}
                <span className="ml-auto text-slate-400">score {e.score}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{e.content}</p>
            </div>
          ))}
        </Block>
        {(row.order_facts?.eligibility_checks?.length ?? 0) > 0 && (
          <Block title="Eligibility checks">
            <ul className="space-y-0.5 text-xs text-slate-600">
              {row.order_facts!.eligibility_checks!.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Block>
        )}
      </div>
      <div className="space-y-4">
        <Block title="AI-generated response">
          <TextBox text={row.ai_response} empty={row.error ?? 'No response'} />
        </Block>
        <Block title="Agent-edited response">
          <TextBox text={row.agent_edited_response} empty="Not edited" />
        </Block>
        <Block title="Final response sent">
          <TextBox text={row.final_response} empty={OUTCOME_LABELS[row.outcome]} />
        </Block>
        {row.guardrail_flags.length > 0 && (
          <Block title="Guardrail flags">
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
              {row.guardrail_flags.map((f) => (
                <li key={f}>{FLAG_LABELS[f] ?? f}</li>
              ))}
            </ul>
          </Block>
        )}
        <Block title="Metadata">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
            <dt className="text-slate-400">Generated</dt>
            <dd>{formatDateTime(row.created_at)}</dd>
            <dt className="text-slate-400">Decided</dt>
            <dd>{row.decided_at ? formatDateTime(row.decided_at) : '—'}</dd>
            <dt className="text-slate-400">Model</dt>
            <dd>{row.model ?? '—'}</dd>
            <dt className="text-slate-400">Prompt version</dt>
            <dd>{row.prompt_version}</dd>
            <dt className="text-slate-400">Confidence</dt>
            <dd>{row.confidence !== null ? `${Math.round(Number(row.confidence) * 100)}%` : '—'}</dd>
            <dt className="text-slate-400">Tokens (in / out)</dt>
            <dd>
              {row.prompt_tokens ?? '—'} / {row.completion_tokens ?? '—'}
            </dd>
            <dt className="text-slate-400">Latency</dt>
            <dd>{row.latency_ms !== null ? `${row.latency_ms} ms` : '—'}</dd>
            <dt className="text-slate-400">Cost</dt>
            <dd>{row.cost_usd !== null ? `$${Number(row.cost_usd).toFixed(5)}` : '—'}</dd>
          </dl>
        </Block>
      </div>
    </div>
  );
}
