'use client';

// The comment margin rail: one marker per anchored Comment thread, aligned to
// its anchor's vertical position beside the plan doc column. Click a marker to
// focus that thread's highlight and open its card. Resolved threads dim; a
// thread with Agent replies the Dev hasn't seen shows an unseen dot.
//
// Anchor positions come from BlockNote's documented CommentsExtension store
// (`threadPositions: Map<id,{from,to}>` + `selectedThreadId`) rather than a
// hand-walk of the ProseMirror doc — the extension keeps that map current as
// the Plan is edited. We convert each thread's `from` offset to a pixel Y with
// `coordsAtPos`, measured relative to the rail's own container so it scrolls
// with the document (no scroll listener), then spread overlapping markers.
//
// Presentational: resolved state + unseen counts read the comments slice; the
// only writes are selectThread (focus) and markCommentSeen (read state).

import { CommentsExtension } from '@blocknote/core/comments';
import type { useCreateBlockNote } from '@blocknote/react';
import { Check, MessageSquare } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useComments, useThreadStore } from '@/store';

type Editor = ReturnType<typeof useCreateBlockNote>;

// 28px marker + 2px gap, so stacked markers never overlap.
const MARKER_STEP_PX = 30;

export function CommentGutter({ editorRef }: { editorRef: RefObject<Editor | null> }) {
  const comments = useComments();
  const commentSeenAt = useThreadStore((s) => s.commentSeenAt);
  const markCommentSeen = useThreadStore((s) => s.markCommentSeen);

  const railRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  // PM `from` offset per thread id, kept fresh by the extension store; null
  // until the editor + extension exist.
  const [anchorTops, setAnchorTops] = useState<Map<string, number>>(new Map());

  // Track the selected thread from the extension store, and mark it seen when
  // selection CHANGES to a thread (opening its card = the Dev has read it). The
  // store emits on every edit/selection tick while a card is open, so compare
  // against the last id — otherwise commentSeenAt would be rewritten on every
  // emission and the unseen dot could never persist.
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

  // Measure each anchored thread's pixel Y relative to the rail container, on
  // every edit / selection / resize. RAF-debounced; positions live in state so
  // the markers re-layout. threadPositions is the extension's source of truth
  // for which threads are still anchored in the doc.
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
      const next = new Map<string, number>();
      for (const [id, range] of store.state.threadPositions) {
        try {
          const coords = tiptap.view.coordsAtPos(range.from);
          next.set(id, coords.top - railTop);
        } catch {
          // Position not resolvable this frame (mid-transaction) — skip; the
          // next update re-measures.
        }
      }
      setAnchorTops(next);
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

  const unseenByComment = useMemo(() => {
    const out = new Set<string>();
    for (const c of comments) {
      const seen = commentSeenAt[c.id] ?? null;
      const hasUnseen = c.replies.some(
        (r) => r.author_user_id === null && (!seen || r.created_at > seen),
      );
      if (hasUnseen) out.add(c.id);
    }
    return out;
  }, [comments, commentSeenAt]);

  const focus = useCallback(
    (id: string) => {
      // selectThread flips the extension's selectedThreadId, which the store
      // subscription (single writer, lastId-guarded) marks seen — no direct call.
      editorRef.current?.getExtension(CommentsExtension)?.selectThread(id, true);
    },
    [editorRef],
  );

  // Build the visible markers: an anchored thread (its id appears in anchorTops)
  // keeps its resolved/unseen state from the slice. Sort by Y, then spread so
  // none overlap.
  const markers = useMemo(() => {
    const resolved = new Map(comments.map((c) => [c.id, c.resolved_by_user_id !== null]));
    const rows = [...anchorTops.entries()]
      .filter(([id]) => resolved.has(id))
      .map(([id, top]) => ({ id, top, resolved: resolved.get(id) ?? false }))
      .sort((a, b) => a.top - b.top);

    let lastBottom = Number.NEGATIVE_INFINITY;
    return rows.map((row) => {
      const top = Math.max(row.top, lastBottom);
      lastBottom = top + MARKER_STEP_PX;
      return { ...row, top };
    });
  }, [anchorTops, comments]);

  return (
    <div ref={railRef} className="relative w-7 shrink-0 select-none">
      {markers.map((m) => (
        <GutterMarker
          key={m.id}
          top={m.top}
          resolved={m.resolved}
          selected={selectedId === m.id}
          unseen={unseenByComment.has(m.id)}
          onClick={() => focus(m.id)}
        />
      ))}
    </div>
  );
}

function GutterMarker({
  top,
  resolved,
  selected,
  unseen,
  onClick,
}: {
  top: number;
  resolved: boolean;
  selected: boolean;
  unseen: boolean;
  onClick: () => void;
}) {
  const Icon = resolved ? Check : MessageSquare;
  const tone = selected
    ? 'bg-hl-active text-ink ring-1 ring-[var(--tp-hl-line)]'
    : 'text-ink-3 hover:bg-inset hover:text-ink';
  const dim = resolved && !selected && !unseen ? 'opacity-50' : '';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={resolved ? 'Resolved comment' : 'Comment'}
      style={{ top }}
      className={`absolute right-0 inline-flex size-7 items-center justify-center rounded-md transition-colors ${tone} ${dim}`}
    >
      <Icon className="size-[15px]" aria-hidden />
      {unseen && !selected ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 size-[7px] rounded-full bg-hl-line ring-2 ring-canvas"
        />
      ) : null}
    </button>
  );
}
