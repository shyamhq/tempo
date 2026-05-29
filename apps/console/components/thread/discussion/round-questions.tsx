'use client';

import type { Answer, Question } from '@tempo/contracts';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

export type DraftMap = Record<
  string,
  | { type: 'single_choice'; choice: string | null; other: string }
  | { type: 'multi_choice'; choices: Set<string>; other: string }
  | { type: 'open_text'; text: string }
>;

const OTHER = '__other__';

export function initDraft(questions: Question[]): DraftMap {
  const out: DraftMap = {};
  for (const q of questions) {
    if (q.type === 'single_choice') out[q.id] = { type: 'single_choice', choice: null, other: '' };
    else if (q.type === 'multi_choice')
      out[q.id] = { type: 'multi_choice', choices: new Set(), other: '' };
    else out[q.id] = { type: 'open_text', text: '' };
  }
  return out;
}

export function toAnswers(questions: Question[], draft: DraftMap): Answer[] | null {
  const out: Answer[] = [];
  for (const q of questions) {
    const v = draft[q.id];
    if (!v) return null;
    if (q.type === 'open_text' && v.type === 'open_text') {
      if (!v.text.trim()) return null;
      out.push({ type: 'open_text', value: v.text.trim() });
      continue;
    }
    if (q.type === 'single_choice' && v.type === 'single_choice') {
      if (v.choice === null) return null;
      if (v.choice === OTHER) {
        if (!v.other.trim()) return null;
        out.push({ type: 'single_choice', value: { other: v.other.trim() } });
      } else {
        out.push({ type: 'single_choice', value: v.choice });
      }
      continue;
    }
    if (q.type === 'multi_choice' && v.type === 'multi_choice') {
      if (v.choices.size === 0) return null;
      const concrete = [...v.choices].filter((c) => c !== OTHER);
      if (v.choices.has(OTHER)) {
        if (!v.other.trim()) return null;
        out.push({ type: 'multi_choice', value: { other: v.other.trim() } });
      } else {
        out.push({ type: 'multi_choice', value: concrete });
      }
      continue;
    }
    return null;
  }
  return out;
}

export function QuestionField({
  index,
  question,
  value,
  onChange,
}: {
  index: number;
  question: Question;
  value: DraftMap[string];
  onChange: (v: DraftMap[string]) => void;
}) {
  const label = (
    <p className="text-sm text-ink font-medium mb-2">
      <span className="text-ink-tertiary mr-2">{index + 1}.</span>
      {question.prompt}
    </p>
  );

  if (question.type === 'open_text' && value.type === 'open_text') {
    return (
      <div>
        {label}
        <Textarea
          value={value.text}
          onChange={(e) => onChange({ type: 'open_text', text: e.target.value })}
          rows={3}
        />
      </div>
    );
  }

  if (question.type === 'single_choice' && value.type === 'single_choice') {
    return (
      <div>
        {label}
        <RadioGroup
          value={value.choice ?? ''}
          onValueChange={(v) => onChange({ ...value, choice: v })}
        >
          {question.options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer"
            >
              <RadioGroupItem value={opt} id={`${question.id}-${opt}`} />
              <span>{opt}</span>
            </label>
          ))}
          {question.allow_other ? (
            <>
              <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
                <RadioGroupItem value={OTHER} id={`${question.id}-other`} />
                <span>Other</span>
              </label>
              {value.choice === OTHER ? (
                <Input
                  className="mt-1 ml-6 max-w-sm"
                  placeholder="Specify…"
                  value={value.other}
                  onChange={(e) => onChange({ ...value, other: e.target.value })}
                />
              ) : null}
            </>
          ) : null}
        </RadioGroup>
      </div>
    );
  }

  if (question.type === 'multi_choice' && value.type === 'multi_choice') {
    const toggle = (opt: string, checked: boolean) => {
      const next = new Set(value.choices);
      if (checked) next.add(opt);
      else next.delete(opt);
      onChange({ ...value, choices: next });
    };
    const otherChecked = value.choices.has(OTHER);
    return (
      <div>
        {label}
        <div className="flex flex-col gap-2">
          {question.options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer"
            >
              <Checkbox
                checked={value.choices.has(opt)}
                onCheckedChange={(c) => toggle(opt, c === true)}
              />
              <span>{opt}</span>
            </label>
          ))}
          {question.allow_other ? (
            <>
              <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
                <Checkbox
                  checked={otherChecked}
                  onCheckedChange={(c) => toggle(OTHER, c === true)}
                />
                <span>Other</span>
              </label>
              {otherChecked ? (
                <Input
                  className="ml-6 max-w-sm"
                  placeholder="Specify…"
                  value={value.other}
                  onChange={(e) => onChange({ ...value, other: e.target.value })}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}
