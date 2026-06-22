'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Notion / Confluence-style auto-save loop for the Plan editor. Ported from
// apps/console — library-agnostic timer/backoff logic (no BlockNote here), the
// proven sequencing that keeps at most one save in flight per editor.
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
// Unload: a `beforeunload` listener flushes any pending save via the caller's
// keepalive beacon so the request survives the page going away. We do NOT await
// it — beforeunload handlers may not keep the page open.

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 700;
const BACKOFF_SCHEDULE_MS = [2_000, 5_000, 10_000];

export function usePlanAutoSave({
  getPmJson,
  persist,
  unloadBeacon,
}: {
  // Snapshot the current editor's ProseMirror JSON. Called inside save() — the
  // latest call wins, so the freshest snapshot is always persisted.
  getPmJson: () => unknown;
  // Optimistic-slice-write + HTTP write. Throws on failure so the hook can
  // drive its backoff retry.
  persist: (pmJson: unknown) => Promise<void>;
  // Synchronous-friendly unload flush. The caller fires a `keepalive` request
  // so the write survives the page going away (a normal async save cannot).
  unloadBeacon: (pmJson: unknown) => void;
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

  // Runs the actual save. Updates state, drives backoff on failure, drains
  // the pending follow-up. Reads via refs so it doesn't capture stale state.
  const runSave = useCallback(async () => {
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
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      void runSave();
    }, DEBOUNCE_MS);
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

  // beforeunload fires before the page goes away. Flush via the caller's
  // keepalive beacon so the request survives the unload — we do NOT await it
  // (beforeunload handlers may not keep the page open). Only when work could be
  // lost: a debounce timer is armed, a follow-up is queued, or a save is in
  // flight without keepalive. The beacon is idempotent (last-write-wins on the
  // server), so a double-write when the in-flight save also lands is acceptable;
  // losing the edit isn't.
  useEffect(() => {
    const onUnload = () => {
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

  return { status, lastSavedAt, notifyEdit };
}
