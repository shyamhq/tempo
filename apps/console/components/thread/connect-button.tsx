'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Loader2, Plug } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { api } from '@/lib/api-client';

export function ConnectButton({
  threadId,
  open: controlledOpen,
  onOpenChange,
}: {
  threadId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [copied, setCopied] = useState(false);

  // Only fetch when the dialog is open; cache indefinitely — the token is
  // invariant per Thread, so refetches never return new data.
  const { data, isPending, error } = useQuery({
    queryKey: ['thread-connect-token', threadId],
    queryFn: () => api.getConnectToken(threadId),
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  const cmd = data ? `npx tempo-agent connect ${data.connect_token}` : null;

  const copy = async () => {
    if (!cmd) return;
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plug className="h-3.5 w-3.5" /> Connect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Connect the Agent</DialogTitle>
        <DialogDescription>
          Run this in your repo to connect a local Claude Code Agent to this Thread.
        </DialogDescription>
        <div className="mt-4 rounded-md border border-hairline bg-surface-2 p-3 font-mono text-xs text-ink break-all flex items-start gap-2 min-h-[2.5rem]">
          {isPending ? (
            <span className="flex items-center gap-2 text-ink-subtle">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </span>
          ) : error ? (
            <span className="text-danger">Failed to load connect command.</span>
          ) : (
            <>
              <span className="flex-1">{cmd}</span>
              <button
                type="button"
                onClick={copy}
                className="shrink-0 text-ink-subtle hover:text-ink"
                aria-label="Copy connect command"
              >
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
