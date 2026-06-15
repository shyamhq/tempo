'use client';

import type { SessionStatus } from '@tempo/contracts';
import { Loader2, RefreshCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useWorkerApi } from '@/hooks/use-worker-api';

// Dev-initiated "go look at the Plan again" nudge. Auto-save no longer pings
// the Agent on every edit; the Dev clicks this when they're ready for a
// re-read. Disabled when no Agent session is currently connected — without
// a live session the event would just sit in the log, so clicking would
// promise an action the system can't deliver.
type Feedback = 'idle' | 'sent' | 'failed';

export function RecheckPlanButton({
  threadId,
  sessionStatus,
}: {
  threadId: string;
  sessionStatus: SessionStatus;
}) {
  const wApi = useWorkerApi();
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>('idle');

  const connected = sessionStatus === 'connected';
  const disabled = !connected || sending;

  const click = async () => {
    if (disabled) return;
    setSending(true);
    try {
      await wApi.recheckPlan(threadId);
      setFeedback('sent');
    } catch {
      setFeedback('failed');
    } finally {
      setSending(false);
      setTimeout(() => setFeedback('idle'), 1500);
    }
  };

  const label = feedback === 'sent' ? 'Sent' : feedback === 'failed' ? 'Failed' : 'Recheck plan';

  return (
    <Tooltip content={connected ? null : 'Connect an agent session first'}>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={click}>
        {sending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
        )}
        {label}
      </Button>
    </Tooltip>
  );
}
