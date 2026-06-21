'use client';

// The new-thread compose. Matches apps/console's compose: both Agent mechanisms
// (Local CLI / Hosted), the prefill chips, the hosted-only repo-context bar, and
// — critically — it posts the trimmed request as the FIRST discussion message.
// That first message is what the Agent reads on turn 1, and (for Hosted) what
// triggers the VM auto-spawn via the discussion_message_posted event. The Thread
// is created with the literal title 'Untitled thread' (the contract default); the
// Agent renames it later.
//
// A STATIC `new` segment: it takes precedence over the sibling `[threadId]`, so
// /t/new resolves here. The sidebar's "New thread" link passes ?space=<id>; it
// preselects that Space, but the Dev can change the target before creating.
//
// ponytail: the repo picker is a plain owner/repo add-list, NOT apps/console's
// autocomplete-against-GitHub modal. console-redo has no worker GitHub-repos
// client (the listGithubRepos infra apps/console's RepoPicker depends on isn't
// wired here yet); the add-list captures the same `repos: string[]` the contract
// wants. Swap in the autocomplete picker when the worker repos client lands.
//
// ponytail: attachments are deferred to the shared-uploader task (#3) — it builds
// the uploader once and wires it into both this compose and the discussion
// composer. We pass `attachments: []` for now.

