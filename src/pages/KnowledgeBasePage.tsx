import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { createKbEntry, deleteKbEntry, fetchKbEntries, updateKbEntry } from '../lib/api';
import { CATEGORY_LABELS, formatDateTime } from '../lib/format';
import type { KbCategory, KbEntry, KbEntryInput } from '../lib/types';
import { keys, useBrands, useMemberships } from '../hooks/queries';
import { Badge, Button, EmptyState, ErrorNote, Field, Modal, Spinner, brandTone, cx, inputClass } from '../components/ui';

const CATEGORIES = Object.keys(CATEGORY_LABELS) as KbCategory[];

export function KnowledgeBasePage() {
  const [params, setParams] = useSearchParams();
  const { data: brands, isLoading } = useBrands();
  const { data: memberships } = useMemberships();
  const brandId = params.get('brand') ?? brands?.[0]?.id ?? null;
  const brand = brands?.find((b) => b.id === brandId);
  const isAdmin = memberships?.some((m) => m.brand_id === brandId && m.role === 'admin') ?? false;

  const [editing, setEditing] = useState<KbEntry | 'new' | null>(null);
  const queryClient = useQueryClient();
  const entries = useQuery({ queryKey: keys.kb(brandId ?? ''), queryFn: () => fetchKbEntries(brandId!), enabled: Boolean(brandId) });

  const remove = useMutation({
    mutationFn: deleteKbEntry,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.kb(brandId ?? '') }),
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Knowledge base</h1>
            <p className="mt-1 text-sm text-slate-500">
              The only source the AI may use when drafting replies for a brand. Changes apply to the very next draft.
            </p>
          </div>
          {isAdmin ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add entry
            </Button>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-slate-500">
              <Lock className="size-4" /> Read-only: you are not an admin of this brand
            </span>
          )}
        </div>

        <div role="tablist" aria-label="Brand" className="flex flex-wrap gap-2">
          {brands?.map((b) => (
            <button
              key={b.id}
              role="tab"
              aria-selected={b.id === brandId}
              onClick={() => setParams({ brand: b.id })}
              className={cx(
                'rounded-full px-4 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors',
                b.id === brandId ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300',
              )}
            >
              {b.name}
            </button>
          ))}
        </div>

        <ErrorNote error={entries.error ?? remove.error} />
        {entries.isLoading && <Spinner />}
        {entries.data?.length === 0 && (
          <EmptyState icon={<BookOpen className="size-8" />} title={`No entries for ${brand?.name}`}>
            Without entries, every AI draft for this brand will be marked “No policy found”.
          </EmptyState>
        )}

        <ul className="space-y-3">
          {entries.data?.map((entry) => (
            <li key={entry.id} className={cx('rounded-xl bg-white p-4 shadow-xs ring-1 ring-slate-200', !entry.is_active && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">{entry.title}</h2>
                <Badge tone={brandTone(entry.category)}>{CATEGORY_LABELS[entry.category]}</Badge>
                {!entry.is_active && <Badge tone="slate">inactive: not used by the AI</Badge>}
                {isAdmin && (
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(entry)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-3.5" />}
                      loading={remove.isPending && remove.variables === entry.id}
                      onClick={() => {
                        if (confirm(`Delete “${entry.title}”? The AI will stop using it immediately.`)) remove.mutate(entry.id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{entry.content}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                {entry.keywords && <span>Customer phrasings: {entry.keywords}</span>}
                <span className="ml-auto">Updated {formatDateTime(entry.updated_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {brandId && (
        <KbEntryDialog
          key={editing === 'new' ? 'new' : editing?.id ?? 'closed'}
          brandId={brandId}
          brandName={brand?.name ?? ''}
          entry={editing === 'new' ? null : editing}
          open={editing !== null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function KbEntryDialog({
  brandId,
  brandName,
  entry,
  open,
  onClose,
}: {
  brandId: string;
  brandName: string;
  entry: KbEntry | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<KbEntryInput>({
    brand_id: brandId,
    category: entry?.category ?? 'general',
    title: entry?.title ?? '',
    content: entry?.content ?? '',
    keywords: entry?.keywords ?? '',
    is_active: entry?.is_active ?? true,
  });
  const set = <K extends keyof KbEntryInput>(key: K, value: KbEntryInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, title: form.title.trim(), content: form.content.trim(), keywords: form.keywords.trim() };
      return entry ? updateKbEntry(entry.id, payload) : createKbEntry(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.kb(brandId) });
      onClose();
    },
  });

  return (
    <Modal open={open} title={`${entry ? 'Edit' : 'New'} entry · ${brandName}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <input className={inputClass} value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} required />
          </Field>
          <Field label="Category">
            <select className={inputClass} value={form.category} onChange={(e) => set('category', e.target.value as KbCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Policy text" hint="Write it as you want agents and the AI to apply it. Time limits like “within 7 days of delivery” are checked automatically against the order.">
          <textarea
            className={cx(inputClass, 'min-h-40 resize-y')}
            value={form.content}
            onChange={(e) => set('content', e.target.value)}
            maxLength={5000}
            required
          />
        </Field>
        <Field label="Customer phrasings (optional)" hint="Words customers use for this topic, comma-separated, e.g. “broken, cracked, leaking”. Improves retrieval.">
          <input className={inputClass} value={form.keywords} onChange={(e) => set('keywords', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="size-4 rounded border-slate-300 text-indigo-600" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Active (used by the AI)
        </label>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {entry ? 'Save changes' : 'Create entry'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
