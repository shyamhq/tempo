'use client';

import type { DiscussionMessage, Question } from '@tempo/contracts';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useWorkerApi } from '@/hooks/use-worker-api';
import { MarkdownText } from '../markdown-text';
import { formatTime } from './message-list';

type Draft =
  | { type: 'single_choice'; choice: string | null; custom: string }
  | { type: 'multi_choice'; choices: Set<string>; custom: string }
  | { type: 'open_text'; text: string };

type DraftMap = Record<string, Draft>;

function initDraft(questions: Question[]): DraftMap {
  const out: DraftMap = {};
  for (const q of questions) {
    if (q.type === 'single_choice') out[q.id] = { type: 'single_choice', choice: null, custom: '' };
    else if (q.type === 'multi_choice')
      out[q.id] = { type: 'multi_choice', choices: new Set(), custom: '' };
    else out[q.id] = { type: 'open_text', text: '' };
  }
  return out;
}

function answerLabel(q: Question, d: Draft): string | null {
  if (q.type === 'open_text' && d.type === 'open_text') {
    const v = d.text.trim();
    return v.length > 0 ? v : null;
  }
  if (q.type === 'single_choice' && d.type === 'single_choice') {
    const v = d.custom.trim();
    if (v) return v;
    return d.choice;
  }
  if (q.type === 'multi_choice' && d.type === 'multi_choice') {
    const all: string[] = [...d.choices];
    const v = d.custom.trim();
    if (v) all.push(v);
    return all.length > 0 ? all.join(', ') : null;
  }
  return null;
}

const isAnswered = (q: Question, d: Draft): boolean => answerLabel(q, d) !== null;

// Wire format: `**<prompt>**\n→ <answer>` blocks separated by blank lines.
// Skipped questions emit `→ _Skipped_` so the Agent sees the intentional
// non-answer rather than guessing from absence.
function toMarkdown(questions: Question[], draft: DraftMap, skipped: Set<number>): string {
  const blocks: string[] = [];
  questions.forEach((q, i) => {
    const d = draft[q.id];
    if (!d) return;
    const ans = skipped.has(i) ? '_Skipped_' : answerLabel(q, d);
    if (ans === null) return;
    blocks.push(`**${q.prompt}**\n→ ${ans}`);
  });
  return blocks.join('\n\n');
}

export function LiveQuestionCard({
  message,
  threadId,
}: {
  message: DiscussionMessage;
  threadId: string;
}) {
  const questions = message.questions ?? [];
  return (
    <div className="space-y-3">
      {message.text ? (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="inline-flex items-center gap-1.5 text-micro-uppercase uppercase text-accent-deep">
              <span aria-hidden className="size-[5px] rounded-full bg-current" />
              Agent
            </span>
            <span aria-hidden className="text-micro font-normal text-ink-tertiary tabular-nums">
              ·
            </span>
            <time
              dateTime={message.created_at}
              className="text-micro font-normal text-ink-tertiary tabular-nums"
              suppressHydrationWarning // locale-dependent time differs server vs client
            >
              {formatTime(message.created_at)}
            </time>
          </div>
          <div className="text-body-sm leading-[1.6] text-ink">
            <MarkdownText text={message.text} />
          </div>
        </div>
      ) : null}
      <Stepper questions={questions} threadId={threadId} />
    </div>
  );
}

