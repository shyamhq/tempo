import { Mark, mergeAttributes } from '@tiptap/core';

// CommentMark — a ProseMirror Mark that anchors a Comment to a span of
// Plan text. Has two states:
//   - pending: true  → the Dev has opened the composer; mark renders amber,
//     carries no commentId yet. data-pending="true" lets the anchor-positions
//     hook find it for the composer card's y.
//   - pending: false → saved comment; mark renders accent-yellow, carries
//     data-comment-id, click is consumed by editor.handleClick → focus.
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => (attrs.commentId ? { 'data-comment-id': attrs.commentId } : {}),
      },
      pending: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-pending') === 'true',
        renderHTML: (attrs) => (attrs.pending ? { 'data-pending': 'true' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const pending = HTMLAttributes['data-pending'] === 'true';
    const className = pending
      ? 'bg-amber-500/25 border-b border-amber-500 rounded-sm'
      : 'bg-accent/15 border-b border-accent/50 cursor-pointer rounded-sm';
    return ['span', mergeAttributes(HTMLAttributes, { class: className }), 0];
  },

  addCommands() {
    return {
      setCommentMark:
        (commentId: string) =>
        ({ commands }: { commands: { setMark: (n: string, attrs: object) => boolean } }) =>
          commands.setMark(this.name, { commentId, pending: false }),
      setPendingCommentMark:
        () =>
        ({ commands }: { commands: { setMark: (n: string, attrs: object) => boolean } }) =>
          commands.setMark(this.name, { commentId: null, pending: true }),
      unsetCommentMark:
        () =>
        ({ commands }: { commands: { unsetMark: (n: string) => boolean } }) =>
          commands.unsetMark(this.name),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setCommentMark: (commentId: string) => ReturnType;
      setPendingCommentMark: () => ReturnType;
      unsetCommentMark: () => ReturnType;
    };
  }
}
