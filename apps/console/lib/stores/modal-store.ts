import { create } from 'zustand';

// UI-only state for the Clarification Round modal: whether the Dev has
// dismissed it (only allowed when the round is non-blocking, which today
// it isn't — included so the hook surface is stable if D13 ever softens).
type ModalState = {
  clarification_dismissed_round_id: string | null;
  dismiss: (round_id: string) => void;
  reset: () => void;
};

export const useModalStore = create<ModalState>((set) => ({
  clarification_dismissed_round_id: null,
  dismiss: (round_id) => set({ clarification_dismissed_round_id: round_id }),
  reset: () => set({ clarification_dismissed_round_id: null }),
}));
