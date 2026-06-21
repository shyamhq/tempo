'use client';

// The new-thread compose. A focused capture: one initial-request textarea + an
// explicit Space selector, nothing else. The first line becomes the Thread title
// (clamped to the contract's 200-char ceiling); the full text is the description.
// On create we redirect to the Thread, where the Dev attaches the Agent via the
// in-thread Connect affordance.
//
// A STATIC `new` segment: it takes precedence over the sibling `[threadId]`, so
// /t/new resolves here. The sidebar's "New thread" link passes ?space=<id>; it
// preselects that Space, but the Dev can change the target before creating.
//
// ponytail: only the `local` Agent path is offered. A `hosted` Thread created
// here never auto-starts — VM spawn is driven by the first
// discussion_message_posted, and the first-message/`/init` post is deferred — so
// offering it would ship a dead end. Re-add the agent-type choice when that
// first-message `/init` post is wired.
//
// ponytail: deferred to a follow-up — attachments, repo selection, the rich
// compose "chips", and the Worker /init first-message post. The initial request
// is captured as title/description for now; the Agent reads it at Turn 1.

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createThread } from '@/features/thread/api';
import { useSidebarSpaces, useThreadStore } from '@/store';

// The contract caps the title at 200 chars (CreateThreadRequest.title.max(200)).
const TITLE_MAX = 200;

export default function NewThreadPage() {
  // useSearchParams needs a Suspense boundary (Next App Router).
  return (
    <Suspense fallback={null}>
      <NewThreadCompose />
    </Suspense>
  );
}

function NewThreadCompose() {
  const router = useRouter();
  const params = useSearchParams();
  const spaces = useSidebarSpaces();
  const spacesLoaded = spaces.length > 0;

  const [text, setText] = useState('');
  // The link's ?space preselects; the Dev can change it. Empty until the user
  // picks (or the tree resolves a default below).
  const [spaceId, setSpaceId] = useState(() => params.get('space') ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to the first hydrated Space once the tree loads, if nothing chosen.
  const selectedSpaceId = spaceId || spaces[0]?.id || '';

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && selectedSpaceId !== '' && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const firstLine = trimmed.split('\n')[0] ?? '';
    const title = (firstLine || trimmed).slice(0, TITLE_MAX);
    try {
      const { thread } = await createThread({
        space_id: selectedSpaceId,
        title,
        description: trimmed,
        agent_type: 'local',
        repos: [],
      });
      // Re-seed the rail so the new Thread row + bumped count appear. Best-effort
      // (logs on failure); the redirect lands regardless.
      await useThreadStore.getState().refreshSidebar();
      router.push(`/t/${thread.id}`);
    } catch {
      setError('Could not create the thread. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="grid h-full place-items-center px-6 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-5 flex flex-col gap-1.5">
          <h1 className="font-display text-xl font-semibold tracking-snug text-ink">
            Start a planning thread
          </h1>
          <p className="text-base text-ink-2">
            Describe what you want to plan. The Agent reads this to begin.
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-border bg-canvas p-5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="What do you want to plan?"
            rows={6}
            className="w-full resize-y rounded-sm border border-border-strong bg-canvas px-[11px] py-2.5 text-base text-ink outline-none transition-[color,box-shadow] placeholder:text-ink-3 focus:border-primary focus:shadow-[var(--tp-focus-ring)]"
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="thread-space" className="text-sm font-medium text-ink-2">
              Space
            </label>
            {spacesLoaded ? (
              <select
                id="thread-space"
                value={selectedSpaceId}
                onChange={(e) => setSpaceId(e.target.value)}
                className="w-full rounded-sm border border-border-strong bg-canvas px-[11px] py-2 text-base text-ink outline-none transition-[color,box-shadow] focus:border-primary focus:shadow-[var(--tp-focus-ring)]"
              >
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-ink-3">Loading spaces…</span>
            )}
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => router.back()} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create thread'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
