import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { CommentMark } from './comment-mark';
import { ConfluenceCodeBlock } from './confluence-code-block';

export function planEditorExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
    }),
    ConfluenceCodeBlock,
    // html:false is load-bearing — CommentMark spans must NOT serialize into
    // body_markdown. Marks are re-stamped from the comments list via findAnchor
    // on every load; the canonical markdown stays clean for the Agent.
    Markdown.configure({
      html: false,
      breaks: true,
      transformPastedText: true,
    }),
    CommentMark,
  ];
}
