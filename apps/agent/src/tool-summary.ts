// Render a one-line summary of a Claude tool-use input. Shared between
// `hook-relay.ts` (PTY-driver PreToolUse hook) and `stream-pump.ts`
// (stream-json driver's JSONL walker) so the two drivers produce identical
// `agent_tool_use` rows.

const SUMMARY_MAX = 200;

export function summarizeToolInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const i = input as Record<string, unknown>;
  // Per Claude Code's built-in tools: pick the field most useful to a human
  // glancing at "what is the Agent doing right now".
  const candidate =
    pick(i, 'file_path') ??
    pick(i, 'path') ??
    pick(i, 'command') ??
    pick(i, 'pattern') ??
    pick(i, 'query') ??
    pick(i, 'url') ??
    pick(i, 'description') ??
    '';
  return clip(candidate, SUMMARY_MAX);
}

export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function pick(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
