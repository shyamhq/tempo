'use client';

// Agent clarification questions. Ported from apps/console's question-card.tsx
// (LiveQuestionCard + Stepper + MinimizedQuestionCard), restyled onto the kit's
// --tp-* tokens. The Agent posts a DiscussionMessage carrying questions[] via
// MCP; the browser never authors questions — the Dev only ANSWERS them. The
// answers post back as a normal Dev message: a markdown block per question
// (`**<prompt>**\n→ <answer>`, skipped → `→ _Skipped_`), wired through
// postDiscussionMessage. No optimistic row — when the Dev's answer message lands
// via SSE the discussion-dock's live/minimized derivation flips and this card
// unmounts.
//
// Presentational: it reads the message it's handed and posts via the feature api
// with a per-call getToken (useAuth), mirroring the composer. The Agent framing
// text renders via the shared MarkdownText (features/mentions) for consistency
// with DiscussionMessageRow.

import { useAuth } from '@clerk/nextjs';
import type { DiscussionMessage, Question } from '@tempo/contracts';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownText } from '@/features/mentions/markdown-text';
import { postDiscussionMessage } from '../api';
import { formatTime } from '../format';

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
  questions,
  threadId,
}: {
  message: DiscussionMessage;
  questions: Question[];
  threadId: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 pt-3 pb-[14px] first:border-t-0">
      {message.text ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[11.5px]">
            <Avatar kind="agent" size={19} />
            <span className="font-semibold text-ink">Agent</span>
            <time
              dateTime={message.created_at}
              suppressHydrationWarning
              className="ml-auto font-mono text-[10px] text-ink-3 tabular-nums"
            >
              {formatTime(message.created_at)}
            </time>
          </div>
          <div className="break-words text-[12.5px] leading-[1.6] text-ink">
            <MarkdownText text={message.text} mentions={message.mentions} />
          </div>
        </div>
      ) : null}
      <Stepper questions={questions} threadId={threadId} />
    </div>
  );
}

