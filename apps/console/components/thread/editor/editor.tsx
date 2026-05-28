'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useCallback, useEffect, useRef } from 'react';
import { CommentMark } from './comment-mark';
import { useComposerStore } from '@/lib/stores/composer-store';

// Plan editor. Markdown is the source of truth (D4) — the editor parses it
// on mount and on every external refetch, and serializes back to markdown
// on debounced save.
export function PlanEditor({
  markdown,
  onSave,
  onJumpToComment,
  readOnly = false,
}: {
  markdown: string;
  onSave: (markdown: string) => void;
  onJumpToComment?: (commentId: string) => void;
  readOnly?: boolean;
}) {
  const begin = useComposerStore((s) => s.begin);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(markdown);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { class: 'bg-surface-2 rounded-md p-3 text-mono text-sm' } } }),
      Markdown.configure({ html: false, breaks: true, transformPastedText: true }),
      CommentMark,
    ],
    content: markdown,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class:
          'prose prose-invert max-w-none min-h-[60vh] focus:outline-none text-ink font-sans leading-relaxed',
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const id = target?.closest('[data-comment-id]')?.getAttribute('data-comment-id');
        if (id && onJumpToComment) {
          onJumpToComment(id);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const md = (
          editor.storage as unknown as { markdown: { getMarkdown(): string } }
        ).markdown.getMarkdown();
        if (md === lastSaved.current) return;
        lastSaved.current = md;
        onSave(md);
      }, 800);
    },
    immediatelyRender: false,
  });

  // External markdown changes (e.g. plan_edited_by_agent → refetch) — re-parse.
  useEffect(() => {
    if (!editor) return;
    if (markdown === lastSaved.current) return;
    lastSaved.current = markdown;
    editor.commands.setContent(markdown, { emitUpdate: false });
  }, [markdown, editor]);

  const startComment = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const quote = editor.state.doc.textBetween(from, to, '\n');
    if (!quote.trim()) return;
    const ctxFrom = Math.max(0, from - 60);
    const ctxTo = Math.min(editor.state.doc.content.size, to + 60);
    const context = editor.state.doc.textBetween(ctxFrom, ctxTo, '\n');
    begin(quote, context);
  }, [editor, begin]);

  return (
    <div>
      {!readOnly ? (
        <div className="sticky top-0 z-10 -mx-2 mb-2 flex items-center gap-2 bg-canvas/90 backdrop-blur px-2 py-1 border-b border-hairline">
          <button
            type="button"
            onClick={startComment}
            className="text-xs text-ink-subtle hover:text-ink h-6 px-2 rounded border border-hairline hover:border-hairline-strong"
          >
            Comment on selection
          </button>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
