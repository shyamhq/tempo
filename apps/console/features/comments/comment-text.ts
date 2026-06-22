// The comment feature renders plain-text bodies: the T4.2 CommentThreadStore
// projects every Tempo Comment/Reply into a single paragraph whose one text
// node carries the message (comment-thread-store.ts textToCommentBody). This
// walker flattens that BlockNote CommentBody back to a string for the card —
// the inverse of textToCommentBody. Lives at the feature root (not under
// components/) so the store and the card components both import it as a sibling.

import type { CommentBody } from '@blocknote/core/comments';

type InlineLike = { text?: string };
type BlockLike = { content?: InlineLike[]; children?: BlockLike[] };

export function commentText(body: CommentBody | undefined): string {
  if (!body) return '';
  const out: string[] = [];
  const walk = (blocks: BlockLike[]) => {
    for (const block of blocks) {
      if (Array.isArray(block.content)) {
        for (const inline of block.content) {
          if (typeof inline.text === 'string') out.push(inline.text);
        }
      }
      if (Array.isArray(block.children) && block.children.length > 0) walk(block.children);
      out.push('\n');
    }
  };
  walk(body as BlockLike[]);
  return out.join('').trim();
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
