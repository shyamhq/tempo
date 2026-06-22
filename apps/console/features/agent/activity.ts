// Pure derivations over the AI SDK UIMessage timeline — the one place that turns
// raw parts into the status-strip chip text, the drawer's stats, and the feed's
// row icons/accents. Shared by the StatusStrip, the ActivityDrawer, and the
// ActivityFeed (three real callers, no UI inside), so it earns a module.
//
// The tool-label registry + part discrimination mirror apps/console's
// agent-message-parts.tsx (the proven, post-UIMessage shape). All behavioral
// discrimination keys off raw tool names; toolLabel is for display text only.

import type { TempoUIMessage } from '@tempo/contracts/agent-message';
import { getToolName, isToolUIPart } from 'ai';

// Friendly labels for every tool name the runtimes emit (Claude Code built-ins,
// hosted Tavily web tools, the filesystem MCP server, tempo_* tools). Ported
// verbatim from apps/console so both consoles read identically.
const TOOL_LABELS: Record<string, string> = {
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
  web_search: 'Web search',
  web_fetch: 'Fetch page',
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

// Display label for a bare tool name (partToolName already strips the
// `mcp__<server>__` prefix), falling back to the bare name. Display only — never
// branch behavior on this.
export function toolLabel(bareName: string): string {
  return TOOL_LABELS[bareName] ?? bareName;
}

type Part = TempoUIMessage['parts'][number];

// The bare tool name of any tool part (static `tool-<name>` or `dynamic-tool`),
// or null for non-tool parts. isToolUIPart/getToolName handle both shapes (AI
// SDK 6 — verified against ai@6.0.208), so no part-type string surgery.
export function partToolName(part: Part): string | null {
  return isToolUIPart(part) ? bareToolName(getToolName(part)) : null;
}

// Claude Code names MCP tools `mcp__<server>__<tool>`; reduce to the bare name.
function bareToolName(name: string): string {
  return name.replace(/^mcp__.+?__/, '');
}

// Raw tool names that edit the plan → the row reads as a plan edit (accent dot).
// Keying off the raw names (not the English label) keeps behavior decoupled from
// UI copy: renaming a label can't silently break the accent.
const PLAN_EDIT_TOOLS = new Set([
  'tempo_update_plan',
  'tempo_add_blocks',
  'tempo_update_block',
  'tempo_delete_block',
]);

function isPlanEdit(toolName: string): boolean {
  return PLAN_EDIT_TOOLS.has(toolName);
}

// The row kind drives the icon + accent. Derived once here so the feed and the
// chip agree on what each part "is". The remaining UIMessage part kinds are
// dropped on purpose (returning null): `step-start` (structural), `source-url` /
// `source-document` (citations — the runtimes don't emit them), `file` (no file
// attachments in this flow), and `data-*` (no custom data parts). They render as
// nothing rather than a blank/unknown row.
export type RowKind = 'think' | 'tool' | 'edit' | 'text';

export function partRowKind(part: Part): RowKind | null {
  if (part.type === 'text') return 'text';
  if (part.type === 'reasoning') return 'think';
  const tool = partToolName(part);
  if (tool) return isPlanEdit(tool) ? 'edit' : 'tool';
  return null;
}

// Count of tool parts in a message (the chip badge + the drawer's "Tool calls").
export function countTools(message: TempoUIMessage): number {
  return message.parts.reduce((n, p) => (partToolName(p) ? n + 1 : n), 0);
}

// Count of plan-edit tool parts (the drawer's "Plan edits").
export function countEdits(message: TempoUIMessage): number {
  return message.parts.reduce((n, p) => {
    const tool = partToolName(p);
    return tool && isPlanEdit(tool) ? n + 1 : n;
  }, 0);
}

// The last meaningful part of a message (skipping step-start/source-url), or null.
function lastMeaningfulPart(message: TempoUIMessage): Part | null {
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i];
    if (!part || part.type === 'step-start' || part.type === 'source-url') continue;
    return part;
  }
  return null;
}

// A short file/path hint from a tool's input (the chip's `.ac-file`). Ported
// from apps/console's compactInput, returning '' when there's nothing to show.
export function toolFileHint(part: Part): string {
  if (!('input' in part)) return '';
  const input = (part as { input?: unknown }).input;
  if (typeof input === 'string') return input.slice(0, 40);
  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>;
    const pick = obj.command ?? obj.path ?? obj.file_path ?? obj.query ?? obj.text ?? obj.title;
    if (typeof pick === 'string') {
      const s = pick.startsWith('/') ? (pick.split('/').pop() ?? pick) : pick;
      return s.slice(0, 40);
    }
  }
  return '';
}

interface ActivitySummary {
  verb: string;
  file: string;
  badge: number;
  live: boolean;
}

// The status-strip chip's read of the latest activity. `latest` is the live
// message if a turn is streaming, else the most recent persisted message; `live`
// is the authoritative streaming flag (the gateway's agentLive slot). Verb is
// honest: the latest part's nature (Thinking / a tool label / a text snippet /
// Plan updated when the run finished with a plan-edit).
export function summarizeActivity(latest: TempoUIMessage, live: boolean): ActivitySummary {
  const part = lastMeaningfulPart(latest);
  const badge = countTools(latest);

  if (!part) {
    return { verb: live ? 'Thinking' : 'Working', file: '', badge, live };
  }
  if (part.type === 'reasoning') {
    return { verb: 'Thinking', file: '', badge, live };
  }
  if (part.type === 'text') {
    return { verb: live ? 'Responding' : 'Responded', file: '', badge, live };
  }
  const tool = partToolName(part);
  if (tool) {
    const label = toolLabel(tool);
    // A finished plan edit reads as "Plan updated" (matches the kit's verb);
    // otherwise the tool's own label.
    const verb = !live && isPlanEdit(tool) ? 'Plan updated' : label;
    return { verb, file: toolFileHint(part), badge, live };
  }
  return { verb: live ? 'Thinking' : 'Working', file: '', badge, live };
}
