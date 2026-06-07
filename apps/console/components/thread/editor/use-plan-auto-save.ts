'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Notion / Confluence-style auto-save loop for the Plan editor.
//
// State machine:
//   idle    — never edited (or just mounted with clean initial blocks)
//   saving  — POST in flight
//   saved   — last write succeeded; fades to idle visually after a beat
//   error   — last attempt failed; a retry is scheduled. We stay here until
//             a retry succeeds; intermediate retries do NOT bounce back to
//             "saving" because flashing the status three times in a row is
//             noise, not signal.
//
// Sequencing: every edit notifies, which schedules a debounced save. While a
// write is in flight, further edits set a `pending` flag — when the in-flight
// write returns we fire one follow-up save with the freshest snapshot. So at
// most one save is in flight per editor at a time, and the freshest snapshot
// always wins.
//
// Unload: a `beforeunload` listener flushes any pending save synchronously
// via `fetch(..., { keepalive: true })`. The hook exposes this as `flushNow`
// for non-unload callers (e.g. tab-blur, route change) that want the same
// guarantee.

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 700;
const BACKOFF_SCHEDULE_MS = [2_000, 5_000, 10_000];

export function usePlanAutoSave({
  getPmJson,
  persist,
  unloadBeacon,
  readOnly = false,
}: {
  /** Snapshot the current editor's ProseMirror JSON. Called inside save()
   * and inside flushNow() — the latest call wins, so the freshest snapshot
   * is always the one that gets persisted. */
  getPmJson: () => unknown;
  /** Optimistic-cache-update + HTTP write. Throws on failure so the hook
   * can drive its backoff retry. */
  persist: (pmJson: unknown) => Promise<void>;
  /** Synchronous-friendly unload flush. Uses `fetch(keepalive: true)` so
   * the request survives the page going away. */
  unloadBeacon: (pmJson: unknown) => void;
  /** Approved Plans are frozen — auto-save short-circuits to a no-op. */
  readOnly?: boolean;
}) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const retryAttempt = useRef(0);
  // Latest-snapshot accessors via ref so the persist closure is stable.
  const getPmJsonRef = useRef(getPmJson);
  getPmJsonRef.current = getPmJson;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // Runs the actual save. Updates state, drives backoff on failure, drains
  // the pending follow-up. Reads via refs so it doesn't capture stale state.
  const runSave = useCallback(async () => {
    if (readOnlyRef.current) return;
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    inFlight.current = true;
    setStatus('saving');
    try {
      await persistRef.current(getPmJsonRef.current());
      retryAttempt.current = 0;
      setStatus('saved');
      setLastSavedAt(Date.now());
    } catch {
      // Schedule a retry on a backoff. We stay in "error" status across the
      // retry attempt (no flashing back through "saving") because the Dev
      // already knows we're trying.
      setStatus('error');
      const idx = Math.min(retryAttempt.current, BACKOFF_SCHEDULE_MS.length - 1);
      const delay = BACKOFF_SCHEDULE_MS[idx] ?? 10_000;
      retryAttempt.current += 1;
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        void runSave();
      }, delay);
    } finally {
      inFlight.current = false;
      if (pending.current) {
        pending.current = false;
        // Drain the queued follow-up against the freshest blocks. The
        // microtask defer keeps us out of a tight stack loop.
        queueMicrotask(() => void runSave());
      }
    }
  }, []);

  const notifyEdit = useCallback(() => {
    if (readOnlyRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      void runSave();
    }, DEBOUNCE_MS);
  }, [runSave]);

  // Re-arm the backoff counter when the editor leaves read-only mode (e.g.
  // the Dev hits Reopen on an approved Plan after a save failure). Without
  // this, the next edit after reopen would inherit the stale capped delay.
  useEffect(() => {
    if (readOnly) return;
    retryAttempt.current = 0;
  }, [readOnly]);

  const flushNow = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    await runSave();
  }, [runSave]);

  // Retry immediately when the browser reports the network is back. The
  // current backoff might still have several seconds left; short-circuit it
  // to recover faster.
  useEffect(() => {
    const onOnline = () => {
      if (status !== 'error') return;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      void runSave();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [runSave, status]);

  // beforeunload fires before the page goes away. We flush via the caller's
  // keepalive beacon so the request survives the unload. We do NOT await it
  // — beforeunload handlers are not allowed to keep the page open.
  useEffect(() => {
    const onUnload = () => {
      if (readOnlyRef.current) return;
      // Three cases where unload can lose work: a debounce timer is armed,
      // a follow-up is queued behind an in-flight save, OR a regular save
      // is in flight without `keepalive` and the browser is about to cancel
      // it. The beacon is idempotent (last-write-wins on the server) so a
      // double-write when the in-flight save also completes is acceptable;
      // losing the edit isn't.
      if (debounceTimer.current || pending.current || inFlight.current) {
        unloadBeacon(getPmJsonRef.current());
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [unloadBeacon]);

  // Tidy timers on unmount so a slow save can't update state after teardown.
  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  return { status, lastSavedAt, notifyEdit, flushNow };
}
