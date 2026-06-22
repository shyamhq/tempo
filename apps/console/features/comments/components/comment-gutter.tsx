'use client';

// The comment margin rail: one marker per Comment thread, aligned to its anchor's
// vertical position beside the plan doc column. Click a marker to focus that
// thread's highlight and open its card. Resolved threads dim; a thread with Agent
// replies the Dev hasn't seen shows a numeric unread badge.
//
// Anchoring is two-tier. A live `comment` mark resolves through BlockNote's
// documented CommentsExtension store (`threadPositions: Map<id,{from,to}>`),
// which the extension keeps current as the Plan is edited. When the Dev deletes
// the marked text the mark is gone from `threadPositions`, so we fall back to the
// thread's persisted `anchor_block_id`: a one-pass PM-doc walk maps block ids to
// positions, and the marker re-anchors to its block (rendered "unmoored") instead
// of vanishing. We convert each resolved offset to a pixel Y with `coordsAtPos`,
// measured relative to the rail's own container so it scrolls with the document
// (no scroll listener), then spread overlapping markers.
//
// Presentational: resolved state + unread counts read the comments slice; the
// only writes are selectThread (focus) and markCommentSeen (read state).

import { CommentsExtension } from '@blocknote/core/comments';
import type { useCreateBlockNote } from '@blocknote/react';
import { Check, MessageSquare } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useComments, useThreadStore } from '@/store';

type Editor = ReturnType<typeof useCreateBlockNote>;

// Pixel Y (relative to the rail) plus whether the live mark is gone (resolved via
// the anchor_block_id fallback).
type Anchor = { top: number; markGone: boolean };

// 28px marker + 2px gap, so stacked markers never overlap.
const MARKER_STEP_PX = 30;

export function CommentGutter({ editorRef }: { editorRef: RefObject<Editor | null> }) {
  const comments = useComments();
  const commentSeenAt = useThreadStore((s) => s.commentSeenAt);
  const markCommentSeen = useThreadStore((s) => s.markCommentSeen);

  // The block-id fallback reads the live comments inside the position effect
  // without making it a dependency (which would re-subscribe the tiptap/store
  // listeners on every reply). anchor_block_id is static per comment, so a ref is
  // enough — a mark add/delete already re-runs recompute via the store subscription.
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const railRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  // Resolved anchor per thread id; null until the editor + extension exist.
  const [anchors, setAnchors] = useState<Map<string, Anchor>>(new Map());

  // Track the selected thread from the extension store, and mark it seen when
  // selection CHANGES to a thread (opening its card = the Dev has read it). The
  // store emits on every edit/selection tick while a card is open, so compare
  // against the last id — otherwise commentSeenAt would be rewritten on every
  // emission and the unread badge could never persist.
  useEffect(() => {
    const editor = editorRef.current;
    const store = editor?.getExtension(CommentsExtension)?.store;
    if (!store) return;
    let lastId: string | undefined;
    const sync = () => {
      const id = store.state.selectedThreadId;
      setSelectedId(id);
      if (id !== lastId) {
        lastId = id;
        if (typeof id === 'string') markCommentSeen(id);
      }
    };
    sync();
    return store.subscribe(sync);
  }, [editorRef, markCommentSeen]);

  // Measure each thread's pixel Y relative to the rail container, on every edit /
  // selection / resize. RAF-debounced; positions live in state so the markers
  // re-layout. A thread missing from `threadPositions` (its mark was deleted)
  // re-anchors to its anchor_block_id block via a single doc walk, built lazily
  // only when at least one thread needs it.
  useEffect(() => {
    const editor = editorRef.current;
    const tiptap = editor?._tiptapEditor;
    const store = editor?.getExtension(CommentsExtension)?.store;
    if (!editor || !tiptap || !store) return;

    let frame = 0;
    const recompute = () => {
      const rail = railRef.current;
      if (!rail) return;
      const railTop = rail.getBoundingClientRect().top;
      const toTop = (pos: number): number | null => {
        try {
          return tiptap.view.coordsAtPos(pos).top - railTop;
        } catch {
          // Position not resolvable this frame (mid-transaction) — the next
          // update re-measures.
          return null;
        }
      };

      const next = new Map<string, Anchor>();
      let blockPos: Map<string, number> | null = null;
      for (const c of commentsRef.current) {
        const range = store.state.threadPositions.get(c.id);
        if (range) {
          const top = toTop(range.from);
          if (top !== null) next.set(c.id, { top, markGone: false });
          continue;
        }
        // Mark gone — fall back to the persisted block id (lazy doc walk).
        if (!c.anchor_block_id) continue;
        if (blockPos === null) blockPos = blockPositions(tiptap);
        const pos = blockPos.get(c.anchor_block_id);
        if (pos === undefined) continue;
        const top = toTop(pos);
        if (top !== null) next.set(c.id, { top, markGone: true });
      }
      setAnchors(next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    };

    tiptap.on('update', schedule);
    tiptap.on('selectionUpdate', schedule);
    window.addEventListener('resize', schedule);
    const unsubStore = store.subscribe(schedule);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (observer && railRef.current) observer.observe(railRef.current);
    if (observer) observer.observe(tiptap.view.dom);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      tiptap.off('update', schedule);
      tiptap.off('selectionUpdate', schedule);
      window.removeEventListener('resize', schedule);
      unsubStore();
      observer?.disconnect();
    };
  }, [editorRef]);

  // Count of Agent replies the Dev hasn't seen since last opening each thread.
  const unreadByComment = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of comments) {
      const seen = commentSeenAt[c.id] ?? null;
      const n = c.replies.filter(
        (r) => r.author_user_id === null && (!seen || r.created_at > seen),
      ).length;
      if (n > 0) out.set(c.id, n);
    }
    return out;
  }, [comments, commentSeenAt]);

  const focus = useCallback(
    (id: string) => {
      // selectThread flips the extension's selectedThreadId, which the store
      // subscription (single writer, lastId-guarded) marks seen — no direct call.
      // A markGone thread has no highlight for BlockNote to anchor a card to, so
      // this is best-effort: the marker + unread badge keep the comment from being
      // lost even when its card can't re-open.
      editorRef.current?.getExtension(CommentsExtension)?.selectThread(id, true);
    },
    [editorRef],
  );

  // Build the visible markers: a positioned thread keeps its resolved/markGone
  // state. Sort by Y, then spread so none overlap.
  const markers = useMemo(() => {
    const resolved = new Map(comments.map((c) => [c.id, c.resolved_by_user_id !== null]));
    const rows = [...anchors.entries()]
      .filter(([id]) => resolved.has(id))
      .map(([id, a]) => ({
        id,
        top: a.top,
        markGone: a.markGone,
        resolved: resolved.get(id) ?? false,
      }))
      .sort((a, b) => a.top - b.top);

    let lastBottom = Number.NEGATIVE_INFINITY;
    return rows.map((row) => {
      const top = Math.max(row.top, lastBottom);
      lastBottom = top + MARKER_STEP_PX;
      return { ...row, top };
    });
  }, [anchors, comments]);

  return (
    <div ref={railRef} className="relative w-7 shrink-0 select-none">
      {markers.map((m) => (
        <GutterMarker
          key={m.id}
          top={m.top}
          resolved={m.resolved}
          markGone={m.markGone}
          selected={selectedId === m.id}
          unread={unreadByComment.get(m.id) ?? 0}
          onClick={() => focus(m.id)}
        />
      ))}
    </div>
  );
}

