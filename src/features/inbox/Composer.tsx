import { useState, type ReactNode } from 'react';
import { Send } from 'lucide-react';
import { Button, ErrorNote, cx } from '../../components/ui';

export function Composer({
  placeholder,
  sendLabel,
  onSend,
  error,
  extra,
  tone = 'agent',
}: {
  placeholder: string;
  sendLabel: string;
  onSend: (body: string) => Promise<unknown>;
  error?: unknown;
  extra?: ReactNode;
  tone?: 'agent' | 'customer';
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function submit() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setText('');
    } catch {
      // the error is rendered from the mutation state; keep the text so nothing is lost
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
      <ErrorNote error={error} />
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={text}
          maxLength={4000}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className={cx(
            'scroll-thin block min-h-[2.75rem] flex-1 resize-y rounded-xl border-0 bg-white px-3 py-2 text-sm shadow-xs ring-1 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-inset',
            tone === 'agent' ? 'ring-slate-300 focus:ring-indigo-600' : 'ring-emerald-300 focus:ring-emerald-600',
          )}
        />
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {extra}
          <Button
            variant={tone === 'customer' ? 'success' : 'secondary'}
            icon={<Send className="size-4" />}
            loading={sending}
            disabled={!text.trim()}
            onClick={() => void submit()}
          >
            {sendLabel}
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">Enter to send · Shift+Enter for a new line</p>
    </div>
  );
}
