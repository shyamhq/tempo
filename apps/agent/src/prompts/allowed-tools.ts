// ScheduleWakeup is absent — Node owns the loop heartbeat.
// Edit/Write/MultiEdit are absent — the Plan is written via the tempo_* MCP
// tools, never to disk.
// tempo_poll is present — Claude calls it once per nudge to fetch full event
// payloads (the nudge itself only carries kind counts).
export const ALLOWED_TOOLS = [
  'mcp__tempo__tempo_attach',
  'mcp__tempo__tempo_pull_plan',
  'mcp__tempo__tempo_update_plan',
  'mcp__tempo__tempo_update_block',
  'mcp__tempo__tempo_add_blocks',
  'mcp__tempo__tempo_delete_block',
  'mcp__tempo__tempo_poll',
  'mcp__tempo__tempo_post_reply',
  'mcp__tempo__tempo_post_discussion_message',
  'mcp__tempo__tempo_set_thread_meta',
  'Read',
  'Glob',
  'Grep',
  'Bash',
  'TodoWrite',
];
