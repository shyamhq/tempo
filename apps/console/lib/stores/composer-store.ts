import { create } from 'zustand';

type ComposerState = {
  // The currently-pending Comment composer: the Dev has selected a range
  // and is typing the first message. Closed = no composer visible.
  open: boolean;
  plan_quote: string;
  plan_context: string;
  draft: string;
  // Tiptap doc positions captured when `begin` runs. The editor reads this
  // after a Comment is created (via `lastCreatedCommentId`) and wraps the
  // range with `CommentMark` so the highlight appears immediately.
  range: { from: number; to: number } | null;
  lastCreatedCommentId: string | null;
  begin: (quote: string, context: string, range: { from: number; to: number }) => void;
  setDraft: (draft: string) => void;
  cancel: () => void;
  setLastCreated: (id: string | null) => void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  open: false,
  plan_quote: '',
  plan_context: '',
  draft: '',
  range: null,
  lastCreatedCommentId: null,
  begin: (plan_quote, plan_context, range) =>
    set({ open: true, plan_quote, plan_context, draft: '', range, lastCreatedCommentId: null }),
  setDraft: (draft) => set({ draft }),
  // `cancel` closes the composer but leaves `range` + `lastCreatedCommentId`
  // alone; the editor effect clears them once the mark is applied (or `begin`
  // overwrites them when the Dev starts a new Comment).
  cancel: () => set({ open: false, plan_quote: '', plan_context: '', draft: '' }),
  setLastCreated: (id) => set({ lastCreatedCommentId: id }),
}));
