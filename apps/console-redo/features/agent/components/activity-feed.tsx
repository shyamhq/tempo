'use client';

// The agent-activity timeline (kit `.act-feed` of `.ev` rows, workbench
// index.html lines 273-289, 681-684). Renders useAgentMessages(threadId) as a
// vertical rail: every meaningful UIMessage part becomes one row with a left
// icon dot + connecting line and a content `.main`.
//
// Part discrimination mirrors apps/console's agent-message-parts.tsx /
// agent-trails.tsx (the proven, post-UIMessage shape), reshaped into the kit's
// `.ev` markup + tokens — the "use the library" rule is satisfied by the AI SDK
// UIMessage/readUIMessageStream (the gateway, T2.2); rendering is presentational.

import type { TempoUIMessage } from '@tempo/contracts/agent-message';
import {
  Brain,
  type LucideIcon,
  MessageSquare,
  PencilLine,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { partRowKind, partToolName, type RowKind, toolFileHint, toolLabel } from '../activity';

// One flat row to render — the timeline is every meaningful UIMessage part,
// flattened across messages. Keyed by a stable `${messageId}:${partIndex}`.
type Row = {
  key: string;
  kind: RowKind;
  icon: LucideIcon;
  // The mono call line (tool label / kind label).
  call: string;
  // Optional terracotta delta chip (a short result/file hint).
  delta?: string;
  // The prose body (text/reasoning content, or a tool error as context).
  desc?: string;
};

// Raw tool names that read as a search/find (search glyph). Keyed off raw names,
// not the English label, so renaming a label can't break the icon.
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'web_search', 'search_files']);
// Non-plan write/edit tools get the pencil too (plan-edit tools never reach here
// — they're the 'edit' kind, routed to the pencil before toolIcon is called).
const WRITE_TOOLS = new Set(['Write', 'Edit', 'write_file', 'edit_file']);

// The icon for a tool row, by raw tool name. Pick search/write/terminal/wrench.
function toolIcon(toolName: string): LucideIcon {
  if (SEARCH_TOOLS.has(toolName)) return Search;
  if (WRITE_TOOLS.has(toolName)) return PencilLine;
  if (toolName === 'Bash') return Terminal;
  return Wrench;
}

// `partRowKind` returns null for the part kinds we deliberately don't show
// (`step-start`, `source-url`, `source-document`, `file`, `data-*`) — see the
// note on partRowKind in ../activity. Such parts produce no row here.
function partToRow(part: TempoUIMessage['parts'][number], key: string): Row | null {
  const kind = partRowKind(part);
  if (!kind) return null;

  if (kind === 'text') {
    const text = (part as { text: string }).text.trim();
    if (!text) return null;
    return { key, kind, icon: MessageSquare, call: 'Response', desc: text };
  }
  if (kind === 'think') {
    const text = (part as { text: string }).text.trim();
    if (!text) return null;
    return { key, kind, icon: Brain, call: 'Thinking', desc: text };
  }
  // tool / edit
  const toolName = partToolName(part);
  if (!toolName) return null;
  const file = toolFileHint(part);
  // A denied tool call (approval declined) carries no output/errorText — surface
  // it as 'Denied' so it doesn't render as a blank/stale row. An errored call
  // shows its errorText.
  const state = 'state' in part ? (part as { state?: string }).state : undefined;
  const errorText = 'errorText' in part ? (part as { errorText?: string }).errorText : undefined;
  const desc = state === 'output-denied' ? 'Denied' : errorText;
  return {
    key,
    kind,
    icon: kind === 'edit' ? PencilLine : toolIcon(toolName),
    call: toolLabel(toolName),
    delta: file || undefined,
    desc,
  };
}

// Flatten the messages into rows (every meaningful part, oldest-first).
function buildRows(messages: TempoUIMessage[]): Row[] {
  const rows: Row[] = [];
  for (const message of messages) {
    message.parts.forEach((part, i) => {
      const row = partToRow(part, `${message.id}:${i}`);
      if (row) rows.push(row);
    });
  }
  return rows;
}

export function ActivityFeed({ messages }: { messages: TempoUIMessage[] }) {
  // Flattening every message's parts on every render re-runs per streaming tick;
  // memoize on the (already-memoized) messages array so it only recomputes when
  // the timeline actually changes.
  const rows = useMemo(() => buildRows(messages), [messages]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-[12.5px] text-ink-3">
        No agent activity yet
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pt-2 pb-4">
      {rows.map((row) => (
        <EventRow key={row.key} row={row} />
      ))}
    </div>
  );
}

// One `.ev` row: a 23px rounded icon dot on a connecting rail, then the content.
// The connector line below the dot is hidden on the last row via the last-child
// rule (kit `.ev:last-child .line { display:none }`) — no per-row `last` prop, so
// appending a row doesn't re-render the previous last row.
function EventRow({ row }: { row: Row }) {
  const Icon = row.icon;
  return (
    <div className="flex gap-[11px] px-4 py-[7px] [&:last-child_.ev-line]:hidden">
      <div className="flex shrink-0 flex-col items-center">
        <span
          className={cn(
            'flex size-[23px] items-center justify-center rounded-[6px] border [&_svg]:size-3',
            row.kind === 'edit'
              ? 'border-transparent bg-[var(--tp-accent-soft)] text-primary'
              : 'border-border bg-inset text-ink-2',
          )}
        >
          <Icon className="size-3" aria-hidden />
        </span>
        <span className="ev-line mt-[3px] min-h-[6px] w-[2px] flex-1 bg-border" />
      </div>

      <div className="min-w-0 flex-1 pb-[3px]">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[12px] text-ink">{row.call}</span>
          {row.delta ? (
            <span className="shrink-0 rounded-[4px] bg-inset px-[5px] py-px font-mono text-[10px] text-ink-2">
              {row.delta}
            </span>
          ) : null}
        </div>
        {row.desc ? (
          <div className="mt-[3px] whitespace-pre-wrap break-words text-[12px] leading-[1.5] text-ink-2">
            {row.desc}
          </div>
        ) : null}
      </div>
    </div>
  );
}
