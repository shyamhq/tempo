'use client';

// Plan slice: the editor body (PM JSON) plus its meta. The plan_edited_by_*
// events carry only the timestamp — the canonical body is refetched (hydration,
// T2.3). Mirroring the old apply(): bump updated_at + updated_by_user_id together
// so the two meta fields can't disagree between the event write and the refetch.
// Agent edit → updated_by null; Dev edit → the editing Dev's user id.

import type { Plan, PlanBody } from '@tempo/contracts';
import type { PlanEditedByAgentEvent, PlanEditedByDevEvent } from '@tempo/contracts/events';
import type { z } from 'zod';
import type { StateCreator } from 'zustand';
import type { ThreadStore } from '../../store';

export interface PlanSlice {
  plan: Plan;

  setPlan: (plan: Plan) => void;
  applyPlanEdited: (
    e: z.infer<typeof PlanEditedByDevEvent> | z.infer<typeof PlanEditedByAgentEvent>,
    editedBy: string | null,
  ) => void;
}

export const createPlanSlice: StateCreator<ThreadStore, [], [], PlanSlice> = (set) => ({
  plan: { body: null },

  setPlan: (plan) => set({ plan }),

  applyPlanEdited: (e, editedBy) =>
    set((s) => {
      if (!s.plan.body) return {};
      const updatedBy = e.kind === 'plan_edited_by_agent' ? null : editedBy;
      const body: PlanBody = {
        ...s.plan.body,
        updated_at: e.updated_at,
        updated_by_user_id: updatedBy,
      };
      return { plan: { ...s.plan, body } };
    }),
});
