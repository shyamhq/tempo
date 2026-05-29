'use client';

import type { Comment } from '@tempo/contracts';
import type { Editor } from '@tiptap/core';
import { PlanEditorSurface } from './plan-editor-surface';
import { usePlanEditor } from './use-plan-editor';

const DEFAULT_EDITOR_CLASS = [
  'prose prose-sm max-w-none min-h-[60vh] focus:outline-none text-ink font-sans',
  'prose-headings:font-semibold prose-headings:text-ink prose-headings:tracking-tight',
  'prose-h1:text-[1.25rem] prose-h1:mb-2 prose-h1:mt-5 first:prose-h1:mt-0',
  'prose-h2:text-[1.0625rem] prose-h2:mb-1.5 prose-h2:mt-4',
  'prose-h3:text-[0.9375rem] prose-h3:mb-1 prose-h3:mt-3',
  'prose-p:text-[14px] prose-p:leading-[1.55] prose-p:my-1.5',
  'prose-li:text-[14px] prose-li:leading-[1.55] prose-li:my-0',
  'prose-ul:my-1.5 prose-ol:my-1.5',
  'prose-strong:text-ink prose-strong:font-semibold',
  'prose-code:before:content-none prose-code:after:content-none',
].join(' ');

// Plan editor. Markdown is the source of truth (D4) — the editor parses it
// on mount and on every external refetch, and serializes back to markdown
// on debounced save.
export function PlanEditor({
  markdown,
  comments,
  showResolved = false,
  focusedCommentId = null,
  onSave,
  onFocusComment,
  onEditorReady,
  readOnly = false,
}: {
  markdown: string;
  comments: Comment[];
  showResolved?: boolean;
  focusedCommentId?: string | null;
  onSave: (markdown: string) => void;
  onFocusComment?: (commentId: string | null) => void;
  onEditorReady?: (editor: Editor | null) => void;
  readOnly?: boolean;
}) {
  const { editor, startComment, composerOpen } = usePlanEditor({
    markdown,
    comments,
    showResolved,
    focusedCommentId,
    onSave,
    onFocusComment,
    onEditorReady,
    readOnly,
    editorClassName: DEFAULT_EDITOR_CLASS,
  });

  return (
    <PlanEditorSurface editor={editor} startComment={startComment} composerOpen={composerOpen} />
  );
}