function Stepper({ questions, threadId }: { questions: Question[]; threadId: string }) {
  const wApi = useWorkerApi();
  const total = questions.length;
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<DraftMap>(() => initDraft(questions));
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = questions[step];
  if (!q) return null;
  const d = draft[q.id];
  if (!d) return null;
  const answered = isAnswered(q, d);
  const isLast = step === total - 1;

  const update = (next: Draft) => {
    setDraft((prev) => ({ ...prev, [q.id]: next }));
    setSkipped((prev) => {
      if (!prev.has(step)) return prev;
      const c = new Set(prev);
      c.delete(step);
      return c;
    });
  };

  const advance = () => {
    if (submitting) return;
    setStep((s) => Math.min(s + 1, total - 1));
  };
  const back = () => {
    if (submitting) return;
    setStep((s) => Math.max(s - 1, 0));
  };
  const skip = () => {
    if (submitting) return;
    setSkipped((prev) => new Set(prev).add(step));
    if (isLast) void submit({ markCurrentSkipped: true });
    else advance();
  };

  async function submit(opts: { markCurrentSkipped?: boolean } = {}) {
    if (submitting) return;
    const finalSkipped = opts.markCurrentSkipped ? new Set(skipped).add(step) : skipped;
    const text = toMarkdown(questions, draft, finalSkipped);
    if (text.trim().length === 0) {
      setError('Answer or skip at least one question.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await wApi.postDiscussionMessage(threadId, { text });
      // No further UI work — when the new Dev message lands via SSE, the
      // liveCard derivation flips and this card unmounts automatically.
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : 'Submit failed.');
    }
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface-1 shadow-1 overflow-hidden">
      <div className="flex items-center gap-2 px-[15px] py-[13px] border-b border-hairline bg-surface-2">
        <Sparkles className="size-icon-sm text-accent shrink-0" />
        <span className="flex-1 text-micro-uppercase uppercase text-ink-subtle">
          Agent questions
        </span>
        <span className="text-micro-uppercase uppercase font-mono text-ink-subtle bg-surface-3 px-2 py-[3px] rounded-full tabular-nums">
          {step + 1}/{total}
        </span>
      </div>

      <div className="flex gap-1.5 px-[15px] pt-[14px]">
        {questions.map((p, i) => (
          <span
            key={p.id}
            className={`flex-1 h-1 rounded-full transition-colors ${
              i < step ? 'bg-accent' : i === step ? 'bg-accent/40' : 'bg-hairline'
            }`}
          />
        ))}
      </div>

      <div className="px-[15px] pt-[11px] text-micro-uppercase uppercase text-ink-subtle">
        Question {step + 1} of {total}
      </div>

      <div className="px-[15px] pt-[10px] pb-1">
        <div className="mb-[11px]">
          <p id={`q-${q.id}-prompt`} className="text-body-md font-semibold text-ink leading-[1.4]">
            {q.prompt}
          </p>
        </div>

        {q.type === 'open_text' && d.type === 'open_text' ? (
          <textarea
            className="w-full rounded-md border border-hairline bg-surface-1 px-3 py-2.5 text-body-sm leading-[1.55] text-ink resize-y min-h-[64px] outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-[3px] focus:ring-accent/15 placeholder:text-ink-tertiary"
            placeholder="Type your answer…"
            value={d.text}
            onChange={(e) => update({ type: 'open_text', text: e.target.value })}
          />
        ) : null}

        {q.type === 'single_choice' && d.type === 'single_choice' ? (
          // biome-ignore lint/a11y/useSemanticElements: native fieldset would require restyling; role=radiogroup wraps role=radio buttons per WAI-ARIA.
          <div role="radiogroup" aria-labelledby={`q-${q.id}-prompt`} className="space-y-2">
            {q.options.map((opt) => (
              <OptionRow
                key={opt}
                label={opt}
                kind="radio"
                selected={d.choice === opt && !d.custom}
                onClick={() => update({ ...d, choice: opt, custom: '' })}
              />
            ))}
            {q.allow_other ? (
              <CustomInput
                value={d.custom}
                onChange={(v) =>
                  update({ ...d, custom: v, choice: v.length > 0 ? null : d.choice })
                }
              />
            ) : null}
          </div>
        ) : null}

        {q.type === 'multi_choice' && d.type === 'multi_choice' ? (
          <div role="group" aria-labelledby={`q-${q.id}-prompt`} className="space-y-2">
            {q.options.map((opt) => (
              <OptionRow
                key={opt}
                label={opt}
                kind="check"
                selected={d.choices.has(opt)}
                onClick={() => {
                  const next = new Set(d.choices);
                  if (next.has(opt)) next.delete(opt);
                  else next.add(opt);
                  update({ ...d, choices: next });
                }}
              />
            ))}
            {q.allow_other ? (
              <CustomInput value={d.custom} onChange={(v) => update({ ...d, custom: v })} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 px-[15px] py-[14px]">
        {step > 0 ? (
          <button
            type="button"
            onClick={back}
            disabled={submitting}
            className="h-9 px-3 rounded-md text-body-sm font-medium text-ink-subtle hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-50"
          >
            ← Back
          </button>
        ) : (
          <span />
        )}
        <span className="flex-1">
          {error ? <span className="text-micro font-normal text-danger">{error}</span> : null}
        </span>
        <button
          type="button"
          onClick={skip}
          disabled={submitting}
          className="h-9 px-3 rounded-md text-body-sm font-medium text-ink-subtle hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => (isLast ? void submit() : advance())}
          disabled={(!answered && !skipped.has(step)) || submitting}
          className="h-9 px-[18px] rounded-full bg-primary text-on-primary text-body-sm font-medium hover:bg-primary-hover transition-colors disabled:bg-surface-3 disabled:text-ink-tertiary disabled:cursor-not-allowed whitespace-nowrap"
        >
          {submitting ? 'Submitting…' : isLast ? 'Submit answers' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

function OptionRow({
  label,
  kind,
  selected,
  onClick,
}: {
  label: string;
  kind: 'check' | 'radio';
  selected: boolean;
  onClick: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is set dynamically to checkbox|radio; aria-checked is valid for both.
    <button
      type="button"
      onClick={onClick}
      aria-checked={selected}
      role={kind === 'check' ? 'checkbox' : 'radio'}
      className={`w-full flex items-start gap-[11px] text-left px-[13px] py-3 rounded-md border transition-[border-color,background-color] ${
        selected
          ? 'border-accent bg-accent/10'
          : 'border-hairline bg-surface-1 hover:border-hairline-strong'
      } focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/15 focus-visible:border-accent`}
    >
      <Control kind={kind} selected={selected} />
      <span className="flex-1 min-w-0 text-body-sm-medium leading-[1.4] text-ink">{label}</span>
    </button>
  );
}

function Control({ kind, selected }: { kind: 'check' | 'radio'; selected: boolean }) {
  if (kind === 'check') {
    return (
      <span
        className={`flex-none mt-[1px] inline-flex items-center justify-center size-icon-md rounded-xs border transition-colors ${
          selected ? 'border-accent bg-accent text-on-accent' : 'border-hairline bg-surface-1'
        }`}
      >
        {selected ? <Check className="h-3 w-3" strokeWidth={3.2} /> : null}
      </span>
    );
  }
  return (
    <span
      className={`flex-none mt-[1px] relative inline-block size-icon-md rounded-full border transition-colors ${
        selected ? 'border-accent' : 'border-hairline bg-surface-1'
      }`}
    >
      {selected ? (
        <span aria-hidden className="absolute inset-[3px] rounded-full bg-accent" />
      ) : null}
    </span>
  );
}

function CustomInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Or type your own…"
      className="w-full rounded-md border border-dashed border-hairline bg-surface-1 px-[13px] py-3 text-body-sm leading-[1.4] text-ink placeholder:text-ink-subtle outline-none transition-[border-color,box-shadow] focus:border-accent focus:border-solid focus:ring-[3px] focus:ring-accent/15"
    />
  );
}

export function MinimizedQuestionCard({ message }: { message: DiscussionMessage }) {
  const questions = message.questions ?? [];
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-hairline bg-surface-1/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
      >
        <Sparkles className="h-3 w-3 text-ink-tertiary shrink-0" />
        <span className="text-micro-uppercase uppercase text-ink-tertiary shrink-0">
          Agent asked {questions.length} {questions.length === 1 ? 'question' : 'questions'}
        </span>
        <span className="text-micro font-normal text-ink-subtle truncate flex-1">
          {questions[0]?.prompt ?? ''}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-ink-tertiary shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div className="px-4 pb-3 pt-1 space-y-2">
          {message.text ? (
            <div className="text-micro font-normal leading-[1.55] text-ink-muted">
              <MarkdownText text={message.text} />
            </div>
          ) : null}
          <ol className="space-y-1.5 text-micro font-normal text-ink-muted list-decimal list-inside">
            {questions.map((q) => (
              <li key={q.id}>{q.prompt}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
