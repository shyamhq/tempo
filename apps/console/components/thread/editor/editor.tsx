'use client';

import type { Comment } from '@tempo/contracts';
import type { Editor } from '@tiptap/core';
import { PlanEditorSurface } from './plan-editor-surface';
import { usePlanEditor } from './use-plan-editor';

const DEFAULT_EDITOR_CLASS = [
  'prose prose-sm max-w-none min-h-[60vh] focus:outline-none text-ink font-sans',
  'prose-headings:font-semibold prose-headings:text-ink prose-headings:tracking-tight',
  'prose-h1:text-heading-3 prose-h1:mb-2 prose-h1:mt-5 first:prose-h1:mt-0',
  'prose-h2:text-heading-4 prose-h2:mb-1.5 prose-h2:mt-4',
  'prose-h3:text-heading-5 prose-h3:mb-1 prose-h3:mt-3',
  'prose-p:text-[0.9375rem] prose-p:leading-[1.75] prose-p:my-2',
  'prose-li:text-[0.9375rem] prose-li:leading-[1.75] prose-li:my-0.5',
  'prose-ul:my-1.5 prose-ol:my-1.5',
  'prose-strong:text-ink prose-strong:font-semibold',
  'prose-code:before:content-none prose-code:after:content-none',
].join(' ');

export function PlanEditor({
  markdown,
  comments,
  showResolved = false,
  focusedCommentId = null,
  onUserEdit,
  onFocusComment,
  onEditorReady,
  readOnly = false,
}: {
  markdown: string;
  comments: Comment[];
  showResolved?: boolean;
  focusedCommentId?: string | null;
  onUserEdit?: () => void;
  onFocusComment?: (commentId: string | null) => void;
  onEditorReady?: (editor: Editor | null) => void;
  readOnly?: boolean;
}) {
  const { editor, startComment, composerOpen } = usePlanEditor({
    markdown,
    comments,
    showResolved,
    focusedCommentId,
    onUserEdit,
    onFocusComment,
    onEditorReady,
    readOnly,
    editorClassName: DEFAULT_EDITOR_CLASS,
  });

  return (
    <PlanEditorSurface editor={editor} startComment={startComment} composerOpen={composerOpen} />
  );
}
