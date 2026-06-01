'use client';

import type { Comment } from '@tempo/contracts';
import { useCallback, useMemo, useState } from 'react';

// Per-thread unread-Agent-reply tracking lives in localStorage so the badge
// survives reload, mirroring the `discussion_seen_at` pattern in thread-view.tsx.
// Each CommentCard mounts its own copy; copies don't need to stay in sync
// because each only writes its own commentId slot.

type SeenMap = Record<string, string>;

const keyFor = (threadId: string) => `tempo:thread:${threadId}:comments:seen-reply-ids`;

function readSeenMap(threadId: string): SeenMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(keyFor(threadId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

export function useUnreadAgentReplies(
  threadId: string,
  comment: Comment,
): { unreadCount: number; markSeen: () => void } {
  const [seenMap, setSeenMap] = useState<SeenMap>(() => readSeenMap(threadId));

  const unreadCount = useMemo(() => {
    const lastSeenId = seenMap[comment.id] ?? null;
    const idx = lastSeenId == null ? -1 : comment.replies.findIndex((r) => r.id === lastSeenId);
    const startIdx = idx >= 0 ? idx + 1 : 0;
    let n = 0;
    for (let i = startIdx; i < comment.replies.length; i++) {
      if (comment.replies[i]?.author === 'agent') n++;
    }
    return n;
  }, [seenMap, comment.id, comment.replies]);

  const markSeen = useCallback(() => {
    const last = comment.replies[comment.replies.length - 1];
    if (!last) return;
    setSeenMap((prev) => {
      if (prev[comment.id] === last.id) return prev;
      const next = { ...prev, [comment.id]: last.id };
      try {
        window.localStorage.setItem(keyFor(threadId), JSON.stringify(next));
      } catch {
        // localStorage may be unavailable (private mode / quota); the unread
        // state then reappears on reload — the safer failure mode.
      }
      return next;
    });
  }, [threadId, comment.id, comment.replies]);

  return { unreadCount, markSeen };
}
