'use client';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import type { User } from '@blocknote/core/comments';
import { CommentsExtension } from '@blocknote/core/comments';
import { BlockNoteView } from '@blocknote/mantine';
import {
  FloatingComposerController,
  FloatingThreadController,
  useCreateBlockNote,
} from '@blocknote/react';
import { flip, offset, shift } from '@floating-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import type { Comment } from '@tempo/contracts';
import DOMPurify from 'isomorphic-dompurify';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { planSchema } from '@/lib/plan-schema';
import { CommentThreadBridge } from './comment-thread-bridge';
import {
  COMMENT_CARD_VIEWPORT,
  resolveVerticalCardTop,
} from './comment-card-placement';
import { PlanCommentCard } from './plan-comment-card';
import { PlanCommentComposer } from './plan-comment-composer';

const FLOATING_THREAD_UI = {
  useFloatingOptions: {
    middleware: [
      offset(COMMENT_CARD_VIEWPORT.gap),
      shift({
        padding: {
          top: COMMENT_CARD_VIEWPORT.header + COMMENT_CARD_VIEWPORT.padding,
          bottom: COMMENT_CARD_VIEWPORT.padding,
          left: COMMENT_CARD_VIEWPORT.padding,
          right: COMMENT_CARD_VIEWPORT.padding,
        },
      }),
      flip({
        padding: {
          top: COMMENT_CARD_VIEWPORT.header + COMMENT_CARD_VIEWPORT.padding,
          bottom: COMMENT_CARD_VIEWPORT.padding,
          left: COMMENT_CARD_VIEWPORT.padding,
          right: COMMENT_CARD_VIEWPORT.padding,
        },
        fallbackPlacements: ['top', 'bottom'] as const,
      }),
    ],
  },
};

// Mermaid preview is layered on the rendered DOM rather than baked into the
// schema, so the Markdown wire format stays a vanilla fenced code block. The
// hook scans `pre > code.language-mermaid` after each editor change and
// injects an SVG sibling. Cached by source-hash inside the effect so steady-
// state typing in non-mermaid blocks is essentially free.
type Mermaid = typeof import('mermaid')['default'];
let mermaidPromise: Promise<Mermaid> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
      return m.default;
    });
  }
  return mermaidPromise;
}

const MERMAID_PREVIEW_CLASS = 'tempo-mermaid-preview';
const MERMAID_HASH_ATTR = 'data-mermaid-source-hash';

