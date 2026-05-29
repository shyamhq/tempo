'use client';

import type { PendingRound } from '@tempo/contracts';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { type DraftMap, initDraft, QuestionField, toAnswers } from './round-questions';

export function RoundCard({ round }: { round: PendingRound }) {
  const [draft, setDraft] = useState<DraftMap>(() => initDraft(round.questions));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answers = toAnswers(round.questions, draft);
  const ready = answers !== null && answers.length === round.questions.length;

  const submit = async () => {
    if (!answers) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.answerRound(round.id, { answers });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-md border border-hairline bg-surface-2 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-hairline bg-surface-1">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Agent is asking {round.questions.length}{' '}
          {round.questions.length === 1 ? 'question' : 'questions'}
        </span>
      </div>
      <div className="px-4 py-4 space-y-5 max-h-[55vh] overflow-y-auto">
        {round.questions.map((q, i) => (
          <QuestionField
            key={q.id}
            index={i}
            question={q}
            value={draft[q.id]!}
            onChange={(v) => setDraft((d) => ({ ...d, [q.id]: v }))}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-hairline bg-surface-1">
        {error ? (
          <p className="text-xs text-danger truncate">{error}</p>
        ) : (
          <p className="text-[11px] text-ink-tertiary">All questions are required</p>
        )}
        <Button variant="primary" size="sm" disabled={!ready || submitting} onClick={submit}>
          {submitting ? 'Submitting…' : 'Submit answers'}
        </Button>
      </div>
    </div>
  );
}
