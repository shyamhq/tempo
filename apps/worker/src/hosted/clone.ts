// Pure helpers for the hosted runner — no I/O, no side effects, no top-level
// env access, so they're importable from tests without booting the runner.

import type { Event as TempoEvent } from '@tempo/contracts/events';

export interface RepoEntry {
  owner: string;
  name: string;
  /** Absolute path inside the sandbox: /workspace/<name> */
  dir: string;
  /** Authenticated clone URL with the ephemeral token embedded. */
  cloneUrl: string;
}

/**
 * Parse the TEMPO_REPOS env value into repo entries ready for cloning.
 * Returns an empty array when the value is absent or empty — the caller
 * treats that as a no-op (no-repo conversation).
 */
export function parseRepos(
  tempoRepos: string | undefined,
  ghToken: string | undefined,
): RepoEntry[] {
  if (!tempoRepos || !ghToken) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(tempoRepos);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: RepoEntry[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const slash = item.indexOf('/');
    if (slash <= 0 || slash === item.length - 1) continue;
    const owner = item.slice(0, slash);
    const name = item.slice(slash + 1);
    entries.push({
      owner,
      name,
      dir: `/workspace/${name}`,
      cloneUrl: `https://x-access-token:${ghToken}@github.com/${owner}/${name}.git`,
    });
  }
  return entries;
}

/**
 * Returns true when the buffered wake events include a `repo_linked` event,
 * meaning the runner must self-exit so the next wake re-provisions with the
 * full repo list (the sandbox env is immutable — no clone-in-place possible).
 */
export function hasRepoLinked(events: TempoEvent[]): boolean {
  return events.some((e) => e.kind === 'repo_linked');
}
