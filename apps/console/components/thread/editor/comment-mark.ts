import { Mark, mergeAttributes } from '@tiptap/core';

// CommentMark — a ProseMirror Mark that anchors a Comment to a span of
// Plan text. The mark carries the Comment id; clicking it dispatches a
// CustomEvent on window so the Comments rail can scroll/focus.
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
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'bg-accent/15 border-b border-accent/50 cursor-pointer rounded-sm',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCommentMark:
        (commentId: string) =>
        ({ commands }: { commands: { setMark: (n: string, attrs: object) => boolean } }) =>
          commands.setMark(this.name, { commentId }),
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
      unsetCommentMark: () => ReturnType;
    };
  }
}
