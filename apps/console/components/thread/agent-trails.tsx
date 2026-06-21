'use client';

import type { TempoUIMessage } from '@tempo/contracts/agent-message';
import type { DynamicToolUIPart, SourceUrlUIPart } from 'ai';
import { ChevronDown, ChevronUp, Maximize2, Minus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAgentMessages } from '@/hooks/use-agent-messages';
import { cn } from '@/lib/utils';
import { useAgentMessagesStore } from '@/store/agent-messages';
import { ReasoningPart, SourcesPart, TextPart, ToolPart, toolLabel } from './agent-message-parts';

type Mode = 'chip' | 'card' | 'drawer';
type Presence = 'connected' | 'idle';

const PRESENCE_DOT: Record<Presence, string> = {
  connected: 'bg-success animate-pulse',
  idle: 'bg-ink-tertiary',
};

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: 'Agent connected',
  idle: 'Agent idle',
};

export function AgentTrails({
  threadId,
  agentPresent,
  hasPlan,
}: {
  threadId: string;
  agentPresent: boolean;
  hasPlan: boolean;
}) {
  // Pre-Plan the conversation fills the page and its composer sits at the
  // bottom-right, so the chip yields to the top. Once a Plan exists the
  // discussion moves into the left rail and bottom-right is clear again.
  const anchor = hasPlan ? 'bottom-5' : 'top-16';
  const [mode, setMode] = useState<Mode>('chip');
  const messages = useAgentMessages(threadId);
  const liveMessage = useAgentMessagesStore((s) => s.live[threadId]);
  const presence: Presence = agentPresent ? 'connected' : 'idle';
  const chipText = chipStatusText(presence, liveMessage);

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== 'card') return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMode('chip');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('chip');
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [mode]);

  if (mode === 'drawer') {
    return (
      <div className="fixed top-3 right-3 bottom-3 w-[300px] z-30 flex flex-col rounded-md border border-hairline bg-canvas shadow-card-elevated overflow-hidden">
        <ActivityHeader
          presence={presence}
          right={
            <button
              type="button"
              onClick={() => setMode('chip')}
              aria-label="Minimize"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary hover:text-ink hover:bg-surface-2"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          }
        />
        <MessagesTimeline messages={messages} />
        <ActivityFooter count={messages.length} />
      </div>
    );
  }

  if (mode === 'card') {
    return (
      <div
        ref={containerRef}
        className={cn(
          'fixed right-5 w-[360px] max-h-[60vh] z-30 flex flex-col rounded-md border border-hairline bg-canvas shadow-card-elevated overflow-hidden',
          anchor,
        )}
      >
        <ActivityHeader
          presence={presence}
          right={
            <>
              <button
                type="button"
                onClick={() => setMode('drawer')}
                aria-label="Expand"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary hover:text-ink hover:bg-surface-2"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMode('chip')}
                aria-label="Close"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary hover:text-ink hover:bg-surface-2"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          }
        />
        <MessagesTimeline messages={messages.slice(-10)} />
        {messages.length > 10 ? (
          <button
            type="button"
            onClick={() => setMode('drawer')}
            className="border-t border-hairline-soft px-4 py-2 text-caption text-ink-subtle hover:bg-surface-2 hover:text-ink text-left"
          >
            Show all {messages.length} turns
          </button>
        ) : null}
        <ActivityFooter count={messages.length} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setMode('card')}
      aria-label="Open agent activity"
      className={cn(
        'fixed right-5 z-30 inline-flex items-center gap-2.5 rounded-md border border-hairline bg-canvas px-3 py-2 shadow-card-elevated hover:border-hairline-strong transition-colors text-left min-w-[230px]',
        anchor,
      )}
    >
      <span
        aria-hidden
        className={cn('h-[7px] w-[7px] shrink-0 rounded-full', PRESENCE_DOT[presence])}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-micro-uppercase uppercase font-semibold text-ink-tertiary leading-tight">
          Agent activity
        </span>
        <span className="block text-caption text-ink truncate">{chipText}</span>
      </span>
      {hasPlan ? (
        <ChevronUp className="h-3.5 w-3.5 text-ink-tertiary" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 text-ink-tertiary" />
      )}
    </button>
  );
}

function ActivityHeader({ presence, right }: { presence: Presence; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline-soft px-3 py-2.5">
      <div className="flex items-center gap-2 text-caption font-semibold text-ink">
        <span
          aria-hidden
          className={cn('h-[7px] w-[7px] shrink-0 rounded-full', PRESENCE_DOT[presence])}
        />
        {PRESENCE_LABEL[presence]}
      </div>
      <div className="flex items-center gap-0.5">{right}</div>
    </div>
  );
}

function ActivityFooter({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between border-t border-hairline-soft px-3 py-2 text-micro text-ink-tertiary">
      <span>
        {count} turn{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function MessagesTimeline({ messages }: { messages: TempoUIMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 px-4 py-8 text-center text-caption text-ink-tertiary">
        No agent activity yet.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative pl-7 pr-3 py-2">
        <span aria-hidden className="absolute left-3 top-2 bottom-2 w-px bg-hairline" />
        {messages.map((msg, idx) => (
          <MessageRow key={msg.id} message={msg} defaultOpen={idx === messages.length - 1} />
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message, defaultOpen }: { message: TempoUIMessage; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // A message is "live" (in-progress) if any part is still streaming.
  const isLive = message.parts.some(
    (p) => 'state' in p && (p as { state?: string }).state === 'streaming',
  );
  // Collect source-url parts for the Sources block at the bottom.
  const sources = message.parts.filter((p): p is SourceUrlUIPart => p.type === 'source-url');

  return (
    <div className="relative py-2">
      <span
        aria-hidden
        className={cn(
          'absolute -left-[18px] top-3 h-2.5 w-2.5 rounded-full bg-canvas ring-2',
          isLive ? 'animate-pulse ring-accent bg-accent' : 'ring-ink-tertiary',
        )}
      />
      <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full text-left">
        <div className="flex items-baseline gap-2">
          <span className="text-micro-uppercase uppercase font-semibold text-ink-tertiary">
            Turn
          </span>
          <span className="text-micro font-mono text-ink-tertiary">{message.id.slice(-8)}</span>
          <ChevronDown
            className={cn(
              'ml-auto h-3 w-3 text-ink-tertiary transition-transform',
              open ? 'rotate-180' : '',
            )}
          />
        </div>
        {!open ? <MessageSummary message={message} /> : null}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 border-t border-hairline-soft pt-2">
          <MessageParts message={message} sources={sources} />
        </div>
      ) : null}
    </div>
  );
}

function MessageSummary({ message }: { message: TempoUIMessage }) {
  const textPart = message.parts.find(
    (p): p is { type: 'text'; text: string } => p.type === 'text',
  );
  const toolCount = message.parts.filter(
    (p) => p.type === 'dynamic-tool' || p.type.startsWith('tool-'),
  ).length;
  if (textPart) {
    return (
      <div className="mt-0.5 text-caption text-ink truncate">{textPart.text.slice(0, 120)}</div>
    );
  }
  if (toolCount > 0) {
    return (
      <div className="mt-0.5 text-caption text-ink-subtle">
        {toolCount} tool call{toolCount === 1 ? '' : 's'}
      </div>
    );
  }
  return <div className="mt-0.5 text-caption text-ink-tertiary">No output</div>;
}

// Renders one UIMessage part. A named .map() callback so the key lives here, not
// inline. Parts are append-only (readUIMessageStream never reorders), so the
// array index is a stable key for text/reasoning; tools key by toolCallId.
function partRenderer(part: TempoUIMessage['parts'][number], position: number): React.ReactNode {
  if (part.type === 'step-start' || part.type === 'source-url') return null;
  // Text/reasoning parts have no id; position is stable (parts are append-only).
  // A content-derived key would change as streaming text grows → remount flicker.
  if (part.type === 'text') {
    return <TextPart key={`text-${position}`} part={part} />;
  }
  if (part.type === 'reasoning') {
    return <ReasoningPart key={`reasoning-${position}`} part={part} />;
  }
  if (part.type === 'dynamic-tool') {
    return <ToolPart key={`dynamic-tool-${part.toolCallId}`} part={part} />;
  }
  // Static tool parts (type: 'tool-<name>') — adapt to DynamicToolUIPart shape.
  if (part.type.startsWith('tool-')) {
    const staticPart = part as unknown as {
      type: string;
      toolCallId: string;
      state: DynamicToolUIPart['state'];
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };
    const adapted: DynamicToolUIPart = {
      type: 'dynamic-tool',
      toolName: part.type.slice(5), // strip 'tool-' prefix
      toolCallId: staticPart.toolCallId,
      state: staticPart.state,
      input: staticPart.input,
      output: staticPart.output,
      errorText: staticPart.errorText,
    } as DynamicToolUIPart;
    return <ToolPart key={`tool-${staticPart.toolCallId}`} part={adapted} />;
  }
  return null;
}

function MessageParts({
  message,
  sources,
}: {
  message: TempoUIMessage;
  sources: SourceUrlUIPart[];
}) {
  return (
    <>
      {message.parts.map(partRenderer)}
      {sources.length > 0 && <SourcesPart parts={sources} />}
    </>
  );
}

function chipStatusText(presence: Presence, live: TempoUIMessage | undefined): string {
  if (live) {
    // Show the most recent non-step-start part summary.
    for (let i = live.parts.length - 1; i >= 0; i--) {
      const part = live.parts[i];
      if (!part || part.type === 'step-start' || part.type === 'source-url') continue;
      if (part.type === 'text' && 'text' in part) {
        return (part as { text: string }).text.slice(0, 80);
      }
      if (part.type === 'reasoning' && 'text' in part) {
        return `Thinking: ${(part as { text: string }).text.slice(0, 60)}`;
      }
      if (part.type === 'dynamic-tool' && 'toolName' in part) {
        return toolLabel((part as { toolName: string }).toolName);
      }
      if (part.type.startsWith('tool-')) {
        return toolLabel(part.type.slice(5));
      }
    }
    return 'Thinking…';
  }
  return PRESENCE_LABEL[presence];
}
