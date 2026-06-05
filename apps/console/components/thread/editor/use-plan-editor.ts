'use client';

import type { Comment } from '@tempo/contracts';
import type { Editor } from '@tiptap/core';
import { useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef } from 'react';
import { useComposerStore } from '@/lib/stores/composer-store';
import { findAnchor } from './anchor-find';
import { planEditorExtensions } from './plan-editor-extensions';
export type PlanEditorCoreProps = {
  markdown: string;
  comments: Comment[];
  showResolved?: boolean;
  focusedCommentId?: string | null;
  onUserEdit?: () => void;
  onFocusComment?: (commentId: string | null) => void;
  onEditorReady?: (editor: Editor | null) => void;
  readOnly?: boolean;
  editorClassName: string;
};

export function usePlanEditor({
  markdown,
  comments,
  showResolved = false,
  focusedCommentId = null,
  onUserEdit,
  onFocusComment,
  onEditorReady,
  readOnly = false,
  editorClassName,
}: PlanEditorCoreProps) {
  const begin = useComposerStore((s) => s.begin);
  const composerOpen = useComposerStore((s) => s.open);
  const lastCreatedCommentId = useComposerStore((s) => s.lastCreatedCommentId);
  const composerRange = useComposerStore((s) => s.range);
  const setLastCreated = useComposerStore((s) => s.setLastCreated);
  const lastSeenMarkdown = useRef(markdown);
  const reapplyingMarks = useRef(false);

  const editor = useEditor({
    extensions: planEditorExtensions(),
    content: markdown,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: editorClassName,
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const id = target?.closest('[data-comment-id]')?.getAttribute('data-comment-id');
        if (id && onFocusComment) {
          onFocusComment(id);
          return true;
        }
        return false;
      },
    },
    // Tiptap fires `update` on no-op transactions when @tiptap/react reconciles
    // editor options (every parent re-render): docChanged is false, steps is
    // empty. Treat those as not-an-edit. The reapplyingMarks gate still covers
    // the genuine doc-changing mark mutations from the comment-mark effect.
    onUpdate: ({ transaction }) => {
      if (reapplyingMarks.current) return;
      if (!transaction.docChanged) return;
      onUserEdit?.();
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor) return;
    if (markdown === lastSeenMarkdown.current) return;
    lastSeenMarkdown.current = markdown;
    editor.commands.setContent(markdown, { emitUpdate: false });
  }, [markdown, editor]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: markdown is the trigger that the prior effect just ran setContent and wiped marks; we must re-stamp after the doc swap.
  useEffect(() => {
    if (!editor) return;
    if (composerOpen || lastCreatedCommentId) return;

    const existing = new Map<
      string,
      { from: number; to: number; focused: boolean; resolved: boolean }
    >();
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      const mark = node.marks.find((m) => m.type.name === 'comment');
      const id = mark?.attrs.commentId as string | null | undefined;
      if (!id) return false;
      const from = pos;
      const to = pos + node.nodeSize;
      const focused = mark?.attrs.focused === true;
      const resolved = mark?.attrs.resolved === true;
      const prev = existing.get(id);
      existing.set(
        id,
        prev
          ? {
              from: Math.min(prev.from, from),
              to: Math.max(prev.to, to),
              focused: prev.focused || focused,
              resolved: prev.resolved || resolved,
            }
          : { from, to, focused, resolved },
      );
      return false;
    });

    const markedComments = comments.filter((c) => c.resolved_by === null || showResolved);
    const wanted = new Set(markedComments.map((c) => c.id));
    const toUnset: { from: number; to: number }[] = [];
    for (const [id, range] of existing) {
      if (!wanted.has(id)) toUnset.push(range);
    }

    const toApply: {
      id: string;
      from: number;
      to: number;
      focused: boolean;
      resolved: boolean;
    }[] = [];
    for (const c of markedComments) {
      const resolved = c.resolved_by !== null;
      const focused = c.id === focusedCommentId;
      const ex = existing.get(c.id);
      if (ex) {
        if (ex.focused !== focused || ex.resolved !== resolved) {
          toApply.push({ id: c.id, from: ex.from, to: ex.to, focused, resolved });
        }
        continue;
      }
      const range = findAnchor(editor.state.doc, c.plan_quote, c.plan_context);
      if (range) toApply.push({ id: c.id, ...range, focused, resolved });
    }

    if (toUnset.length === 0 && toApply.length === 0) return;

    reapplyingMarks.current = true;
    try {
      let chain = editor.chain();
      for (const r of toUnset) {
        chain = chain.setTextSelection(r).unsetCommentMark();
      }
      for (const a of toApply) {
        chain = chain
          .setTextSelection({ from: a.from, to: a.to })
          .unsetCommentMark()
          .setCommentMark(a.id, { focused: a.focused, resolved: a.resolved });
      }
      chain.run();
    } finally {
      queueMicrotask(() => {
        reapplyingMarks.current = false;
      });
    }
  }, [
    editor,
    comments,
    showResolved,
    focusedCommentId,
    composerOpen,
    lastCreatedCommentId,
    markdown,
  ]);

  const startComment = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const quote = editor.state.doc.textBetween(from, to, '\n');
    if (!quote.trim()) return;
    const ctxFrom = Math.max(0, from - 60);
    const ctxTo = Math.min(editor.state.doc.content.size, to + 60);
    const context = editor.state.doc.textBetween(ctxFrom, ctxTo, '\n');
    reapplyingMarks.current = true;
    try {
      // Clear any pending mark left over from a prior compose before
      // applying the new one — otherwise a second compose stacks marks and
      // the editor shows phantom highlights from earlier selections.
      // Position invariant: `ranges` is collected against `state.doc` then
      // applied through `chain()` synchronously, with `reapplyingMarks=true`
      // blocking external dispatches via the `onUpdate` gate — so no
      // transaction can mutate positions between collection and `run()`.
      let chain = editor.chain();
      const markType = editor.schema.marks.comment;
      if (markType) {
        const ranges: { from: number; to: number }[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (!node.isText) return true;
          const pending = node.marks.find((m) => m.type === markType && m.attrs.pending === true);
          if (pending) ranges.push({ from: pos, to: pos + node.nodeSize });
          return false;
        });
        for (const r of ranges) chain = chain.setTextSelection(r).unsetCommentMark();
      }
      chain.setTextSelection({ from, to }).setPendingCommentMark().setTextSelection(to).run();
    } finally {
      queueMicrotask(() => {
        reapplyingMarks.current = false;
      });
    }
    begin(quote, context, { from, to });
  }, [editor, begin]);

  useEffect(() => {
    if (!editor || !composerRange || composerOpen) return;
    const { from, to } = composerRange;
    if (from >= to) return;
    reapplyingMarks.current = true;
    try {
      const chain = editor.chain().setTextSelection({ from, to });
      if (lastCreatedCommentId) {
        chain.setCommentMark(lastCreatedCommentId).setTextSelection(to).run();
        setLastCreated(null);
      } else {
        chain.unsetCommentMark().setTextSelection(to).run();
      }
    } finally {
      queueMicrotask(() => {
        reapplyingMarks.current = false;
      });
    }
    useComposerStore.setState({ range: null });
  }, [editor, composerOpen, lastCreatedCommentId, composerRange, setLastCreated]);

  return { editor, startComment, composerOpen };
}
