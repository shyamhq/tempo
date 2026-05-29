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
  onSave: (markdown: string) => void;
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
  onSave,
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(markdown);
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
    onUpdate: ({ editor: ed }) => {
      if (reapplyingMarks.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const md = (
          ed.storage as unknown as { markdown: { getMarkdown(): string } }
        ).markdown.getMarkdown();
        if (md === lastSaved.current) return;
        lastSaved.current = md;
        onSave(md);
      }, 800);
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor) return;
    if (markdown === lastSaved.current) return;
    lastSaved.current = markdown;
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
    editor
      .chain()
      .setTextSelection({ from, to })
      .setPendingCommentMark()
      .setTextSelection(to)
      .run();
    begin(quote, context, { from, to });
  }, [editor, begin]);

  useEffect(() => {
    if (!editor || !composerRange || composerOpen) return;
    const { from, to } = composerRange;
    if (from >= to) return;
    const chain = editor.chain().setTextSelection({ from, to });
    if (lastCreatedCommentId) {
      chain.setCommentMark(lastCreatedCommentId).setTextSelection(to).run();
      setLastCreated(null);
    } else {
      chain.unsetCommentMark().setTextSelection(to).run();
    }
    useComposerStore.setState({ range: null });
  }, [editor, composerOpen, lastCreatedCommentId, composerRange, setLastCreated]);

  return { editor, startComment, composerOpen };
}
