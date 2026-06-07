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
import { useQueryClient } from '@tanstack/react-query';
import type { Comment } from '@tempo/contracts';
import DOMPurify from 'isomorphic-dompurify';
import { useEffect, useMemo, useRef } from 'react';
import { planSchema } from '@/lib/plan-schema';
import { CommentThreadBridge } from './comment-thread-bridge';
import { PlanCommentCard } from './plan-comment-card';
import { PlanCommentComposer } from './plan-comment-composer';

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
    });
  }, [editor, onReady]);

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
        <FloatingThreadController floatingThread={PlanCommentCard} />
      </BlockNoteView>
    </div>
  );
}

// Context window: ±80 chars around the selection. Large enough for fuzzy
// re-anchoring on a future edit, small enough to keep Comment rows compact.
const CONTEXT_RADIUS = 80;

function readAnchor(
  editor: ReturnType<typeof useCreateBlockNote> | null,
): { quote: string; context: string } {
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
