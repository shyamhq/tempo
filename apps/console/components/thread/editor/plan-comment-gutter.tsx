'use client';

// Notion-style comment margin: icons sit in a narrow column to the right of
// the Plan editor, vertically aligned with each anchor, and scroll with the
// document. Positions are measured relative to the shared plan wrapper (not
// the viewport), so no scroll listener is needed.

import { CommentsExtension } from '@blocknote/core/comments';
import type { Comment } from '@tempo/contracts';
import { CheckCircle2, MessageSquare, MessageSquareOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanEditorHandle } from './plan-editor';

type AnchorPos = {
  top: number;
  /** PM doc offset — tiebreak when multiple comments share one line. */
  pos: number;
};

type LiveComment = {
  comment: Comment;
  anchor: AnchorPos | null;
  /** True when the `comment` mark is no longer in the doc — the icon should
   * read as "unmoored" even though we resolved a position via anchor_block_id. */
  markGone: boolean;
};

// size-7 (28px) + 2px breathing room between stacked icons
const ICON_STEP_PX = 30;
const ORPHAN_SECTION_GAP_PX = 12;
const ORPHAN_LABEL_ABOVE_PX = 20;

export function PlanCommentGutter({
  comments,
  editorHandle,
  anchorRef,
}: {
  comments: Comment[];
  editorHandle: PlanEditorHandle | null;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const railRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Map<
    string,
    { anchor: AnchorPos | null; markGone: boolean }
  > | null>(null);

  useEffect(() => {
    if (!editorHandle) return;
    const store = editorHandle.editor.getExtension(CommentsExtension)?.store;
    if (!store) return;
    setSelectedThreadId(store.state.selectedThreadId);
    return store.subscribe(() => {
      setSelectedThreadId(store.state.selectedThreadId);
    });
  }, [editorHandle]);

  useEffect(() => {
    if (!editorHandle) return;
    const editor = editorHandle.editor;
    const ids = comments.map((c) => c.id);

    const recompute = () => {
      const anchorEl = anchorRef.current;
      if (!anchorEl) return;
      const anchorTop = anchorEl.getBoundingClientRect().top;
      const { byCommentId, byBlockId } = walkPmDoc(editor);
      const commentById = new Map(comments.map((c) => [c.id, c]));
      const next = new Map<string, { anchor: AnchorPos | null; markGone: boolean }>();
      for (const id of ids) {
        const directPos = byCommentId.get(id);
        if (directPos !== undefined) {
          try {
            const coords = editor._tiptapEditor.view.coordsAtPos(directPos);
            next.set(id, {
              anchor: { top: coords.top - anchorTop, pos: directPos },
              markGone: false,
            });
          } catch {
            next.set(id, { anchor: null, markGone: false });
          }
          continue;
        }
        // Mark gone — try the persisted block-id fallback.
        const comment = commentById.get(id);
        const blockId = comment?.anchor_block_id ?? null;
        if (blockId !== null) {
          const blockPos = byBlockId.get(blockId);
          if (blockPos !== undefined) {
            try {
              const coords = editor._tiptapEditor.view.coordsAtPos(blockPos);
              next.set(id, {
                anchor: { top: coords.top - anchorTop, pos: blockPos },
                markGone: true,
              });
              continue;
            } catch {
              // fall through to null
            }
          }
        }
        next.set(id, { anchor: null, markGone: true });
      }
      setPositions(next);
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    };

    editor._tiptapEditor.on('update', schedule);
    editor._tiptapEditor.on('selectionUpdate', schedule);
    window.addEventListener('resize', schedule);

    const observed = new Set<Element>();
    const observe = (el: Element | null | undefined) => {
      if (!el || observed.has(el)) return;
      observed.add(el);
      observer?.observe(el);
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observe(anchorRef.current);
      observe(railRef.current);
      observe(editor._tiptapEditor.view.dom);
    }
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      editor._tiptapEditor.off('update', schedule);
      editor._tiptapEditor.off('selectionUpdate', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [editorHandle, anchorRef, comments]);

  const focusAnchor = useCallback(
    (commentId: string) => {
      if (!editorHandle) return;
      editorHandle.editor.getExtension(CommentsExtension)?.selectThread(commentId);
    },
    [editorHandle],
  );

  const openOrphan = useCallback(
    (commentId: string, e: React.MouseEvent<HTMLButtonElement>) => {
      if (!editorHandle) return;
      const rect = e.currentTarget.getBoundingClientRect();
      editorHandle.openOrphan(commentId, { top: rect.top, right: rect.left });
    },
    [editorHandle],
  );

  const { anchored, orphaned } = useMemo(() => {
    const a: LiveComment[] = [];
    const o: LiveComment[] = [];
    if (positions === null) return { anchored: a, orphaned: o };
    for (const comment of comments) {
      if (comment.resolved_by !== null && !showResolved) continue;
      const entry = positions.get(comment.id);
      const anchor = entry?.anchor ?? null;
      const markGone = entry?.markGone ?? false;
      const lc: LiveComment = { comment, anchor, markGone };
      if (anchor === null) o.push(lc);
      else a.push(lc);
    }
    a.sort((x, y) => {
      const topDiff = (x.anchor?.top ?? 0) - (y.anchor?.top ?? 0);
      if (topDiff !== 0) return topDiff;
      return (x.anchor?.pos ?? 0) - (y.anchor?.pos ?? 0);
    });
    o.sort((x, y) => Date.parse(x.comment.created_at) - Date.parse(y.comment.created_at));
    return { anchored: a, orphaned: o };
  }, [comments, positions, showResolved]);

  const { tops: displayTops, orphanLabelTop } = useMemo(
    () => layoutGutterIcons(anchored, orphaned),
    [anchored, orphaned],
  );

  if (!editorHandle) return null;

  return (
    <div className="relative w-10 shrink-0 self-stretch select-none">
      <div className="absolute inset-0 flex flex-col pt-1">
        <label className="flex items-center gap-1 text-caption text-ink-subtle cursor-pointer mb-2">
          <input
            type="checkbox"
            className="accent-accent"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
        </label>

        <div ref={railRef} className="relative flex-1 min-h-full">
          {orphanLabelTop !== null ? (
            <span
              className="absolute right-0 text-micro-uppercase uppercase font-semibold text-ink-tertiary pointer-events-none"
              style={{ top: orphanLabelTop }}
            >
              Orphaned
            </span>
          ) : null}
          {anchored.map(({ comment, markGone }) => (
            <GutterIcon
              key={comment.id}
              resolved={comment.resolved_by !== null}
              selected={selectedThreadId === comment.id}
              orphaned={markGone}
              fullyDetached={false}
              style={{
                position: 'absolute',
                top: `${displayTops.get(comment.id) ?? 0}px`,
                right: 0,
              }}
              onClick={markGone ? (e) => openOrphan(comment.id, e) : () => focusAnchor(comment.id)}
            />
          ))}
          {orphaned.map(({ comment }) => (
            <GutterIcon
              key={comment.id}
              resolved={comment.resolved_by !== null}
              selected={selectedThreadId === comment.id}
              orphaned
              fullyDetached
              style={{
                position: 'absolute',
                top: `${displayTops.get(comment.id) ?? 0}px`,
                right: 0,
              }}
              onClick={(e) => openOrphan(comment.id, e)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GutterIcon({
  resolved,
  selected,
  style,
  orphaned,
  fullyDetached,
  onClick,
}: {
  resolved: boolean;
  selected?: boolean;
  style?: React.CSSProperties;
  /** True when the comment mark is gone from the doc (block-anchored or detached). */
  orphaned?: boolean;
  /** True only for footer-bucket orphans whose block is also gone. */
  fullyDetached?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const Icon = fullyDetached ? MessageSquareOff : resolved ? CheckCircle2 : MessageSquare;
  const titleParts = [
    resolved ? 'Resolved' : 'Open',
    fullyDetached ? '(detached)' : orphaned ? '(orphaned)' : null,
  ].filter(Boolean);
  return (
    <button
      type="button"
      style={style}
      onClick={onClick}
      disabled={onClick === undefined}
      aria-pressed={selected ?? false}
      title={titleParts.join(' ')}
      className={`relative size-7 inline-flex items-center justify-center rounded-md transition-colors ${
        selected
          ? 'bg-accent/10 text-accent-deep ring-2 ring-accent'
          : orphaned
            ? 'text-brand-warn hover:bg-[color-mix(in_oklab,var(--color-brand-warn)_20%,transparent)]'
            : 'text-ink-subtle hover:text-ink hover:bg-surface-2'
      } ${resolved && !selected ? 'opacity-50' : ''} ${
        orphaned
          ? 'border-2 border-dashed border-brand-warn bg-[color-mix(in_oklab,var(--color-brand-warn)_12%,transparent)]'
          : ''
      } ${onClick === undefined ? 'cursor-default' : ''}`}
    >
      <Icon className="size-icon-sm" aria-hidden />
      {orphaned ? (
        <span
          aria-hidden
          className="absolute -bottom-1 -right-1 size-3 rounded-full bg-brand-warn text-white text-[8px] font-bold leading-none flex items-center justify-center"
          style={{ boxShadow: '0 0 0 2px var(--color-surface-1, white)' }}
        >
          ×
        </span>
      ) : null}
    </button>
  );
}

type LayoutEntry = { id: string; preferred: number };

/** One pass for anchored, then orphans below; final spread avoids all overlap. */
function layoutGutterIcons(
  anchored: LiveComment[],
  orphaned: LiveComment[],
): { tops: Map<string, number>; orphanLabelTop: number | null } {
  const anchoredTops = spreadAnchoredIcons(anchored);
  let anchoredBottom = -Infinity;
  for (const top of anchoredTops.values()) {
    anchoredBottom = Math.max(anchoredBottom, top + ICON_STEP_PX);
  }

  const entries: LayoutEntry[] = [];
  for (const { comment } of anchored) {
    const preferred = anchoredTops.get(comment.id);
    if (preferred === undefined) continue;
    entries.push({ id: comment.id, preferred });
  }

  // Floor at ORPHAN_LABEL_ABOVE_PX so the "Orphaned" label always has room
  // above the first orphan icon, even when no anchored comments exist
  // (anchoredBottom = -Infinity → would otherwise collapse the gap to 0).
  const orphanBase =
    orphaned.length > 0
      ? Math.max(ORPHAN_LABEL_ABOVE_PX, anchoredBottom + ORPHAN_SECTION_GAP_PX)
      : 0;
  for (let i = 0; i < orphaned.length; i++) {
    const orphan = orphaned[i];
    if (!orphan) continue;
    entries.push({ id: orphan.comment.id, preferred: orphanBase + i * ICON_STEP_PX });
  }

  entries.sort((a, b) => a.preferred - b.preferred);
  const tops = new Map<string, number>();
  let lastBottom = -Infinity;
  for (const { id, preferred } of entries) {
    const top = Math.max(preferred, lastBottom);
    tops.set(id, top);
    lastBottom = top + ICON_STEP_PX;
  }

  const firstOrphan = orphaned[0];
  const firstOrphanTop = firstOrphan ? tops.get(firstOrphan.comment.id) : undefined;
  const orphanLabelTop =
    firstOrphanTop !== undefined
      ? Math.max(
          anchoredBottom === -Infinity ? 0 : anchoredBottom + 2,
          firstOrphanTop - ORPHAN_LABEL_ABOVE_PX,
        )
      : null;

  return { tops, orphanLabelTop };
}

function spreadAnchoredIcons(anchored: LiveComment[]): Map<string, number> {
  const out = new Map<string, number>();
  let lastBottom = -Infinity;
  for (const { comment, anchor } of anchored) {
    if (!anchor) continue;
    const top = Math.max(anchor.top, lastBottom);
    out.set(comment.id, top);
    lastBottom = top + ICON_STEP_PX;
  }
  return out;
}

function walkPmDoc(editor: PlanEditorHandle['editor']): {
  byCommentId: Map<string, number>;
  byBlockId: Map<string, number>;
} {
  const byCommentId = new Map<string, number>();
  const byBlockId = new Map<string, number>();
  // biome-ignore lint/suspicious/noExplicitAny: ProseMirror node callback is untyped in our graph
  editor._tiptapEditor.state.doc.descendants((node: any, pos: number) => {
    if (node.type?.name === 'blockContainer') {
      const id = node.attrs?.id;
      if (typeof id === 'string' && id.length > 0) byBlockId.set(id, pos);
      return; // children are still walked by `descendants`
    }
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== 'comment') continue;
      const threadId = mark.attrs.threadId as string | undefined;
      if (typeof threadId !== 'string' || threadId.length === 0) continue;
      if (!byCommentId.has(threadId)) byCommentId.set(threadId, pos);
    }
  });
  return { byCommentId, byBlockId };
}
