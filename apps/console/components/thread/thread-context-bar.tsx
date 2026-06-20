'use client';

import { GitPullRequest, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { RepoPicker } from './repo-picker';

type ThreadContextBarProps = {
  /** Currently attached repo full_names (["owner/name", ...]). */
  repos: string[];
  onReposChange: (repos: string[]) => void;
  disabled?: boolean;
};

/**
 * Thread-context bar — sits below the composer textarea (thread-scoped).
 * Shows attached GitHub repos as removable chips with a SANDBOX marker,
 * and a "+ Add repo" button that opens the multi-select repo picker modal.
 */
export function ThreadContextBar({
  repos,
  onReposChange,
  disabled = false,
}: ThreadContextBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const removeRepo = (fullName: string) => {
    onReposChange(repos.filter((r) => r !== fullName));
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 border-t border-hairline bg-surface-2 rounded-b-xl">
        {/* Label */}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary select-none shrink-0">
          Repos
        </span>

        {/* Chips */}
        {repos.map((fullName) => (
          <RepoChip
            key={fullName}
            fullName={fullName}
            onRemove={() => removeRepo(fullName)}
            disabled={disabled}
          />
        ))}

        {/* Add button */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={disabled}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-medium text-accent-deep bg-transparent border border-transparent hover:bg-canvas hover:border-hairline transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-3 w-3" strokeWidth={2} />
          Add repo
        </button>

        {/* VM note when repos are attached */}
        {repos.length > 0 ? (
          <span className="ml-auto text-[11px] text-amber-700 font-medium shrink-0">
            Sandbox starts on send
          </span>
        ) : null}
      </div>

      <RepoPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedRepos={repos}
        onConfirm={onReposChange}
      />
    </>
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
    <span className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[12px] font-medium text-amber-900">
      <GitPullRequest className="h-3 w-3 shrink-0 text-amber-700" strokeWidth={1.8} aria-hidden />
      <span className="text-amber-600">{owner}/</span>
      <span>{name}</span>
      <span className="text-[9px] font-bold text-amber-700 bg-white/60 border border-amber-200 px-1 py-px rounded leading-none mx-0.5">
        SANDBOX
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${fullName}`}
        className="ml-0.5 inline-flex items-center justify-center h-3.5 w-3.5 rounded text-amber-500 hover:text-amber-800 hover:bg-amber-100 transition-colors disabled:cursor-not-allowed"
      >
        <X className="h-2.5 w-2.5" strokeWidth={2} />
      </button>
    </span>
  );
}