function hashSource(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// MVP single-user Console. Identity carries over from the existing Tiptap
// surface — we never render multi-author avatars because there's only ever
// one Dev.
const DEV_USER: User = { id: 'dev', username: 'Dev', avatarUrl: '' };

const resolveUsers = (userIds: string[]): Promise<User[]> =>
  Promise.resolve(
    userIds.map((id) => (id === DEV_USER.id ? DEV_USER : { id, username: id, avatarUrl: '' })),
  );

export type PlanEditorHandle = {
  /** Current editor state as ProseMirror JSON — the at-rest format. The
   * blocks-JSON projection drops `blocknoteIgnore` marks (comments,
   * suggestions); PM JSON preserves them. */
  getPmJson: () => unknown;
  /** Apply server-side PM JSON to the live editor without firing onUpdate.
   * Used both for the initial load and for the live-reload-on-agent-edit
   * effect in `thread-view.tsx`. */
  applyPmJson: (pmJson: unknown) => void;
  /** Lossy Markdown export of the current document. Used for the Copy Plan
   * handoff card; not for round-trip persistence. */
  toMarkdown: () => Promise<string>;
  /** Escape hatch for the comment gutter only — gives it the live BlockNote
   * editor so it can walk the PM doc and convert mark positions to viewport
   * Y via coordsAtPos. Do not consume from anywhere else; if another caller
   * needs this, lift the dependent logic into the editor module. */
  editor: ReturnType<typeof useCreateBlockNote>;
  /** Escape hatch for orphan-thread popover state inside the editor tree. */
  bridge: CommentThreadBridge;
  /** Open a `PlanCommentCard` for an orphan thread, positioned at the given
   * viewport anchor (the gutter icon's bounding rect). The card renders
   * inside `BlockNoteView`'s React tree so its hooks (`useBlockNoteEditor`,
   * `useUsers`) resolve correctly — the gutter cannot render the card itself
   * because it lives outside that context. */
  openOrphan: (threadId: string, anchor: { top: number; right: number }) => void;
};

export function PlanEditor({
  threadId,
  comments,
  onUserEdit,
  onReady,
  readOnly = false,
}: {
  threadId: string;
  /** Authoritative comments snapshot from the parent's TanStack Query cache.
   * The bridge reads from this on every getThreads call so the editor never
   * needs its own copy. */
  comments: Comment[];
  onUserEdit?: () => void;
  onReady?: (handle: PlanEditorHandle) => void;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  // Orphan thread popover. The gutter triggers this via the handle; the
  // popover renders PlanCommentCard inside BlockNoteView (below) so the
  // card's hooks see the right context.
  const [orphanOpen, setOrphanOpen] = useState<{
    threadId: string;
    top: number;
    right: number;
  } | null>(null);

  // Editor identity is needed by `captureAnchor` inside the bridge. The
  // bridge is constructed before `useCreateBlockNote` runs, so we thread the
  // editor in via a ref that we assign synchronously right after creation
  // (no useEffect — that would leave a one-render null window where an
  // unlucky `createThread` would post an empty anchor).
  const editorRef = useRef<ReturnType<typeof useCreateBlockNote> | null>(null);

  // The bridge is stable across renders so BlockNote's subscribers don't
  // churn. It reads comments through the ref so changes to the comments
  // snapshot propagate without rebuilding the editor.
  const bridge = useMemo(
    () =>
      new CommentThreadBridge({
        threadId,
        devUser: DEV_USER,
        getCommentsSnapshot: () => commentsRef.current,
        onCommentsChanged: (next) => {
          commentsRef.current = next;
          qc.setQueryData(['thread', threadId], (prev) =>
            prev ? { ...prev, comments: next } : prev,
          );
        },
        invalidate: () => qc.invalidateQueries({ queryKey: ['thread', threadId] }),
        captureAnchor: () => readAnchor(editorRef.current),
      }),
    [threadId, qc],
  );

  // Fire a bridge.emitChange whenever the comments snapshot changes so any
  // CommentsExtension subscribers re-render with the new thread states.
  // `comments` is the change trigger — `bridge.emitChange` reads via the ref.
  // biome-ignore lint/correctness/useExhaustiveDependencies: comments is the trigger
  useEffect(() => {
    bridge.emitChange();
  }, [bridge, comments]);

  // Mount empty. `initialContent` only accepts blocks, not PM JSON; the
  // parent (thread-view.tsx) calls `applyPmJson` via the handle once initial
  // PM JSON is available. This is the two-step pattern the BlockNote /
  // YjsThreadStore reference also uses.
  const editor = useCreateBlockNote(
    {
      schema: planSchema,
      extensions: [CommentsExtension({ threadStore: bridge, resolveUsers })],
    },
    [bridge],
  );
  editorRef.current = editor;

  // Apply readOnly after construction — useCreateBlockNote does not take it
  // as an option but the editor exposes the toggle.
  useEffect(() => {
    editor.isEditable = !readOnly;
  }, [editor, readOnly]);

  // Surface a handle to the parent on mount. `applyPmJson` is the load path
  // (initial + live-reload from Agent edits); `getPmJson` snapshots the
  // editor's full PM state for save.
  useEffect(() => {
    onReady?.({
      getPmJson: () => editor._tiptapEditor.getJSON(),
      applyPmJson: (pmJson) => {
        // `emitUpdate: false` suppresses the editor's onChange callback so
        // the initial load (and live-reload from Agent) doesn't masquerade
        // as a Dev edit and trigger the auto-save loop.
        editor._tiptapEditor.commands.setContent(pmJson as never, { emitUpdate: false });
      },
      toMarkdown: async () => editor.blocksToMarkdownLossy(editor.document),
      editor,
      bridge,
      openOrphan: (threadId, anchor) => setOrphanOpen({ threadId, ...anchor }),
    });
  }, [editor, bridge, onReady]);

  // Drop the popover the moment the underlying thread disappears (delete
  // from inside the card, or external delete via SSE). `comments` is the
  // trigger — bridge.getThreads() reads through the snapshot ref, so the
  // effect needs to re-run when the snapshot changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: comments is the trigger
  useEffect(() => {
    if (orphanOpen === null) return;
    if (!bridge.getThreads().has(orphanOpen.threadId)) setOrphanOpen(null);
  }, [orphanOpen, bridge, comments]);

  // Document identity changes on every edit; the effect re-scans the rendered
  // DOM for mermaid blocks and refreshes any out-of-date previews. The doc
  // is the trigger, not a value read inside the effect.
  const document = editor.document;
  // biome-ignore lint/correctness/useExhaustiveDependencies: document is the trigger
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      const codes = root.querySelectorAll<HTMLElement>('pre > code.language-mermaid');
      if (codes.length === 0) return;
      const mermaid = await loadMermaid();
      if (cancelled) return;
      for (const code of Array.from(codes)) {
        const source = code.textContent ?? '';
        const hash = hashSource(source);
        const pre = code.closest('pre');
        const anchor = pre ?? code;
        const existing = anchor.previousElementSibling;
        if (
          existing?.classList.contains(MERMAID_PREVIEW_CLASS) &&
          existing.getAttribute(MERMAID_HASH_ATTR) === hash
        ) {
          continue;
        }
        try {
          const { svg } = await mermaid.render(`tempo-mmd-${hash}`, source);
          if (cancelled) return;
          const wrap = window.document.createElement('div');
          wrap.className = MERMAID_PREVIEW_CLASS;
          wrap.setAttribute(MERMAID_HASH_ATTR, hash);
          wrap.setAttribute('contenteditable', 'false');
          // Mermaid's `securityLevel: 'strict'` is best-effort; defense in
          // depth via DOMPurify protects against any past or future renderer
          // bypass that lets script-bearing SVG through.
          wrap.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          });
          if (existing?.classList.contains(MERMAID_PREVIEW_CLASS)) existing.remove();
          anchor.parentElement?.insertBefore(wrap, anchor);
        } catch {
          // Silent — diagram errors leave the source visible.
        }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [document]);

  const orphanThread = orphanOpen ? bridge.getThreads().get(orphanOpen.threadId) : null;

  return (
    <div ref={rootRef} className="plan-editor-dense">
      <BlockNoteView
        editor={editor}
        comments={false}
        onChange={() => {
          if (readOnly) return;
          onUserEdit?.();
        }}
      >
        <FloatingComposerController floatingComposer={PlanCommentComposer} />
        <FloatingThreadController
          floatingThread={PlanCommentCard}
          floatingUIOptions={FLOATING_THREAD_UI}
        />
        {orphanOpen && orphanThread ? (
          <OrphanCardPopover
            anchorTop={orphanOpen.top}
            anchorRight={orphanOpen.right}
            onDismiss={() => setOrphanOpen(null)}
          >
            <PlanCommentCard thread={orphanThread} selected={true} orphaned={true} />
          </OrphanCardPopover>
        ) : null}
      </BlockNoteView>
    </div>
  );
}

