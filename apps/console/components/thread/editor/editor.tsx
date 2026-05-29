'use client';

import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { MessageSquarePlus } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { Markdown } from 'tiptap-markdown';
import { useComposerStore } from '@/lib/stores/composer-store';
import { CommentMark } from './comment-mark';

// Plan editor. Markdown is the source of truth (D4) — the editor parses it
// on mount and on every external refetch, and serializes back to markdown
// on debounced save.
export function PlanEditor({
  markdown,
  onSave,
  onFocusComment,
  onEditorReady,
  readOnly = false,
}: {
  markdown: string;
  onSave: (markdown: string) => void;
  onFocusComment?: (commentId: string | null) => void;
  onEditorReady?: (editor: Editor | null) => void;
  readOnly?: boolean;
}) {
  const begin = useComposerStore((s) => s.begin);
  const composerOpen = useComposerStore((s) => s.open);
  const lastCreatedCommentId = useComposerStore((s) => s.lastCreatedCommentId);
  const composerRange = useComposerStore((s) => s.range);
  const setLastCreated = useComposerStore((s) => s.setLastCreated);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(markdown);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'bg-surface-2 rounded-md p-3 text-mono text-sm' } },
      }),
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
        if (id && onFocusComment) {
          onFocusComment(id);
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

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

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
    editor
      .chain()
      .setTextSelection({ from, to })
      .setPendingCommentMark()
      .setTextSelection(to)
      .run();
    begin(quote, context, { from, to });
  }, [editor, begin]);

  // Resolve the pending mark once the composer closes — promote to a saved
  // mark if a Comment was created, strip otherwise.
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

  return (
    <div>
      {editor ? (
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor, from, to }) => {
            if (!editor.isEditable) return false;
            if (from === to) return false;
            if (composerOpen) return false;
            const text = editor.state.doc.textBetween(from, to, '\n');
            return text.trim().length > 0;
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => {
              // Prevent the selection from collapsing before startComment reads it.
              e.preventDefault();
            }}
            onClick={startComment}
            className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface-1 px-2 py-1 text-xs text-ink-subtle shadow-md hover:text-ink hover:border-hairline-strong"
            aria-label="Comment on selection"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Comment
          </button>
        </BubbleMenu>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
