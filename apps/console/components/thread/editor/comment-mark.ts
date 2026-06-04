import { Mark, mergeAttributes } from '@tiptap/core';

export type CommentMarkAttrs = {
  focused?: boolean;
  resolved?: boolean;
};

function resolveClassName({
  pending,
  focused,
  resolved,
}: {
  pending: boolean;
  focused: boolean;
  resolved: boolean;
}): string {
  if (pending) return 'bg-highlight border-b-2 border-accent rounded-sm';
  if (focused && resolved)
    return 'bg-comment-resolved-focus border-b-2 border-accent cursor-pointer rounded-sm shadow-comment-focus';
  if (focused)
    return 'bg-comment-focus border-b-2 border-accent cursor-pointer rounded-sm shadow-comment-focus';
  if (resolved) return 'bg-comment-resolved border-b border-accent cursor-pointer rounded-sm';
  return 'bg-comment border-b-2 border-accent cursor-pointer rounded-sm';
}

// CommentMark — anchors Comment text in the Plan.
// Active comments are always highlighted; resolved ones only when "Show resolved" is on.
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
      focused: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-focused') === 'true',
        renderHTML: (attrs) => (attrs.focused && !attrs.pending ? { 'data-focused': 'true' } : {}),
      },
      resolved: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-resolved') === 'true',
        renderHTML: (attrs) =>
          attrs.resolved && !attrs.pending ? { 'data-resolved': 'true' } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const pending = HTMLAttributes['data-pending'] === 'true';
    const focused = HTMLAttributes['data-focused'] === 'true';
    const resolved = HTMLAttributes['data-resolved'] === 'true';

    const className = resolveClassName({ pending, focused, resolved });

    return ['span', mergeAttributes(HTMLAttributes, { class: className }), 0];
  },

  addCommands() {
    return {
      setCommentMark:
        (commentId: string, attrs: CommentMarkAttrs = {}) =>
        ({ commands }: { commands: { setMark: (n: string, a: object) => boolean } }) =>
          commands.setMark(this.name, {
            commentId,
            pending: false,
            focused: attrs.focused ?? false,
            resolved: attrs.resolved ?? false,
          }),
      setPendingCommentMark:
        () =>
        ({ commands }: { commands: { setMark: (n: string, a: object) => boolean } }) =>
          commands.setMark(this.name, {
            commentId: null,
            pending: true,
            focused: false,
            resolved: false,
          }),
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
      setCommentMark: (commentId: string, attrs?: CommentMarkAttrs) => ReturnType;
      setPendingCommentMark: () => ReturnType;
      unsetCommentMark: () => ReturnType;
    };
  }
}
