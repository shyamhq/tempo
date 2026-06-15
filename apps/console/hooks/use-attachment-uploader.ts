'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkerApi } from '@/hooks/use-worker-api';

// One pending upload's lifecycle: hold the local preview blob URL the
// composer renders into the thumbnail tray, the eventual attachment id the
// Send button passes back to the server, and the upload status so the row
// can show a spinner / error / retry without the composer learning the
// individual steps. `localUrl` is only valid for the page's lifetime.

export type PendingAttachment = {
  // Stable client id for the React key; replaced by the server id once init
  // resolves so the parent's send pass uses the canonical attachment id.
  clientId: string;
  serverId: string | null;
  file: File;
  localUrl: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLen: number;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
};

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 8;

function clientId() {
  return `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function isAllowedMime(m: string): m is (typeof ALLOWED_MIMES)[number] {
  return (ALLOWED_MIMES as readonly string[]).includes(m);
}

export function useAttachmentUploader(threadId: string) {
  const wApi = useWorkerApi();
  const [items, setItems] = useState<PendingAttachment[]>([]);
  // Track local blob URLs so we can revoke them on remove / unmount. The
  // hook owns this lifecycle entirely; consumers only read `localUrl`.
  const urlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((p) => p.clientId !== id));
    const url = urlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(id);
    }
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const accepted: File[] = [];
      for (const f of files) {
        if (!isAllowedMime(f.type)) continue;
        if (f.size > MAX_BYTES) continue;
        accepted.push(f);
      }
      if (accepted.length === 0) return;

      // Atomic claim against the latest state — two concurrent addFiles
      // calls (paste + drop racing) both deciding from a stale `items.length`
      // could push past MAX_FILES otherwise.
      const queued: PendingAttachment[] = [];
      setItems((prev) => {
        let slotsLeft = MAX_FILES - prev.length;
        const claim: PendingAttachment[] = [];
        for (const file of accepted) {
          if (slotsLeft <= 0) break;
          slotsLeft -= 1;
          const id = clientId();
          const localUrl = URL.createObjectURL(file);
          urlsRef.current.set(id, localUrl);
          claim.push({
            clientId: id,
            serverId: null,
            file,
            localUrl,
            mime: file.type as PendingAttachment['mime'],
            byteLen: file.size,
            status: 'uploading',
          });
        }
        queued.push(...claim);
        return [...prev, ...claim];
      });
      if (queued.length === 0) return;

      await Promise.all(
        queued.map(async (q) => {
          try {
            const init = await wApi.initAttachment(threadId, {
              mime: q.mime,
              byte_len: q.byteLen,
            });
            const putRes = await fetch(init.put_url, {
              method: 'PUT',
              headers: { 'Content-Type': q.mime },
              body: q.file,
            });
            if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status}`);
            setItems((prev) =>
              prev.map((p) =>
                p.clientId === q.clientId
                  ? { ...p, serverId: init.id, status: 'ready' as const }
                  : p,
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
    [threadId, wApi],
  );

  const reset = useCallback(() => {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current.clear();
    setItems([]);
  }, []);

  const readyIds = items.flatMap((p) => (p.status === 'ready' && p.serverId ? [p.serverId] : []));
  const allReady = items.length > 0 && items.every((p) => p.status === 'ready');
  const hasUploading = items.some((p) => p.status === 'uploading');

  return { items, addFiles, remove, reset, readyIds, allReady, hasUploading };
}
