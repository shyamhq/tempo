'use client';

// Renderers for AI SDK v6 UIMessage.parts[], plus the canonical agent-tool
// labels (the one source of truth — agent-trails imports toolLabel from here).

import type { DynamicToolUIPart, ReasoningUIPart, SourceUrlUIPart, TextUIPart } from 'ai';
import { Brain, Check, ChevronDown, ExternalLink, Loader2, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

// Friendly, consistent labels for every tool name the three runtimes emit:
// Claude Code (CLI) tool names, the hosted Tavily web tools, the filesystem MCP
// server, and our tempo_* tools. Both naming styles for the web tools (CLI
// WebSearch vs hosted web_search) map to one label so the UI reads the same
// regardless of runtime.
const TOOL_LABELS: Record<string, string> = {
  // Claude Code built-ins
  Bash: 'Terminal',
  Read: 'Read file',
  Edit: 'Edit file',
  Write: 'Write file',
  Glob: 'Find files',
  Grep: 'Search code',
  WebSearch: 'Web search',
  WebFetch: 'Fetch page',
  Task: 'Subagent',
  Agent: 'Subagent',
  TodoWrite: 'Update todos',
  // Hosted Tavily web tools
  web_search: 'Web search',
  web_fetch: 'Fetch page',
  // Filesystem MCP server (hosted VM)
  read_file: 'Read file',
  read_text_file: 'Read file',
  read_multiple_files: 'Read files',
  write_file: 'Write file',
  edit_file: 'Edit file',
  create_directory: 'Create folder',
  list_directory: 'List files',
  directory_tree: 'List files',
  move_file: 'Move file',
  search_files: 'Find files',
  get_file_info: 'File info',
  // Tempo tools
  tempo_post_discussion_message: 'Post message',
  tempo_post_reply: 'Reply',
  tempo_pull_plan: 'Read plan',
  tempo_update_plan: 'Write plan',
  tempo_add_blocks: 'Edit plan',
  tempo_update_block: 'Edit plan',
  tempo_delete_block: 'Edit plan',
  tempo_github_list_repos: 'List repos',
  tempo_set_thread_meta: 'Set title',
  tempo_load_skill: 'Load skill',
  tempo_attach: 'Attach repo',
  tempo_poll_hosted: 'Poll',
};

// Claude Code names MCP tools `mcp__<server>__<tool>`; reduce to the bare tool
// name, then map to a friendly label (falling back to the bare name).
export function toolLabel(rawName: string): string {
  const bare = rawName.replace(/^mcp__.+?__/, '');
  return TOOL_LABELS[bare] ?? bare;
}

// ---------------------------------------------------------------------------
// Text part — streaming or done
// ---------------------------------------------------------------------------

export function TextPart({ part }: { part: TextUIPart }) {
  if (!part.text.trim()) return null;
  return (
    <p
      className={cn(
        'text-caption text-ink leading-relaxed',
        part.state === 'streaming' &&
          'after:content-["▋"] after:animate-pulse after:text-accent after:ml-0.5',
      )}
    >
      {part.text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Reasoning part — collapsible, dimmed while streaming
// ---------------------------------------------------------------------------

export function ReasoningPart({ part }: { part: ReasoningUIPart }) {
  const [open, setOpen] = useState(false);
  const streaming = part.state === 'streaming';
  return (
    <div className="rounded-md border border-hairline-soft bg-surface-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {streaming ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 text-ink-tertiary animate-spin" />
        ) : (
          <Brain className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" />
        )}
        <span className="flex-1 text-micro-uppercase uppercase font-semibold text-ink-tertiary tracking-wide">
          {streaming ? 'Thinking…' : 'Reasoning'}
        </span>
        <ChevronDown
          className={cn('h-3 w-3 text-ink-tertiary transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-hairline-soft">
          <p
            className={cn(
              'text-caption text-ink-subtle italic leading-relaxed whitespace-pre-wrap',
              streaming && 'after:content-["▋"] after:animate-pulse after:text-accent after:ml-0.5',
            )}
          >
            {part.text}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool part (dynamic-tool) — compact row with expandable I/O
// ---------------------------------------------------------------------------

type ToolPartProps = { part: DynamicToolUIPart };

export function ToolPart({ part }: ToolPartProps) {
  const [open, setOpen] = useState(false);
  const label = toolLabel(part.toolName);
  const state = part.state;

  return (
    <div className="rounded-md border border-hairline-soft overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
      >
        <ToolStateIcon state={state} />
        <span className="flex-1 min-w-0">
          <span className="text-caption font-semibold text-ink">{label}</span>
          {hasContent(part.input) ? (
            <span className="ml-2 text-micro text-ink-tertiary font-mono truncate">
              {compactInput(part.input)}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-ink-tertiary transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-hairline-soft space-y-2">
          {hasContent(part.input) && <JsonBlock label="Input" value={part.input} />}
          {state === 'output-available' && part.output !== undefined && (
            <JsonBlock label="Output" value={part.output} />
          )}
          {state === 'output-error' && part.errorText && (
            <div className="rounded-sm bg-danger-soft px-2.5 py-1.5 text-caption text-danger">
              {part.errorText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolStateIcon({ state }: { state: DynamicToolUIPart['state'] }) {
  switch (state) {
    case 'input-streaming':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 text-ink-tertiary animate-spin" />;
    case 'input-available':
    case 'approval-requested':
    case 'approval-responded':
      return <Wrench className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" />;
    case 'output-available':
      return <Check className="h-3.5 w-3.5 shrink-0 text-success" />;
    case 'output-error':
      return <X className="h-3.5 w-3.5 shrink-0 text-danger" />;
    default:
      return <Wrench className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" />;
  }
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <div className="mb-1 text-micro-uppercase uppercase font-semibold text-ink-tertiary tracking-wide">
        {label}
      </div>
      <pre className="overflow-x-auto rounded-sm bg-surface-3 px-2.5 py-1.5 text-code-sm text-ink-subtle whitespace-pre-wrap break-words max-h-48">
        {text}
      </pre>
    </div>
  );
}

// True when there's something worth showing — hides an empty `{}` input block.
function hasContent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  if (typeof v === 'string') return v.length > 0;
  return true;
}

function compactInput(input: unknown): string {
  if (typeof input === 'string') return input.slice(0, 60);
  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>;
    const pick = obj.command ?? obj.path ?? obj.file_path ?? obj.query ?? obj.text ?? obj.title;
    if (typeof pick === 'string') {
      const s = pick.startsWith('/') ? (pick.split('/').pop() ?? pick) : pick;
      return s.slice(0, 60);
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Source-url part — compact external link chip
// ---------------------------------------------------------------------------

export function SourcesPart({ parts }: { parts: SourceUrlUIPart[] }) {
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {parts.map((p) => (
        <a
          key={p.url}
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-hairline px-2.5 py-1 text-micro text-ink-subtle hover:text-ink hover:border-hairline-strong transition-colors"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[180px]">{p.title ?? hostname(p.url)}</span>
        </a>
      ))}
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}
