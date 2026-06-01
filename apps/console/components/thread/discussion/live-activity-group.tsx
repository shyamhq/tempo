'use client';

import type { AgentTodo } from '@tempo/contracts';
import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { type LiveActivity, useLiveActivityGroup } from '@/hooks/use-thread-events';

// How many tool rows render before "+N earlier · expand" hides the rest.
const VISIBLE_TOOL_ROWS = 3;

export function LiveActivityGroup({ threadId }: { threadId: string }) {
  const activity = useLiveActivityGroup(threadId);
  const todos = activity.todos;
  const hasTools = activity.toolCalls.length > 0;
  if (!todos && !hasTools) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-tertiary">
          Agent activity
        </span>
        <span aria-hidden className="flex-1 h-px bg-hairline" />
      </div>
      <div className="rounded-lg border border-hairline bg-canvas px-3.5 py-3">
        {todos ? <TodoCard todos={todos} /> : null}
        {hasTools ? <ToolStack toolCalls={activity.toolCalls} hasTodos={todos !== null} /> : null}
      </div>
    </section>
  );
}

function TodoCard({ todos }: { todos: AgentTodo[] }) {
  const done = todos.filter((t) => t.status === 'completed').length;
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-tertiary mb-1.5">
        Todos · {done} of {todos.length}
      </div>
      <ul className="flex flex-col">
        {todos.map((todo, idx) => (
          // TodoWrite rewrites the whole list each call; positional key is the
          // natural identity since items have no SDK-provided ids.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <TodoRow key={idx} todo={todo} first={idx === 0} />
        ))}
      </ul>
    </div>
  );
}

function TodoRow({ todo, first }: { todo: AgentTodo; first: boolean }) {
  const textColor =
    todo.status === 'completed'
      ? 'text-ink-subtle'
      : todo.status === 'in_progress'
        ? 'text-ink'
        : 'text-ink-tertiary';
  const text = todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content;
  return (
    <li
      className={`flex items-start gap-2.5 py-1.5 text-[13px] leading-[1.5] ${
        first ? '' : 'border-t border-hairline/60'
      }`}
    >
      <TodoMark status={todo.status} />
      <span className={textColor}>{text}</span>
    </li>
  );
}

function TodoMark({ status }: { status: AgentTodo['status'] }) {
  if (status === 'completed') {
    return (
      <span
        aria-hidden
        className="mt-[3px] inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full bg-success text-white"
      >
        <Check className="h-[9px] w-[9px]" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'in_progress') {
    // Pulsing accent dot inside an accent ring — same visual vocabulary as the
    // Discussion panel's connected-status dot.
    return (
      <span
        aria-hidden
        className="relative mt-[3px] inline-block h-[13px] w-[13px] shrink-0 rounded-full border-[1.5px] border-accent bg-canvas"
      >
        <span className="absolute inset-[2px] rounded-full bg-accent animate-pulse" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="mt-[3px] inline-block h-[13px] w-[13px] shrink-0 rounded-full border-[1.5px] border-hairline-strong bg-canvas"
    />
  );
}

function ToolStack({
  toolCalls,
  hasTodos,
}: {
  toolCalls: LiveActivity['toolCalls'];
  hasTodos: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? toolCalls : toolCalls.slice(0, VISIBLE_TOOL_ROWS);
  const hiddenCount = toolCalls.length - visible.length;
  return (
    <div className={hasTodos ? 'mt-2.5 pt-2 border-t border-hairline' : ''}>
      <ul className="flex flex-col">
        {visible.map((tc, idx) => (
          <ToolRow key={tc.id} entry={tc} isFirst={idx === 0} dim={idx >= 2 && !expanded} />
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-[11.5px] text-ink-tertiary hover:text-ink-subtle"
        >
          + {hiddenCount} earlier · expand
        </button>
      ) : null}
    </div>
  );
}

function ToolRow({
  entry,
  isFirst,
  dim,
}: {
  entry: { tool: string; summary: string };
  isFirst: boolean;
  dim: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-2 py-[3px] font-mono text-[12px] text-ink-subtle ${
        dim ? 'opacity-50' : ''
      }`}
    >
      {isFirst ? (
        <Loader2 className="h-[10px] w-[10px] shrink-0 animate-spin text-ink-tertiary" />
      ) : (
        <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-ink-tertiary" />
      )}
      <span className="text-ink font-semibold shrink-0">{entry.tool}</span>
      {entry.summary ? <span className="truncate text-ink-subtle">{entry.summary}</span> : null}
    </li>
  );
}
