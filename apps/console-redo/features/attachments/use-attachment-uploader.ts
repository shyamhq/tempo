'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { initAttachment } from './api';

// One pending upload's lifecycle: hold the local preview blob URL the composer
// renders into the thumbnail tray, the eventual attachment id the Send button
// passes back to the server, and the upload status so the row can show a
// spinner / error without the composer learning the steps. `localUrl` is only
// valid for the page's lifetime — the hook revokes it on remove / unmount.
//
// Two callers, two timings (mirrors apps/console):
//   - Discussion composer has a threadId, so files upload eagerly on add and
//     `readyIds` fills in as each PUT lands.
//   - New-thread compose has no thread until createThread, so it constructs the
//     hook with threadId=null (files stay 'pending', no upload) and calls
//     uploadAll(threadId) inside submit() once the Thread exists.

export type PendingAttachment = {
  // Stable client id for the React key; replaced by the server id once init
  // resolves so the send pass uses the canonical attachment id.
  clientId: string;
  serverId: string | null;
  file: File;
  localUrl: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLen: number;
  // 'pending' = held, never uploaded (compose, pre-thread); 'uploading'/'ready'/
  // 'error' = the eager-upload lifecycle once a threadId exists.
  status: 'pending' | 'uploading' | 'ready' | 'error';
  error?: string;
};

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 8;

// What addFiles tells the composer so it can surface skipped files inline rather
// than silently dropping them at the trust boundary.
export type AddFilesResult = { accepted: number; rejected: number };

// One spot for the skipped-files copy so both composers say the same thing and
// the numbers (10MB / 8) track the constants above.
export function skippedNotice(rejected: number): string | null {
  if (rejected <= 0) return null;
  return `${rejected} file${rejected === 1 ? '' : 's'} skipped — PNG/JPEG/WEBP under 10MB, max ${MAX_FILES}.`;
}

