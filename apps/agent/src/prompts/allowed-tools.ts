// Tools the Agent is allowed to invoke. ScheduleWakeup is absent — Node owns
// the loop heartbeat. tempo_poll *is* allowed because the Agent calls it to
// fetch event payloads after Node nudges it. Edit/Write/MultiEdit are absent
// because the Plan is written via tempo_write_plan, never to disk.
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
];
