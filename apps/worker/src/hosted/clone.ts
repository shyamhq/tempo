// Pure helpers for the hosted runner — no I/O, no side effects, no top-level
// env access, so they're importable from tests without booting the runner.

import type { Event as TempoEvent } from '@tempo/contracts/events';

export interface RepoEntry {
  owner: string;
  name: string;
  /** Absolute path inside the sandbox: /workspace/<owner>__<name> (owner-scoped
   *  so two repos with the same name under different owners can't collide). */
  dir: string;
  /** Authenticated clone URL with the ephemeral token embedded. */
  cloneUrl: string;
}

// The GitHub install token rides in the clone URL as `x-access-token:<token>@`.
// git surfaces the full URL in clone-failure messages, so any string derived
// from a clone error MUST pass through here before it can reach a log line, an
// event payload, the DB, or the browser. Strips the credential prefix from
// every `https://x-access-token:…@host` occurrence, leaving `https://host`.
const CREDENTIAL_URL = /https:\/\/x-access-token:[^@\s]*@/g;
export function sanitizeCloneError(reason: string): string {
  return reason.replace(CREDENTIAL_URL, 'https://');
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
      dir: `/workspace/${owner}__${name}`,
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