import { useAuth } from '@clerk/nextjs';
import type { AgentType } from '@tempo/contracts';
import { Bug, Cloud, Command, GitBranch, RefreshCcw, Search, Sparkles, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type KeyboardEvent, Suspense, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { postDiscussionMessage } from '@/features/discussion/api';
import { createThread } from '@/features/thread/api';
import { cn } from '@/lib/utils';
import { useSidebarSpaces, useThreadStore } from '@/store';

const CHIPS: { label: string; lead: string; Icon: typeof Sparkles }[] = [
  { label: 'Add a feature', lead: 'Add a new feature: ', Icon: Sparkles },
  { label: 'Fix a bug', lead: 'Fix a bug where ', Icon: Bug },
  { label: 'Refactor', lead: 'Refactor ', Icon: RefreshCcw },
  { label: 'Investigate', lead: 'Investigate why ', Icon: Search },
];

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
  const { getToken } = useAuth();
  const spaces = useSidebarSpaces();
  const spacesLoaded = spaces.length > 0;

  const [text, setText] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('hosted');
  const [repos, setRepos] = useState<string[]>([]);
  // The link's ?space preselects; the Dev can change it. Falls back to the first
  // hydrated Space once the tree loads (selectedSpaceId below).
  const [spaceId, setSpaceId] = useState(() => params.get('space') ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ponytail: default-to-first is a sensible creation-form default, NOT a band-aid
  // for a broken current-space lookup — the sidebar "New thread" link always passes
  // ?space, so this fallback only covers a direct-URL open with no param.
  const selectedSpaceId = spaceId || spaces[0]?.id || '';
  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && selectedSpaceId !== '' && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    // Tracks how far we got: once set, the Thread exists and only the first
    // discussion message can still fail — which gets a distinct message.
    let createdId: string | null = null;
    try {
      const { thread } = await createThread({
        title: 'Untitled thread',
        description: '',
        space_id: selectedSpaceId,
        agent_type: agentType,
        // Repos gate the Hosted VM; a Local Thread never sends them.
        repos: agentType === 'hosted' ? repos : [],
      });
      createdId = thread.id;
      // The first discussion message: what the Agent reads on turn 1, and what
      // triggers the Hosted VM auto-spawn via the discussion_message_posted event.
      // ponytail: attachments deferred to the shared-uploader task (#3).
      await postDiscussionMessage(thread.id, { text: trimmed, attachments: [] }, getToken);
      // Re-seed the rail so the new Thread row + bumped count appear. Fire-and-
      // forget: refreshSidebar self-swallows+logs, and awaiting a rejection here
      // would surface as a false "create failed" after the Thread already landed.
      void useThreadStore.getState().refreshSidebar();
      // Local Threads land with ?connect=1 to auto-open the Connect dialog (the
      // Dev runs `npx tempo-agent connect`); Hosted route straight in (VM spawns).
      router.push(`/t/${thread.id}${agentType === 'local' ? '?connect=1' : ''}`);
    } catch (e) {
      console.error('new thread: create/post failed', e);
      setError(
        createdId
          ? "Thread created, but couldn't post your message — open it and try again."
          : 'Could not create the thread. Try again.',
      );
      setSubmitting(false);
    }
  };

  const onTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const prefill = (lead: string) => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, 0);
    // execCommand is the only API that participates in the textarea's native undo
    // stack across Chromium/Firefox/WebKit, so Ctrl/Cmd+Z reverts the chip insert.
    // The synthetic input event it fires flows through onChange to update `text`.
    document.execCommand('insertText', false, lead);
  };

  return (
    <div className="grid h-full place-items-center overflow-auto px-6 py-10">
      <div className="flex w-full max-w-[680px] flex-col items-center">
        <div className="mb-4 flex items-center gap-[7px] font-mono text-2xs uppercase tracking-label text-ink-3">
          <Sparkles className="size-[13px] text-primary" strokeWidth={1.6} aria-hidden />
          New thread
        </div>
        <h1 className="mb-3 text-center font-display text-3xl font-semibold leading-snug tracking-tight text-ink">
          What do you want to plan?
        </h1>
        <p className="mb-7 max-w-[46ch] text-center text-md leading-body text-ink-2">
          Describe the change. The Agent reads your codebase and drafts a Plan you and your team can
          edit together before anything runs.
        </p>

        <AgentTypeCards selected={agentType} onChange={setAgentType} disabled={submitting} />
        <p className="mb-5 mt-2 text-center text-xs text-ink-3">
          Tempo runs where you point it — can't switch mid-Thread.
        </p>

        <div className="w-full overflow-hidden rounded-xl border border-border bg-canvas shadow-sm transition-colors focus-within:border-primary focus-within:shadow-[var(--tp-focus-ring)]">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder="Describe the change you want to plan…"
            disabled={submitting}
            rows={5}
            className="block max-h-[280px] min-h-[132px] w-full resize-none border-0 bg-transparent px-5 pb-2 pt-5 text-md leading-body text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-end px-3 pb-3">
            <Button variant="primary" kbd="↵" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? 'Starting…' : 'Start thread'}
            </Button>
          </div>
          {/* Repo-context bar — below the composer, Hosted-only (repos gate the VM). */}
          {agentType === 'hosted' ? (
            <ThreadContextBar repos={repos} onReposChange={setRepos} disabled={submitting} />
          ) : null}
        </div>

        <div className="mt-[18px] flex flex-wrap justify-center gap-2">
          {CHIPS.map(({ label, lead, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => prefill(lead)}
              disabled={submitting}
              className="inline-flex items-center gap-[7px] rounded-pill border border-border bg-canvas px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-border-strong hover:bg-inset disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon className="size-[14px] text-ink-3" strokeWidth={1.9} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-5 flex w-full flex-col gap-1.5">
          <label htmlFor="thread-space" className="text-sm font-medium text-ink-2">
            Space
          </label>
          {spacesLoaded ? (
            <select
              id="thread-space"
              value={selectedSpaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              disabled={submitting}
              className="w-full rounded-sm border border-border-strong bg-canvas px-[11px] py-2 text-base text-ink outline-none transition-[color,box-shadow] focus:border-primary focus:shadow-[var(--tp-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
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

        <p className="mt-[18px] flex items-center gap-[7px] text-xs text-ink-3">
          <Kbd>↵</Kbd>
          <span>to start</span>
          <span className="text-border-strong">·</span>
          <Kbd>⇧</Kbd>
          <Kbd>↵</Kbd>
          <span>for newline</span>
        </p>

        {error ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AgentTypeCards({
  selected,
  onChange,
  disabled,
}: {
  selected: AgentType;
  onChange: (next: AgentType) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex w-full gap-3">
      <AgentTypeCard
        selected={selected === 'hosted'}
        onSelect={() => onChange('hosted')}
        disabled={disabled}
        Icon={Cloud}
        title="Hosted agent"
        blurb="Runs in a Tempo sandbox that clones your repo."
        bullets={[
          'Always on — your laptop can be off',
          'Tempo clones your repo into an isolated VM',
          'Full repo + filesystem + shell',
        ]}
      />
      <AgentTypeCard
        selected={selected === 'local'}
        onSelect={() => onChange('local')}
        disabled={disabled}
        Icon={Command}
        title="Local agent"
        blurb="Runs on your machine. Code never leaves your laptop."
        bullets={[
          'Uses your own Claude API key',
          'Full repo + filesystem + shell',
          <>
            Needs <code className="font-mono">npx tempo-agent connect …</code> running
          </>,
        ]}
      />
    </div>
  );
}

function AgentTypeCard({
  selected,
  onSelect,
  disabled,
  Icon,
  title,
  blurb,
  bullets,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  Icon: typeof Sparkles;
  title: string;
  blurb: string;
  bullets: React.ReactNode[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'min-w-0 flex-1 rounded-xl border-[1.5px] p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-primary bg-primary-soft shadow-[var(--tp-focus-ring)]'
          : 'border-border bg-canvas hover:border-ink-3',
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-md',
            selected ? 'bg-primary text-primary-foreground' : 'bg-inset text-ink-2',
          )}
        >
          <Icon className="size-4" strokeWidth={1.8} aria-hidden />
        </span>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
      </div>
      <p className="mb-3 text-sm leading-snug text-ink-2">{blurb}</p>
      <ul className="space-y-1">
        {bullets.map((b, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static bullets list
          <li key={i} className="flex items-start gap-2 text-xs leading-snug text-ink-2">
            <span className="shrink-0 font-semibold text-primary">›</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

// The Hosted repo-context bar: attached repos as removable chips + an owner/repo
// add field. Sits below the composer (thread-scoped). Repos provision the VM, so
// the bar carries a "Sandbox starts on send" note once any repo is attached.
//
// ponytail: a plain add-list, not apps/console's autocomplete-against-GitHub
// modal — console-redo has no worker GitHub-repos client yet. Same `string[]`
// shape; swap in the picker when that infra lands.
function ThreadContextBar({
  repos,
  onReposChange,
  disabled,
}: {
  repos: string[];
  onReposChange: (repos: string[]) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState('');
  const value = draft.trim();
  // ponytail: mirrors CreateThreadRequest.repos in @tempo/contracts http.ts
  // (one `/`, no whitespace) — single source of truth, so the inline check never
  // rejects an owner/name the server would accept.
  const valid = /^[^/\s]+\/[^/\s]+$/.test(value) && !repos.includes(value);

  const add = () => {
    if (!valid) return;
    onReposChange([...repos, value]);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-b-xl border-t border-border bg-inset px-3 py-2">
      <span className="shrink-0 select-none text-2xs font-semibold uppercase tracking-label text-ink-3">
        Repos
      </span>

      {repos.map((fullName) => (
        <RepoChip
          key={fullName}
          fullName={fullName}
          onRemove={() => onReposChange(repos.filter((r) => r !== fullName))}
          disabled={disabled}
        />
      ))}

      <Input
        mono
        size="sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        placeholder="owner/repo"
        disabled={disabled}
        aria-label="Add a repository (owner/repo)"
        className="h-[26px] max-w-[180px] flex-1"
      />
      <Button variant="ghost" size="sm" onClick={add} disabled={disabled || !valid}>
        Add
      </Button>

      {repos.length > 0 ? (
        <span className="ml-auto shrink-0 text-xs font-medium text-warning">
          Sandbox starts on send
        </span>
      ) : null}
    </div>
  );
}

function RepoChip({
  fullName,
  onRemove,
  disabled,
}: {
  fullName: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [owner = '', name = ''] = fullName.split('/');
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-warning-bg py-0.5 pl-1.5 pr-1 text-sm font-medium text-ink">
      <GitBranch className="size-3 shrink-0 text-warning" strokeWidth={1.8} aria-hidden />
      <span className="text-ink-2">{owner}/</span>
      <span>{name}</span>
      <span className="mx-0.5 rounded border border-border-strong bg-canvas px-1 py-px text-2xs font-bold leading-none text-warning">
        SANDBOX
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${fullName}`}
        className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded text-ink-3 transition-colors hover:bg-inset hover:text-ink disabled:cursor-not-allowed"
      >
        <X className="size-2.5" strokeWidth={2} aria-hidden />
      </button>
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-xs border border-border bg-inset px-[5px] py-[2px] font-mono text-2xs text-ink-2">
      {children}
    </span>
  );
}
