'use client';

// The thread route — a thin client page. The thread-view shell (top-bar +
// plan/discussion split) and the session wiring live in ThreadView; the page
// just resolves the route param and hands it down.

import { use } from 'react';
import { ThreadView } from '@/features/thread/components/thread-view';

export default function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = use(params);
  return <ThreadView threadId={threadId} />;
}
