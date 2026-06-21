'use client';

// ponytail: the connector backend (Pipedream OAuth, workspace_connectors table)
// exists in apps/console, but the UI is deferred here to match parity — the kit
// has no connector screen and the OAuth flow is out of scope. A coming-soon panel
// listing the planned providers is the laziest correct thing.

import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Frame,
  GitBranch,
  GitPullRequest,
  Globe,
  MessageSquare,
  Zap,
} from 'lucide-react';
import { SectionFrame } from '../section-frame';

const PLANNED: Array<{ label: string; icon: LucideIcon }> = [
  { label: 'GitHub', icon: GitPullRequest },
  { label: 'Linear', icon: GitBranch },
  { label: 'Sentry', icon: Zap },
  { label: 'Notion', icon: BookOpen },
  { label: 'Slack', icon: MessageSquare },
  { label: 'Vercel', icon: Globe },
  { label: 'Figma', icon: Frame },
];

export function ConnectorsSection() {
  return (
    <SectionFrame
      title="Connectors"
      description="Let the agent read context from the tools your team already uses. Coming soon."
    >
      <div className="overflow-hidden rounded-xl border border-border">
        {PLANNED.map(({ label, icon: Icon }) => (
          <div
            key={label}
            className="flex items-center gap-3 border-b border-border px-4 py-3 opacity-60 last:border-b-0"
          >
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-inset text-ink-3">
              <Icon className="size-4" strokeWidth={1.75} />
            </span>
            <span className="flex-1 text-sm font-medium text-ink-2">{label}</span>
            <span className="text-2xs uppercase tracking-label text-ink-3">Soon</span>
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}
