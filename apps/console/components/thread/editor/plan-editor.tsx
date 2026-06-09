'use client';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import type { User } from '@blocknote/core/comments';
import { CommentsExtension } from '@blocknote/core/comments';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import {
  blockTypeSelectItems,
  FloatingComposerController,
  FloatingThreadController,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { flip, offset, shift } from '@floating-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import type { Comment } from '@tempo/contracts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { alertBlockTypeItems, alertSlashItems } from '@/lib/blocks/alert-block';
import { planSchemaClient } from '@/lib/plan-schema-client';
import { COMMENT_CARD_VIEWPORT, resolveVerticalCardTop } from './comment-card-placement';
import { CommentThreadBridge } from './comment-thread-bridge';
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
      schema: planSchemaClient,
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

  const orphanThread = orphanOpen ? bridge.getThreads().get(orphanOpen.threadId) : null;

  return (
    <div ref={rootRef} className="plan-editor-dense">
      <BlockNoteView
        editor={editor}
        comments={false}
        formattingToolbar={false}
        slashMenu={false}
        theme="light"
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
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar
              blockTypeSelectItems={[
                ...blockTypeSelectItems(editor.dictionary),
                ...alertBlockTypeItems,
              ]}
            />
          )}
        />
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [...getDefaultReactSlashMenuItems(editor), ...alertSlashItems(editor)],
              query,
            )
          }
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
  blockId: string | null;
} {
  if (!editor) return { quote: '', context: '', blockId: null };
  const state = editor._tiptapEditor.state;
  const { from, to } = state.selection;
  if (from === to) return { quote: '', context: '', blockId: null };
  const quote = state.doc.textBetween(from, to, ' ');
  const ctxFrom = Math.max(0, from - CONTEXT_RADIUS);
  const ctxTo = Math.min(state.doc.content.size, to + CONTEXT_RADIUS);
  const context = state.doc.textBetween(ctxFrom, ctxTo, ' ');
  // For multi-block selections, the *start* block wins — matches the dev's
  // mental model of "where I started highlighting" and matches how readers
  // scan top-down.
  const $from = state.selection.$from;
  let blockId: string | null = null;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'blockContainer') {
      const id = n.attrs.id;
      if (typeof id === 'string' && id.length > 0) blockId = id;
      break;
    }
  }
  return { quote, context, blockId };
}
