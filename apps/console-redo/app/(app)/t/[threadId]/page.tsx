'use client';

// The thread view. A client page: it opens the thread session (hydrate the
// slices + open the one event gateway) and renders the plan editor in the center
// reading column. The comments panel and the discussion / agent dock are later
// phases (T4.2 / T4.3 / Phase 5) — this page leaves the right dock to the (app)
// layout and renders only the plan for now.

import dynamic from 'next/dynamic';
import { use } from 'react';
import { useThreadSession } from '@/hooks/useThreadSession';

// BlockNote must mount client-only — it reaches for the DOM at module load.
const PlanEditor = dynamic(
  () => import('@/features/plan/components/plan-editor').then((m) => m.PlanEditor),
  { ssr: false },
);

export default function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = use(params);
  useThreadSession(threadId);

  return <PlanEditor threadId={threadId} />;
}
