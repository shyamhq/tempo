'use client';

// The "Agent drafted this plan" banner (kit `.banner`, workbench index.html
// lines 124-128, 429): an accent-soft callout above the plan editor that frames
// the plan as an Agent draft to refine before executing, with a dismiss link.
//
// Presentational: reads the plan + agent messages + the persisted dismiss flag
// via store selectors and dismisses via a store action. Renders the kit `.banner`
// via the shared Banner primitive (accent tone == the kit's accent-soft wash).
//
// ponytail: there is no "agent-drafted" flag on the Plan contract (PlanBody
// carries only updated_at + updated_by_user_id, which is the *last* editor, not
// the drafter). The honest proxy is "a plan body exists AND the Agent has done
// activity on this thread" — i.e. the plan didn't appear without the Agent. If a
// real plan.source / first-author signal is ever added, gate on that instead.

import { Sparkles } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { useAgentMessages, useDraftedBannerDismissed, usePlan, useThreadStore } from '@/store';

export function DraftedBanner({ threadId }: { threadId: string }) {
  const plan = usePlan();
  const messages = useAgentMessages(threadId);
  const dismissed = useDraftedBannerDismissed(threadId);
  const dismiss = useThreadStore((s) => s.dismissDraftedBanner);

  const agentDrafted = plan.body !== null && messages.length > 0;
  if (!agentDrafted || dismissed) return null;

  // Align to the plan editor's reading column (same mx-auto/max-width/px as
  // plan-editor.tsx) so the banner sits flush above the doc rather than the
  // raw scroll-container edge.
  return (
    <div className="mx-auto w-full max-w-[calc(var(--tp-container-doc)+28px+8px+64px)] px-8 pt-6">
      <Banner
        tone="accent"
        icon={<Sparkles aria-hidden />}
        action={{ label: 'Dismiss', onClick: () => dismiss(threadId) }}
      >
        The Agent drafted this plan from your repo. Refine it together before you execute.
      </Banner>
    </div>
  );
}
