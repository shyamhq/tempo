'use client';

// One shared PM-doc walk per recompute builds Map<threadId, pos>; per-icon
// `view.coordsAtPos(pos)` derives top. Never one walk per thread — the cost
// would compound by O(threads × doc-size) per keystroke.

import type { ThreadData } from '@blocknote/core/comments';
import { CheckCircle2, MessageSquare, MessageSquareOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanEditorHandle } from './plan-editor';

type LiveThread = {
  threadId: string;
  thread: ThreadData;
  top: number | null;
};

export function PlanCommentGutter({
  editorHandle,
  rootRef,
}: {
  editorHandle: PlanEditorHandle | null;
  rootRef: React.RefObject<HTMLElement | null>;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [threads, setThreads] = useState<Map<string, ThreadData>>(new Map());
  // `null` sentinel = haven't measured yet. Distinguishes "no anchor found"
  // (orphan) from "first frame, recompute pending" (everything-is-orphan
  // flash). Until the first measurement lands, we render nothing.
  const [positions, setPositions] = useState<Map<string, number | null> | null>(null);
  const positionsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!editorHandle) return;
    setThreads(editorHandle.bridge.getThreads());
    return editorHandle.bridge.subscribe((m) => setThreads(new Map(m)));
  }, [editorHandle]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rootRef.current is read inside; the ref itself is stable
  useEffect(() => {
    if (!editorHandle) return;
    const editor = editorHandle.editor;
    // Snapshot the thread IDs at effect setup. The recompute closure iterates
    // this snapshot; when the thread set changes, the effect re-runs and the
    // snapshot is rebuilt. Reading `threads` directly inside `recompute` would
    // make `schedule` (fired by transactions) close over stale state.
    const ids = [...threads.keys()];

    const recompute = () => {
      const positionsMap = walkPmDocForCommentMarks(editor);
      positionsRef.current = positionsMap;
      const next = new Map<string, number | null>();
      const rootTop = rootRef.current?.getBoundingClientRect().top ?? 0;
      for (const threadId of ids) {
        const pos = positionsMap.get(threadId);
        if (pos === undefined) {
          next.set(threadId, null);
          continue;
        }
        try {
          const coords = editor._tiptapEditor.view.coordsAtPos(pos);
          next.set(threadId, coords.top - rootTop);
        } catch {
          next.set(threadId, null);
        }
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

    let observer: ResizeObserver | null = null;
    if (rootRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observer.observe(rootRef.current);
    }
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      editor._tiptapEditor.off('update', schedule);
      editor._tiptapEditor.off('selectionUpdate', schedule);
      observer?.disconnect();
    };
  }, [editorHandle, threads]);

  const focusAnchor = useCallback(
    (threadId: string) => {
      if (!editorHandle) return;
      const pos = positionsRef.current.get(threadId);
      if (pos === undefined) return;
      editorHandle.editor._tiptapEditor.commands.setTextSelection(pos);
      editorHandle.editor._tiptapEditor.commands.focus();
    },
    [editorHandle],
  );

  const { anchored, orphaned } = useMemo(() => {
    const a: LiveThread[] = [];
    const o: LiveThread[] = [];
    if (positions === null) return { anchored: a, orphaned: o };
    for (const [threadId, thread] of threads) {
      if (thread.resolved && !showResolved) continue;
      const top = positions.get(threadId) ?? null;
      const entry: LiveThread = { threadId, thread, top };
      if (top === null) o.push(entry);
      else a.push(entry);
    }
    a.sort((x, y) => (x.top ?? 0) - (y.top ?? 0));
    o.sort((x, y) => x.thread.createdAt.getTime() - y.thread.createdAt.getTime());
    return { anchored: a, orphaned: o };
  }, [threads, positions, showResolved]);

  if (!editorHandle) return null;

  return (
    <aside className="relative w-12 shrink-0 select-none">
      <div className="sticky top-[calc(3.5rem+1.5rem)] flex flex-col gap-2">
        <label className="flex items-center gap-1.5 text-caption text-ink-subtle px-1 cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          <span>Resolved</span>
        </label>

        <div className="relative h-[calc(100dvh-3.5rem-6rem)]">
          {anchored.map(({ threadId, thread, top }) => (
            <GutterIcon
              key={threadId}
              thread={thread}
              style={{ position: 'absolute', top: `${top ?? 0}px`, left: 0 }}
              onClick={() => focusAnchor(threadId)}
            />
          ))}
        </div>

        {orphaned.length === 0 ? null : (
          <div className="flex flex-col gap-1 pt-3 mt-3 border-t border-hairline">
            <span className="text-micro-uppercase uppercase font-semibold text-ink-tertiary px-1">
              Orphaned
            </span>
            {orphaned.map(({ threadId, thread }) => (
              <GutterIcon key={threadId} thread={thread} orphaned />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function GutterIcon({
  thread,
  style,
  orphaned,
  onClick,
}: {
  thread: ThreadData;
  style?: React.CSSProperties;
  orphaned?: boolean;
  onClick?: () => void;
}) {
  const Icon = orphaned ? MessageSquareOff : thread.resolved ? CheckCircle2 : MessageSquare;
  const titleParts = [thread.resolved ? 'Resolved' : 'Open', orphaned ? '(orphaned)' : null].filter(
    Boolean,
  );
  return (
    <button
      type="button"
      style={style}
      onClick={onClick}
      disabled={onClick === undefined}
      title={titleParts.join(' ')}
      className={`size-7 inline-flex items-center justify-center rounded-md hover:bg-surface-2 transition-colors text-ink-subtle hover:text-ink ${
        thread.resolved ? 'opacity-50' : ''
      } ${orphaned ? 'border border-dashed border-hairline' : ''} ${
        onClick === undefined ? 'cursor-default' : ''
      }`}
    >
      <Icon className="size-icon-sm" aria-hidden />
    </button>
  );
}

function walkPmDocForCommentMarks(
  editor: PlanEditorHandle['editor'],
): Map<string, number> {
  const out = new Map<string, number>();
  // Tiptap's `descendants` callback is typed `any` once it lands in our
  // module graph (prosemirror-model isn't a direct dep). The Node API we
  // touch — `isText`, `marks`, each mark's `type.name` + `attrs.threadId` —
  // is the stable ProseMirror surface; narrowing here would just rebuild
  // those same shapes.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  editor._tiptapEditor.state.doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== 'comment') continue;
      const threadId = mark.attrs.threadId as string | undefined;
      if (typeof threadId !== 'string' || threadId.length === 0) continue;
      if (!out.has(threadId)) out.set(threadId, pos);
    }
  });
  return out;
}
