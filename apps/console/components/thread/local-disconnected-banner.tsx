'use client';

import { ConnectButton } from '@/components/thread/connect-button';

// Banner above the discussion when the Thread is Local and the CLI is
// presently disconnected. Server-side wake routing is a no-op for Local
// Threads — the CLI long-polls for events itself when connected, and this
// banner tells the Dev to bring the CLI back up when it isn't.
// Owns the ConnectButton so its Dialog is mounted only when the banner is
// visible — the header has no separate Connect button.
export function LocalDisconnectedBanner({
  threadId,
  connectOpen,
  onConnectOpenChange,
}: {
  threadId: string;
  connectOpen: boolean;
  onConnectOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="mx-3 mt-3 flex items-center gap-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-caption text-ink-muted">
      <span className="flex h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden />
      <span className="flex-1">Local Agent isn't connected. Reconnect to keep planning.</span>
      <ConnectButton threadId={threadId} open={connectOpen} onOpenChange={onConnectOpenChange} />
    </div>
  );
}