function clientId() {
  return `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function isAllowedMime(m: string): m is (typeof ALLOWED_MIMES)[number] {
  return (ALLOWED_MIMES as readonly string[]).includes(m);
}

// One file's init + presigned PUT, returning the server attachment id. Shared by
// both upload paths (eager `upload`, compose `uploadAll`) so the two-step dance
// lives in one place. The PUT goes to R2's presigned URL, not our API — the one
// place a raw fetch outside lib/api-client is correct (no auth header, no
// contract response to validate; success is the 200 itself).
async function putOne(
  tid: string,
  item: PendingAttachment,
  getToken: () => Promise<string | null>,
): Promise<string> {
  const init = await initAttachment(tid, { mime: item.mime, byte_len: item.byteLen }, getToken);
  const putRes = await fetch(init.put_url, {
    method: 'PUT',
    headers: { 'Content-Type': item.mime },
    body: item.file,
  });
  if (!putRes.ok) throw new Error(`upload failed: ${putRes.status}`);
  return init.id;
}

export function useAttachmentUploader(
  threadId: string | null,
  getToken: () => Promise<string | null>,
) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  // Track local blob URLs so we can revoke them on remove / unmount. The hook
  // owns this lifecycle entirely; consumers only read `localUrl`.
  const urlsRef = useRef<Map<string, string>>(new Map());
  // Mirrors items.length so addFiles can claim slots WITHOUT reading state inside
  // a setItems updater (which StrictMode runs twice). Synced after every render
  // and adjusted eagerly within a tick so paste+drop races don't both claim the
  // same slots.
  const itemCountRef = useRef(0);
  useEffect(() => {
    itemCountRef.current = items.length;
  }, [items.length]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((p) => p.clientId !== id));
    itemCountRef.current = Math.max(0, itemCountRef.current - 1);
    const url = urlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(id);
    }
  }, []);

  const upload = useCallback(
    async (tid: string, queued: PendingAttachment[]) => {
      await Promise.all(
        queued.map(async (q) => {
          try {
            const serverId = await putOne(tid, q, getToken);
            setItems((prev) =>
              prev.map((p) =>
                p.clientId === q.clientId ? { ...p, serverId, status: 'ready' as const } : p,
              ),
            );
          } catch (e) {
            setItems((prev) =>
              prev.map((p) =>
                p.clientId === q.clientId
                  ? { ...p, status: 'error' as const, error: (e as Error).message }
                  : p,
              ),
            );
          }
        }),
      );
    },
    [getToken],
  );

  const addFiles = useCallback(
    async (files: File[]): Promise<AddFilesResult> => {
      // Trust-boundary gate: drop wrong-MIME / oversize files. Caller surfaces
      // `rejected` so the user learns why a file didn't land.
      const valid: File[] = [];
      for (const f of files) {
        if (!isAllowedMime(f.type)) continue;
        if (f.size > MAX_BYTES) continue;
        valid.push(f);
      }
      // Claim slots against the slot count captured for THIS call, then mint blob
      // URLs only for the claimed files. The setItems updater stays pure (just
      // appends the pre-built list) so React's StrictMode double-invoke can't
      // double-mint URLs or double-append — the side effects live out here.
      const slotsLeft = Math.max(0, MAX_FILES - itemCountRef.current);
      const claimed = valid.slice(0, slotsLeft);

      const built: PendingAttachment[] = claimed.map((file) => {
        const id = clientId();
        const localUrl = URL.createObjectURL(file);
        urlsRef.current.set(id, localUrl);
        return {
          clientId: id,
          serverId: null,
          file,
          localUrl,
          mime: file.type as PendingAttachment['mime'],
          byteLen: file.size,
          status: threadId ? 'uploading' : 'pending',
        };
      });

      const result: AddFilesResult = {
        accepted: built.length,
        rejected: files.length - built.length,
      };
      if (built.length === 0) return result;

      // Optimistically advance the ref so a same-tick second addFiles (paste +
      // drop racing) claims the remaining slots, not the same ones.
      itemCountRef.current += built.length;
      setItems((prev) => [...prev, ...built]);
      if (threadId) await upload(threadId, built);
      return result;
    },
    [threadId, upload],
  );

  // Compose path: drive init+PUT for every held file once the Thread exists.
  // Returns the resolved server ids in claim order; throws on the first failure
  // so the caller's submit() surfaces the same error as a failed createThread.
  // Mirrors `upload`'s per-item status so the thumbnails show spinner / ready /
  // error, then dedups the two-step dance through `putOne`.
  const uploadAll = useCallback(
    async (tid: string): Promise<string[]> => {
      const ids: string[] = [];
      for (const p of items) {
        // A prior failure stays failed — don't re-PUT an item the user can see
        // is errored; let them remove it and resubmit.
        if (p.status === 'error') continue;
        setItems((prev) =>
          prev.map((q) => (q.clientId === p.clientId ? { ...q, status: 'uploading' as const } : q)),
        );
        try {
          const serverId = await putOne(tid, p, getToken);
          setItems((prev) =>
            prev.map((q) =>
              q.clientId === p.clientId ? { ...q, serverId, status: 'ready' as const } : q,
            ),
          );
          ids.push(serverId);
        } catch (e) {
          setItems((prev) =>
            prev.map((q) =>
              q.clientId === p.clientId
                ? { ...q, status: 'error' as const, error: (e as Error).message }
                : q,
            ),
          );
          throw e;
        }
      }
      return ids;
    },
    [items, getToken],
  );

  const reset = useCallback(() => {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current.clear();
    itemCountRef.current = 0;
    setItems([]);
  }, []);

  const readyIds = items.flatMap((p) => (p.status === 'ready' && p.serverId ? [p.serverId] : []));
  const hasUploading = items.some((p) => p.status === 'uploading');

  return { items, addFiles, remove, reset, uploadAll, readyIds, hasUploading };
}
