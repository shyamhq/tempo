'use client';

import type { AgentTodo } from '@tempo/contracts';
import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { ToolCallEntry } from '@/hooks/use-thread-events';

export function ActivityCard({
  todos,
  toolCalls,
}: {
  todos: AgentTodo[] | null;
  toolCalls: ToolCallEntry[];
}) {
  const hasTools = toolCalls.length > 0;
  if (!todos && !hasTools) return null;
  return (
    <div className="rounded-lg border border-hairline bg-canvas px-3.5 py-3 shadow-[0_8px_22px_rgba(10,10,10,0.10)]">
      {todos ? <TodoCard todos={todos} /> : null}
      {hasTools ? <ToolStack toolCalls={toolCalls} hasTodos={todos !== null} /> : null}
    </div>
  );
}

function TodoCard({ todos }: { todos: AgentTodo[] }) {
  const completed = todos.filter((t) => t.status === 'completed');
  const active = todos.filter((t) => t.status !== 'completed');
  // Default-collapse the completed rows when there are many, so a long run
  // (e.g. an 18-todo task) doesn't take over the popover.
  const collapsible = completed.length > 6;
  const [showCompleted, setShowCompleted] = useState(false);
  const visible = collapsible && !showCompleted ? active : [...completed, ...active];

  return (
    <div>
      <div className="text-micro font-semibold uppercase tracking-uppercase text-ink-tertiary mb-1.5">
        Todos · {completed.length} of {todos.length}
      </div>
      <ul className="flex flex-col max-h-[260px] overflow-y-auto">
        {collapsible && !showCompleted ? (
          <li className="py-1.5">
            <button
              type="button"
              onClick={() => setShowCompleted(true)}
              className="text-micro font-normal text-ink-tertiary hover:text-ink-subtle"
            >
              ▸ {completed.length} completed · expand
            </button>
          </li>
        ) : null}
        {visible.map((todo, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: AgentTodo has no SDK id; content + index is the natural identity
          <TodoRow key={`${idx}-${todo.content}`} todo={todo} first={idx === 0 && !collapsible} />
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
      className={`flex items-start gap-2.5 py-1.5 text-caption ${
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
        className="mt-[3px] inline-flex size-icon-xs shrink-0 items-center justify-center rounded-full bg-success text-on-primary"
      >
        <Check className="h-[9px] w-[9px]" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'in_progress') {
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

function ToolStack({ toolCalls, hasTodos }: { toolCalls: ToolCallEntry[]; hasTodos: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? toolCalls : toolCalls.slice(0, 3);
  const hiddenCount = toolCalls.length - visible.length;
  return (
    <div className={hasTodos ? 'mt-2.5 pt-2 border-t border-hairline' : ''}>
      <ul className="flex flex-col">
        {visible.map((tc, idx) => (
          <ToolRow key={tc.id} entry={tc} dim={idx >= 2 && !expanded} spinner={idx === 0} />
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-micro font-normal text-ink-tertiary hover:text-ink-subtle"
        >
          + {hiddenCount} earlier · expand
        </button>
      ) : null}
    </div>
  );
}

function ToolRow({
  entry,
  dim,
  spinner,
}: {
  entry: ToolCallEntry;
  dim: boolean;
  spinner: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-2 py-[3px] font-mono text-micro font-normal text-ink-subtle ${
        dim ? 'opacity-50' : ''
      }`}
    >
      {spinner ? (
        <Loader2 className="h-[10px] w-[10px] shrink-0 animate-spin text-ink-tertiary" />
      ) : (
        <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-ink-tertiary" />
      )}
      <span className="text-ink font-semibold shrink-0">{entry.tool}</span>
      {entry.summary ? <span className="truncate text-ink-subtle">{entry.summary}</span> : null}
    </li>
  );
}