// Positions PlanCommentCard beside the gutter icon, flipping above when the
// viewport below the anchor is too short.
function OrphanCardPopover({
  anchorTop,
  anchorRight,
  onDismiss,
  children,
}: {
  anchorTop: number;
  anchorRight: number;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchorTop);
  const [right, setRight] = useState(0);

  const recompute = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setTop(resolveVerticalCardTop(anchorTop, el.getBoundingClientRect().height));
    setRight(window.innerWidth - anchorRight + COMMENT_CARD_VIEWPORT.gap);
  }, [anchorTop, anchorRight]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, { passive: true });

    const el = ref.current;
    let observer: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(recompute);
      observer.observe(el);
    }

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute);
      observer?.disconnect();
    };
  }, [onDismiss, recompute]);

  return (
    <div ref={ref} style={{ position: 'fixed', top, right, zIndex: 30 }}>
      {children}
    </div>
  );
}

// Context window: ±80 chars around the selection. Large enough for fuzzy
// re-anchoring on a future edit, small enough to keep Comment rows compact.
const CONTEXT_RADIUS = 80;

function readAnchor(editor: ReturnType<typeof useCreateBlockNote> | null): {
  quote: string;
  context: string;
} {
  if (!editor) return { quote: '', context: '' };
  const state = editor._tiptapEditor.state;
  const { from, to } = state.selection;
  if (from === to) return { quote: '', context: '' };
  const quote = state.doc.textBetween(from, to, ' ');
  const ctxFrom = Math.max(0, from - CONTEXT_RADIUS);
  const ctxTo = Math.min(state.doc.content.size, to + CONTEXT_RADIUS);
  const context = state.doc.textBetween(ctxFrom, ctxTo, ' ');
  return { quote, context };
}