function GutterMarker({
  top,
  resolved,
  markGone,
  selected,
  unread,
  onClick,
}: {
  top: number;
  resolved: boolean;
  markGone: boolean;
  selected: boolean;
  unread: number;
  onClick: () => void;
}) {
  const Icon = resolved ? Check : MessageSquare;
  // Unread takes precedence over selected/resolved styling so a new Agent reply is
  // the loudest signal in the gutter; resolved markers don't dim while unread.
  const hasUnread = unread > 0 && !selected;
  let tone: string;
  if (selected) {
    tone = 'bg-hl-active text-ink ring-1 ring-[var(--tp-hl-line)]';
  } else if (hasUnread) {
    tone = 'bg-hl-active text-ink';
  } else if (markGone) {
    tone = 'border border-dashed border-ink-3 text-ink-3 hover:bg-inset hover:text-ink';
  } else {
    tone = 'text-ink-3 hover:bg-inset hover:text-ink';
  }
  const dim = resolved && !selected && !hasUnread ? 'opacity-50' : '';
  const title = [
    resolved ? 'Resolved comment' : 'Comment',
    markGone ? '(anchor text edited)' : null,
    unread > 0 ? `${unread} new Agent ${unread === 1 ? 'reply' : 'replies'}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      style={{ top }}
      className={`absolute right-0 inline-flex size-7 items-center justify-center rounded-md transition-colors ${tone} ${dim}`}
    >
      <Icon className="size-[15px]" aria-hidden />
      {hasUnread ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-hl-line px-1 text-[10px] font-semibold leading-none text-canvas ring-2 ring-canvas"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </button>
  );
}

// Map every block container's id to its PM doc position, for the anchor_block_id
// fallback. ProseMirror's `descendants` walk is the documented way to locate a
// node by attribute.
function blockPositions(tiptap: Editor['_tiptapEditor']): Map<string, number> {
  const out = new Map<string, number>();
  // biome-ignore lint/suspicious/noExplicitAny: the descendants callback node is untyped on BlockNote's _tiptapEditor
  tiptap.state.doc.descendants((node: any, pos: number) => {
    // No `return false` — blocks can nest, so children must still be walked.
    if (node.type?.name !== 'blockContainer') return;
    const id = node.attrs?.id;
    if (typeof id === 'string' && id.length > 0) out.set(id, pos);
  });
  return out;
}
