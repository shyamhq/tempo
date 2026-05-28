import { create } from 'zustand';

type ComposerState = {
  // The currently-pending Comment composer: the Dev has selected a range
  // and is typing the first message. Closed = no composer visible.
  open: boolean;
  plan_quote: string;
  plan_context: string;
  draft: string;
  begin: (quote: string, context: string) => void;
  setDraft: (draft: string) => void;
  cancel: () => void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  open: false,
  plan_quote: '',
  plan_context: '',
  draft: '',
  begin: (plan_quote, plan_context) =>
    set({ open: true, plan_quote, plan_context, draft: '' }),
  setDraft: (draft) => set({ draft }),
  cancel: () => set({ open: false, plan_quote: '', plan_context: '', draft: '' }),
}));
