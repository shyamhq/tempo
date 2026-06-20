'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, GitPullRequest, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { api, type GithubRepo } from '@/lib/api-client';

type RepoPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently attached repo full_names (["owner/name", ...]). */
  selectedRepos: string[];
  onConfirm: (repos: string[]) => void;
};

/**
 * Modal repo picker. Loads all GitHub repos accessible to the workspace App
 * installation, lets the Dev multi-select, and calls `onConfirm` on save.
 * Renders a "GitHub not connected" empty state when the list is empty.
 */
export function RepoPicker({ open, onOpenChange, selectedRepos, onConfirm }: RepoPickerProps) {
  const [query, setQuery] = useState('');
  // Local selection — copy of selectedRepos on open, mutated until Confirm.
  const [localSelection, setLocalSelection] = useState<string[]>(selectedRepos);

  // Reset local selection each time the picker opens.
  useEffect(() => {
    if (open) {
      setLocalSelection(selectedRepos);
      setQuery('');
    }
  }, [open, selectedRepos]);

  const { data, isLoading } = useQuery({
    queryKey: ['github-repos'],
    queryFn: () => api.listGithubRepos(),
    staleTime: 60_000,
    enabled: open,
  });

  const repos = data?.repos ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [repos, query]);

  const toggle = (fullName: string) => {
    setLocalSelection((prev) =>
      prev.includes(fullName) ? prev.filter((r) => r !== fullName) : [...prev, fullName],
    );
  };

  const handleConfirm = () => {
    onConfirm(localSelection);
    onOpenChange(false);
  };

  const addedCount = localSelection.filter((r) => !selectedRepos.includes(r)).length;
  const removedCount = selectedRepos.filter((r) => !localSelection.includes(r)).length;
  const hasChanges = addedCount > 0 || removedCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] p-0 gap-0 overflow-hidden" showClose={false}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <DialogTitle className="text-sm font-semibold text-ink">Add repositories</DialogTitle>
          <DialogClose
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </DialogClose>
        </div>

        <div className="px-4 py-2.5 border-b border-hairline">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-hairline">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" />
            <input
              type="search"
              placeholder="Search repositories…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-body-sm text-ink placeholder:text-ink-tertiary outline-none"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: '320px' }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-ink-tertiary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-caption">Loading repositories…</span>
            </div>
          ) : repos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <GitPullRequest className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1.5} />
              <p className="text-body-sm font-medium text-ink mb-1">GitHub not connected</p>
              <p className="text-caption text-ink-subtle leading-relaxed">
                Connect your GitHub App in Settings → Integrations to attach repositories.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-caption text-ink-tertiary">
              No repositories match "{query}"
            </div>
          ) : (
            <ul className="py-1.5 px-1.5">
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

        <div className="flex items-center justify-between px-4 py-3 border-t border-hairline bg-surface-2">
          <span className="text-micro text-ink-tertiary">
            {localSelection.length === 0
              ? 'No repos selected'
              : `${localSelection.length} repo${localSelection.length === 1 ? '' : 's'} selected`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirm}
              disabled={!hasChanges && localSelection.length === selectedRepos.length}
            >
              {hasChanges
                ? addedCount > 0
                  ? `Add ${addedCount} repo${addedCount === 1 ? '' : 's'}`
                  : `Remove ${removedCount} repo${removedCount === 1 ? '' : 's'}`
                : 'Confirm'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
  const [owner, name] = repo.full_name.split('/');
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
          selected ? 'bg-surface-2' : 'hover:bg-surface-2'
        }`}
      >
        {/* Checkbox indicator */}
        <span
          className={`flex-none flex items-center justify-center h-[18px] w-[18px] rounded-[5px] border-[1.5px] transition-colors ${
            selected
              ? 'bg-primary border-primary text-on-primary'
              : 'border-hairline-strong bg-canvas'
          }`}
          aria-hidden
        >
          {selected ? <Check className="h-2.5 w-2.5" strokeWidth={2.5} /> : null}
        </span>

        {/* GitHub icon tile */}
        <span className="flex-none flex items-center justify-center h-5 w-5 rounded-[4px] bg-[#1f2328] text-white">
          <GitPullRequest className="h-3 w-3" strokeWidth={1.8} />
        </span>

        {/* Repo name */}
        <span className="flex-1 min-w-0">
          <span className="block text-body-sm font-medium text-ink truncate">
            <span className="text-ink-subtle">{owner}/</span>
            {name}
          </span>
          {repo.description ? (
            <span className="block text-micro text-ink-tertiary truncate mt-0.5">
              {repo.description}
            </span>
          ) : null}
        </span>

        {/* Badges */}
        <span className="flex items-center gap-1.5 shrink-0">
          {repo.private ? (
            <span className="text-[10px] font-semibold text-ink-tertiary bg-surface-3 border border-hairline px-1.5 py-0.5 rounded">
              Private
            </span>
          ) : null}
          {/* SANDBOX badge — all GitHub repos trigger VM provisioning */}
          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded leading-none">
            SANDBOX
          </span>
        </span>
      </button>
    </li>
  );
}
