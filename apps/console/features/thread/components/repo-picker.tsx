'use client';

// Modal GitHub repo picker for the new-thread compose. Loads every repo the
// workspace's GitHub App installation can see (Worker GET /api/connectors/github/repos),
// multi-selects with search, and returns the chosen owner/name strings on confirm.
// An empty list renders a "GitHub not connected" prompt.
//
// Ported from apps/console's RepoPicker onto console's tokens + Radix Dialog.
// No TanStack Query (console doesn't use it): a cancel-guarded fetch runs
// each time the modal opens — cheap, and keeps the list fresh if GitHub was just
// connected in another tab. No forceMount (see settings-modal.tsx) — the portal
// escapes the composer's overflow-hidden on its own.

import { useAuth } from '@clerk/nextjs';
import * as Dialog from '@radix-ui/react-dialog';
import type { GithubRepo } from '@tempo/contracts/http';
import { Check, GitPullRequest, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listGithubRepos } from '../api';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; repos: GithubRepo[] };

export function RepoPicker({
  open,
  onOpenChange,
  selectedRepos,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently attached repo full_names (["owner/name", ...]). */
  selectedRepos: string[];
  onConfirm: (repos: string[]) => void;
}) {
  const { getToken } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [query, setQuery] = useState('');
  // Local selection — a copy mutated until Confirm, so Cancel discards.
  const [localSelection, setLocalSelection] = useState<string[]>(selectedRepos);

  // Reset the draft + query only on the closed→open transition — NOT on every
  // selectedRepos identity change, which would wipe an in-progress selection if
  // the parent re-rendered with a fresh array while the modal is open.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setLocalSelection(selectedRepos);
      setQuery('');
    }
    wasOpen.current = open;
  }, [open, selectedRepos]);

  // (Re)load the list each time the modal opens. The per-effect `cancelled` flag
  // drops a stale fetch if the modal is closed (or re-opened) before it resolves,
  // and is StrictMode-safe (cleanup runs between the dev double-invoke).
  useEffect(() => {
    if (!open) return;
    setState({ status: 'loading' });
    let cancelled = false;
    listGithubRepos(getToken)
      .then((res) => {
        if (!cancelled) setState({ status: 'ready', repos: res.repos });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [open, getToken]);

  const repos = state.status === 'ready' ? state.repos : [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? repos.filter((r) => r.full_name.toLowerCase().includes(q)) : repos;
  }, [repos, query]);

  const toggle = (fullName: string) =>
    setLocalSelection((prev) =>
      prev.includes(fullName) ? prev.filter((r) => r !== fullName) : [...prev, fullName],
    );

  const addedCount = localSelection.filter((r) => !selectedRepos.includes(r)).length;
  const removedCount = selectedRepos.filter((r) => !localSelection.includes(r)).length;
  const hasChanges = addedCount > 0 || removedCount > 0;

  const confirm = () => {
    onConfirm(localSelection);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="tp-fade-in fixed inset-0 z-[70] bg-[var(--tp-backdrop)]" />
        {/* Base -translate keeps the modal centered after tp-scale-in ends and
            under prefers-reduced-motion — same pattern as settings-modal.tsx. */}
        <Dialog.Content className="tp-scale-in fixed left-1/2 top-1/2 z-[71] flex max-h-[80vh] w-[500px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-canvas shadow-lg outline-none">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <Dialog.Title className="text-sm font-semibold text-ink">Add repositories</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="inline-flex size-7 items-center justify-center rounded-md text-ink-2 outline-none transition-colors hover:bg-inset hover:text-ink focus-visible:shadow-[var(--tp-focus-ring)] [&_svg]:size-3.5"
            >
              <X aria-hidden />
            </Dialog.Close>
          </div>

          <div className="border-b border-border px-4 py-2.5">
            <label className="flex items-center gap-2 rounded-lg border border-border bg-inset px-2.5 py-1.5">
              <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repositories…"
                autoComplete="off"
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {state.status === 'loading' ? (
              <div className="flex items-center justify-center gap-2 py-12 text-ink-3">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                <span className="text-xs">Loading repositories…</span>
              </div>
            ) : state.status === 'error' ? (
              <div className="py-12 text-center text-xs text-danger">
                Couldn't load repositories. Try again.
              </div>
            ) : repos.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <GitPullRequest className="mb-3 size-8 text-ink-3" strokeWidth={1.5} aria-hidden />
                <p className="mb-1 text-sm font-medium text-ink">GitHub not connected</p>
                <p className="text-xs leading-relaxed text-ink-3">
                  Connect your GitHub App in Settings → Connectors to attach repositories.
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-xs text-ink-3">
                No repositories match "{query}"
              </div>
            ) : (
              <ul className="px-1.5 py-1.5">
                {filtered.map((repo) => (
                  <RepoRow
                    key={repo.full_name}
                    repo={repo}
                    selected={localSelection.includes(repo.full_name)}
                    onToggle={() => toggle(repo.full_name)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border bg-inset px-4 py-3">
            <span className="text-2xs text-ink-3">
              {localSelection.length === 0
                ? 'No repos selected'
                : `${localSelection.length} repo${localSelection.length === 1 ? '' : 's'} selected`}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={confirm} disabled={!hasChanges}>
                {hasChanges
                  ? addedCount > 0
                    ? `Add ${addedCount} repo${addedCount === 1 ? '' : 's'}`
                    : `Remove ${removedCount} repo${removedCount === 1 ? '' : 's'}`
                  : 'Confirm'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RepoRow({
  repo,
  selected,
  onToggle,
}: {
  repo: GithubRepo;
  selected: boolean;
  onToggle: () => void;
}) {
  const [owner = '', name = ''] = repo.full_name.split('/');
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
          selected ? 'bg-inset' : 'hover:bg-inset'
        }`}
      >
        <span
          className={`flex size-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] transition-colors ${
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border-strong bg-canvas'
          }`}
          aria-hidden
        >
          {selected ? <Check className="size-2.5" strokeWidth={2.5} /> : null}
        </span>

        <span className="flex size-5 flex-none items-center justify-center rounded-[4px] bg-[#1f2328] text-white">
          <GitPullRequest className="size-3" strokeWidth={1.8} aria-hidden />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            <span className="text-ink-3">{owner}/</span>
            {name}
          </span>
          {repo.description ? (
            <span className="mt-0.5 block truncate text-2xs text-ink-3">{repo.description}</span>
          ) : null}
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          {repo.private ? (
            <span className="rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">
              Private
            </span>
          ) : null}
          {/* All GitHub repos provision the Hosted sandbox on send. */}
          <span className="rounded border border-warning/30 bg-warning-bg px-1 py-0.5 text-[9px] font-bold leading-none text-warning">
            SANDBOX
          </span>
        </span>
      </button>
    </li>
  );
}
