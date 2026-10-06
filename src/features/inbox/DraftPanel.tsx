import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Check, ChevronDown, CircleCheck, CircleHelp, RefreshCw, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { approveDraft, discardDraft } from '../../lib/api';
import { CATEGORY_LABELS, FLAG_LABELS, STATUS_META } from '../../lib/format';
import type { AiGeneration } from '../../lib/types';
import { Badge, Button, ErrorNote, StatusBadge, cx } from '../../components/ui';

const STATUS_STYLE = {
  grounded: 'border-emerald-200 bg-emerald-50/50',
  needs_review: 'border-amber-300 bg-amber-50/60',
  no_knowledge: 'border-rose-300 bg-rose-50/60',
  error: 'border-slate-300 bg-slate-50',
} as const;

const STATUS_ICON = {
  grounded: <CircleCheck className="size-4 text-emerald-600" />,
  needs_review: <AlertTriangle className="size-4 text-amber-600" />,
  no_knowledge: <CircleHelp className="size-4 text-rose-600" />,
  error: <AlertTriangle className="size-4 text-slate-500" />,
} as const;

export function DraftPanel({
  draft,
  stale,
  onRegenerate,
  onDone,
}: {
  draft: AiGeneration;
  stale: boolean;
  onRegenerate: () => void;
  onDone: () => void;
}) {
  const original = draft.ai_response ?? '';
  const [text, setText] = useState(original);
  const [showContext, setShowContext] = useState(draft.grounding_status !== 'grounded');
  const edited = text.trim() !== original.trim();
  const meta = STATUS_META[draft.grounding_status];
  const flags = draft.guardrail_flags.filter((f) => f !== 'no_knowledge_retrieved' || draft.grounding_status !== 'no_knowledge');
  const checks = draft.order_facts?.eligibility_checks ?? [];

  const approve = useMutation({ mutationFn: () => approveDraft(draft.id, text), onSuccess: onDone });
  const discard = useMutation({ mutationFn: () => discardDraft(draft.id, text), onSuccess: onDone });

  return (
    <div className={cx('overflow-hidden rounded-xl border', STATUS_STYLE[draft.grounding_status])}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
        <Sparkles className="size-4 text-indigo-500" />
        <span className="text-sm font-semibold text-slate-900">AI draft</span>
        <StatusBadge status={draft.grounding_status} />
        {draft.confidence !== null && (
          <span className="text-xs text-slate-500" title="Self-reported by the model; used only as one signal among the automated checks">
            model confidence {Math.round(draft.confidence * 100)}%
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={onRegenerate} disabled={approve.isPending}>
            Regenerate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            loading={discard.isPending}
            onClick={() => discard.mutate()}
            disabled={approve.isPending}
          >
            Discard
          </Button>
        </div>
      </div>

      {/* Why this status */}
      <div className="space-y-1.5 px-3.5 pt-2 text-sm">
        <p className="flex gap-2 text-slate-700">
          <span className="mt-0.5 shrink-0">{STATUS_ICON[draft.grounding_status]}</span>
          {meta.help}
        </p>
        {flags.length > 0 && (
          <ul className="ml-6 list-disc space-y-0.5 text-xs text-slate-600">
            {flags.map((f) => (
              <li key={f}>{FLAG_LABELS[f] ?? f}</li>
            ))}
          </ul>
        )}
        {draft.missing_info && (
          <p className="ml-6 text-xs text-slate-600">
            <span className="font-medium">AI note:</span> {draft.missing_info}
          </p>
        )}
        {stale && (
          <p className="ml-6 text-xs font-medium text-amber-700">
            The customer has sent a newer message since this draft was generated. Regenerate to take it into account.
          </p>
        )}
      </div>

      {/* Editable draft */}
      <div className="px-3.5 pt-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.min(8, Math.max(3, Math.ceil(text.length / 80)))}
          aria-label="AI draft (editable)"
          className="scroll-thin block w-full resize-y rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
        />
      </div>

      {/* Knowledge used */}
      <div className="px-3.5 pt-2">
        <button
          onClick={() => setShowContext((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          aria-expanded={showContext}
        >
          <BookOpen className="size-3.5" />
          Knowledge used ({draft.retrieved_context.length})
          <ChevronDown className={cx('size-3.5 transition-transform', showContext && 'rotate-180')} />
        </button>
        {showContext && (
          <div className="mt-2 space-y-2">
            {draft.retrieved_context.length === 0 && (
              <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
                Nothing in this brand’s knowledge base matched the customer’s message.
              </p>
            )}
            {draft.retrieved_context.map((entry) => {
              const cited = draft.cited_entry_ids.includes(entry.id);
              return (
                <div key={entry.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-800">{entry.title}</span>
                    <Badge>{CATEGORY_LABELS[entry.category] ?? entry.category}</Badge>
                    {cited ? <Badge tone="green">cited</Badge> : <Badge tone="slate">retrieved, not cited</Badge>}
                    <span className="ml-auto text-[11px] text-slate-400">relevance {entry.score.toFixed(2)}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{entry.content}</p>
                </div>
              );
            })}
            {checks.length > 0 && (
              <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                <p className="text-xs font-semibold text-slate-800">Eligibility checks (computed in code, not by the AI)</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {checks.map((c) => (
                    <li key={c}>{c.replace(/^P\d+ \((.*?)\):/, '$1:')}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 bg-white/60 px-3.5 py-2.5">
        <ErrorNote error={approve.error ?? discard.error} />
        <span className="text-[11px] text-slate-400">
          {[
            draft.model,
            draft.latency_ms !== null && `${(draft.latency_ms / 1000).toFixed(1)}s`,
            draft.prompt_tokens !== null && `${draft.prompt_tokens + (draft.completion_tokens ?? 0)} tokens`,
            draft.cost_usd !== null && `$${Number(draft.cost_usd).toFixed(4)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {edited && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setText(original)}>
              Reset to AI version
            </Button>
          )}
          <Button
            variant="success"
            icon={<Check className="size-4" />}
            loading={approve.isPending}
            disabled={!text.trim() || discard.isPending}
            onClick={() => approve.mutate()}
          >
            {edited ? 'Approve edited reply & send' : 'Approve & send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