function Stepper({ questions, threadId }: { questions: Question[]; threadId: string }) {
  const { getToken } = useAuth();
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
      await postDiscussionMessage(threadId, { text }, getToken);
      // No further UI work — when the new Dev message lands via SSE, the dock's
      // live/minimized derivation flips and this card unmounts automatically.
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : 'Submit failed.');
    }
  }

  return (
    <div className="overflow-hidden rounded-[11px] border border-border bg-canvas shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-inset px-[15px] py-[11px]">
        <Avatar kind="agent" size={18} aria-hidden />
        <span className="flex-1 text-2xs font-semibold uppercase tracking-label text-ink-2">
          Agent questions
        </span>
        <Badge tone="neutral" mono uppercase className="tabular-nums">
          {step + 1}/{total}
        </Badge>
      </div>

      <div className="flex gap-1.5 px-[15px] pt-[14px]">
        {questions.map((p, i) => (
          <span
            key={p.id}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < step ? 'bg-primary' : i === step ? 'bg-primary/40' : 'bg-border'
            }`}
          />
        ))}
      </div>

      <div className="px-[15px] pt-[11px] text-2xs font-semibold uppercase tracking-label text-ink-3">
        Question {step + 1} of {total}
      </div>

      <div className="px-[15px] pt-[10px] pb-1">
        <p
          id={`q-${q.id}-prompt`}
          className="mb-[11px] text-[13px] font-semibold leading-[1.4] text-ink"
        >
          {q.prompt}
        </p>

        {q.type === 'open_text' && d.type === 'open_text' ? (
          <textarea
            aria-labelledby={`q-${q.id}-prompt`}
            className="min-h-[64px] w-full resize-y rounded-sm border border-border bg-canvas px-3 py-2.5 text-[12.5px] leading-[1.55] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-primary focus:shadow-[var(--tp-focus-ring)]"
            placeholder="Type your answer…"
            value={d.text}
            onChange={(e) => update({ type: 'open_text', text: e.target.value })}
          />
        ) : null}

        {q.type === 'single_choice' && d.type === 'single_choice' ? (
          <div
            role="radiogroup"
            aria-labelledby={`q-${q.id}-prompt`}
            className="flex flex-col gap-2"
          >
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
          // biome-ignore lint/a11y/useSemanticElements: a styled checkbox group; native <fieldset> would require restyling. role=group is the correct WAI-ARIA container for the checkboxes within.
          <div role="group" aria-labelledby={`q-${q.id}-prompt`} className="flex flex-col gap-2">
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
            className="h-9 rounded-sm px-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-inset hover:text-ink disabled:opacity-50"
          >
            ← Back
          </button>
        ) : (
          <span />
        )}
        <span className="flex-1">
          {error ? <span className="text-[11.5px] text-danger">{error}</span> : null}
        </span>
        <button
          type="button"
          onClick={skip}
          disabled={submitting}
          className="h-9 rounded-sm px-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-inset hover:text-ink disabled:opacity-50"
        >
          Skip
        </button>
        <Button
          variant="primary"
          size="lg"
          className="rounded-pill px-[18px]"
          disabled={(!answered && !skipped.has(step)) || submitting}
          onClick={() => (isLast ? void submit() : advance())}
        >
          {submitting ? 'Submitting…' : isLast ? 'Submit answers' : 'Next →'}
        </Button>
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
      className={`flex w-full items-start gap-[11px] rounded-sm border px-[13px] py-3 text-left transition-[border-color,background-color] ${
        selected
          ? 'border-primary bg-primary-soft'
          : 'border-border bg-canvas hover:border-border-strong'
      } outline-none focus-visible:border-primary focus-visible:shadow-[var(--tp-focus-ring)]`}
    >
      <Control kind={kind} selected={selected} />
      <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-[1.4] text-ink">
        {label}
      </span>
    </button>
  );
}

function Control({ kind, selected }: { kind: 'check' | 'radio'; selected: boolean }) {
  if (kind === 'check') {
    return (
      <span
        className={`mt-[1px] inline-flex size-4 flex-none items-center justify-center rounded-xs border transition-colors ${
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-canvas'
        }`}
      >
        {selected ? <Check className="size-3" strokeWidth={3.2} /> : null}
      </span>
    );
  }
  return (
    <span
      className={`relative mt-[1px] inline-block size-4 flex-none rounded-full border transition-colors ${
        selected ? 'border-primary' : 'border-border bg-canvas'
      }`}
    >
      {selected ? (
        <span aria-hidden className="absolute inset-[3px] rounded-full bg-primary" />
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
      className="w-full rounded-sm border border-dashed border-border bg-canvas px-[13px] py-3 text-[12.5px] leading-[1.4] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-2 focus:border-solid focus:border-primary focus:shadow-[var(--tp-focus-ring)]"
    />
  );
}

export function MinimizedQuestionCard({
  message,
  questions,
}: {
  message: DiscussionMessage;
  questions: Question[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-4 mt-3 rounded-sm border border-border bg-canvas/60 first:mt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-inset"
      >
        <Avatar kind="agent" size={15} aria-hidden />
        <span className="shrink-0 text-2xs font-semibold uppercase tracking-label text-ink-3">
          Agent asked {questions.length} {questions.length === 1 ? 'question' : 'questions'}
        </span>
        <span className="flex-1 truncate text-[11.5px] text-ink-2">
          {questions[0]?.prompt ?? ''}
        </span>
        <ChevronDown
          className={`size-3 shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-4 pt-1 pb-3">
          {message.text ? (
            <div className="text-[11.5px] leading-[1.55] text-ink-2">
              <MarkdownText text={message.text} mentions={message.mentions} />
            </div>
          ) : null}
          <ol className="list-inside list-decimal text-[11.5px] text-ink-2">
            {questions.map((q) => (
              <li key={q.id} className="my-0.5">
                {q.prompt}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
