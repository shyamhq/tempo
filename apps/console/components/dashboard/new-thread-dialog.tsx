'use client';

import { Check, Copy, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api-client';

export function NewThreadDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectCmd, setConnectCmd] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createThread({ title: title.trim(), description });
      setConnectCmd(`npx tempo-agent connect ${res.connect_token}`);
      setThreadId(res.thread.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create Thread.');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setTitle('');
    setDescription('');
    setConnectCmd(null);
    setThreadId(null);
    setError(null);
    setCopied(false);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      const id = threadId;
      reset();
      if (id) router.refresh();
    }
  };

  const copy = async () => {
    if (!connectCmd) return;
    await navigator.clipboard.writeText(connectCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="h-3.5 w-3.5" /> New Thread
        </Button>
      </DialogTrigger>
      <DialogContent>
        {connectCmd ? (
          <>
            <DialogTitle>Thread created</DialogTitle>
            <DialogDescription>
              Run this in your repo to connect the Agent. The token is shown once.
            </DialogDescription>
            <div className="mt-4 rounded-md border border-hairline bg-surface-2 p-3 font-mono text-xs text-ink break-all flex items-start gap-2">
              <span className="flex-1">{connectCmd}</span>
              <button
                type="button"
                onClick={copy}
                className="shrink-0 text-ink-subtle hover:text-ink"
                aria-label="Copy connect command"
              >
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {threadId ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    const id = threadId;
                    setOpen(false);
                    router.push(`/threads/${id}`);
                  }}
                >
                  Open Thread
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <DialogTitle>New Thread</DialogTitle>
            <DialogDescription>
              Describe what you want to plan. The Agent will explore and ask clarifications.
            </DialogDescription>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs text-ink-subtle">Title</span>
                <Input
                  autoFocus
                  className="mt-1"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Plan: refactor billing module"
                />
              </label>
              <label className="block">
                <span className="text-xs text-ink-subtle">Description</span>
                <Textarea
                  className="mt-1"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What should the Agent know? Goals, constraints, files to inspect."
                  rows={4}
                />
              </label>
              {error ? <p className="text-xs text-danger">{error}</p> : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={submitting || !title.trim()} onClick={submit}>
                {submitting ? 'Creating…' : 'Create Thread'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
