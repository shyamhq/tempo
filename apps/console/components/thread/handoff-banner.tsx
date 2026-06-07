'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

// The Plan is the artifact; this banner is the bridge between the Console
// review surface and a fresh Claude Code session. We render via a Markdown
// projection rather than the BlockNote block tree because the destination is
// a Markdown-native prompt, not another BlockNote editor.
export function HandoffBanner({ getPlanMarkdown }: { getPlanMarkdown: () => Promise<string> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const markdown = await getPlanMarkdown();
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="rounded-md border border-success/40 bg-success/10 px-4 py-3 mb-4 flex items-center gap-3">
      <div className="flex-1">
        <p className="text-sm font-medium text-ink">Plan approved.</p>
        <p className="text-xs text-ink-subtle">
          Copy it into a fresh Claude Code session to execute.
        </p>
      </div>
      <Button variant="secondary" onClick={copy}>
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-success" /> Copied
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" /> Copy Plan
          </>
        )}
      </Button>
    </div>
  );
}
