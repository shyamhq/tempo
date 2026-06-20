import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Reusable nullable timestamp (no default, no notNull) — used for optional
// lifecycle fields like revoked_at, last_used_at.
const nullableTimestamp = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// Timestamps are stored as `timestamp with time zone` and exposed to TS as
// Date objects (mode: 'date'). JSON.stringify calls .toISOString() on Date,
// producing proper ISO 8601 strings on the wire.
const timestampDate = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  clerk_org_id: text('clerk_org_id').notNull().unique(),
  agent_api_key: text('agent_api_key').notNull().unique(),
  created_at: timestampDate('created_at'),
});

export const spaces = pgTable('spaces', {
  id: text('id').primaryKey(),
  workspace_id: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  // Drag-reorder uses fractional indexing: drop between siblings writes the
  // midpoint of their sort_order values; no rebalance at this scale.
  sort_order: doublePrecision('sort_order').notNull().default(0),
  created_at: timestampDate('created_at'),
});

export const threads = pgTable('threads', {
  id: text('id').primaryKey(),
  workspace_id: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  space_id: text('space_id')
    .notNull()
    .references(() => spaces.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  connect_token: text('connect_token').notNull(),
  agent_type: text('agent_type', { enum: ['local', 'hosted'] }).notNull(),
  // GitHub repos attached to this thread in `owner/name` format. Non-empty
  // triggers VM provisioning; empty means in-process conversation turns.
  repos: text('repos').array().notNull().default(sql`'{}'::text[]`),
  sort_order: doublePrecision('sort_order').notNull().default(0),
  created_at: timestampDate('created_at'),
  updated_at: timestampDate('updated_at'),
});

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id')
    .notNull()
    .unique()
    .references(() => threads.id),
  // Plain text column holding stringified ProseMirror JSON. Callers do their
  // own JSON.parse / JSON.stringify so the storage layer doesn't double-encode.
  body_pm_json: text('body_pm_json'),
  // NULL = agent edit; non-null = Clerk user id of the Dev who last wrote.
  updated_by_user_id: text('updated_by_user_id'),
  // Nullable + no default: set only on first plan edit, not on row insert.
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  created_at: timestampDate('created_at'),
});

export const comments = pgTable('comments', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id')
    .notNull()
    .references(() => threads.id),
  plan_quote: text('plan_quote').notNull(),
  plan_context: text('plan_context').notNull(),
  anchor_block_id: text('anchor_block_id'),
  // NULL = agent-authored comment (rare); non-null = Clerk user id.
  author_user_id: text('author_user_id'),
  resolved_by_user_id: text('resolved_by_user_id'),
  created_at: timestampDate('created_at'),
});

export const replies = pgTable('replies', {
  id: text('id').primaryKey(),
  comment_id: text('comment_id')
    .notNull()
    .references(() => comments.id),
  // NULL = Agent reply; non-null = Clerk user id of the human who posted.
  author_user_id: text('author_user_id'),
  text: text('text'),
  // Sidecar [{id, kind:'user'|'agent', label}] extracted from the body at post
  // time. Source of truth for @mentions — read by the Agent to decide whether
  // to reply, read by the UI to render colored tokens inline.
  mentions: jsonb('mentions'),
  created_at: timestampDate('created_at'),
});

export const discussion_messages = pgTable(
  'discussion_messages',
  {
    id: text('id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id),
    // NULL = Agent message; non-null = Clerk user id of the human who posted.
    author_user_id: text('author_user_id'),
    text: text('text'),
    questions: jsonb('questions'),
    // Sidecar [{id, kind:'user'|'agent', label}] — see replies.mentions.
    mentions: jsonb('mentions'),
    created_at: timestampDate('created_at'),
  },
  (t) => [index('idx_discussion_messages_thread').on(t.thread_id, t.created_at, t.id)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id),
    message_id: text('message_id').references(() => discussion_messages.id, {
      onDelete: 'cascade',
    }),
    reply_id: text('reply_id').references(() => replies.id, { onDelete: 'cascade' }),
    mime: text('mime').notNull(),
    byte_len: integer('byte_len').notNull(),
    created_at: timestampDate('created_at'),
  },
  (t) => [
    check('one_parent', sql`(${t.message_id} IS NULL) <> (${t.reply_id} IS NULL)`),
    index('idx_att_message').on(t.message_id),
    index('idx_att_reply').on(t.reply_id),
  ],
);

export const events = pgTable(
  'events',
  {
    id: text('id').notNull(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id),
    // Global monotonic sequence — used to derive the event ID atomically, avoiding
    // per-thread advisory locks or MAX() races under concurrent inserts.
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    payload_json: jsonb('payload_json').notNull(),
    created_at: timestampDate('created_at'),
  },
  (t) => [primaryKey({ columns: [t.thread_id, t.id] })],
);

// VM run audit log (Slice 2). One row per Hosted Session. Writer is the
// provisioner (started_at) + teardown (ended_at, exit_reason, cost). Sole
// reader today is cost-rollup queries; required by Slice 2 acceptance #7.
// If cost instrumentation slips, this table slips with it.
export const vm_runs = pgTable(
  'vm_runs',
  {
    id: text('id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id),
    started_at: timestampDate('started_at'),
    ended_at: nullableTimestamp('ended_at'),
    // Free-form text; small known set today (idle_timeout, supervisor_kill,
    // crash, dev_disconnect). Promote to CHECK constraint when the set
    // stabilizes at ~5 values.
    exit_reason: text('exit_reason'),
    cost_estimate_usd: doublePrecision('cost_estimate_usd'),
    // E2B's sandbox ID — populated right after Sandbox.create succeeds, so
    // "find this row in E2B's dashboard" is one indexed lookup.
    sandbox_id: text('sandbox_id'),
    // Heartbeat: touched by any container on VM activity. A row whose
    // last_seen_at has lapsed beyond ~2× the E2B idle window is treated as
    // dead by getHostedState (lazy reap path).
    last_seen_at: nullableTimestamp('last_seen_at'),
  },
  (t) => [
    index('idx_vm_runs_thread_started').on(t.thread_id, t.started_at),
    // One live VM per thread — blocks genuine concurrent spawns. The spawn
    // path lazily reaps any stale-heartbeat open row first (WHERE ended_at IS
    // NULL AND last_seen_at < threshold) so this index never permanently
    // wedges a thread after a phantom row is reaped.
    uniqueIndex('uq_vm_runs_thread_live').on(t.thread_id).where(sql`ended_at IS NULL`),
  ],
);

// CLI user tokens — issued via the /api/cli/exchange OAuth-code flow.
// token_hash and refresh_token_hash store SHA-256(plaintext + pepper) so the
// plaintext values are never persisted. Unique on hash ensures a stolen DB
// dump cannot be replayed without the pepper.
export const userTokens = pgTable(
  'user_tokens',
  {
    id: text('id').primaryKey(), // utk_<random>
    user_id: text('user_id').notNull(), // Clerk user id
    token_hash: text('token_hash').notNull().unique(),
    refresh_token_hash: text('refresh_token_hash').notNull().unique(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    last_used_at: nullableTimestamp('last_used_at'),
    revoked_at: nullableTimestamp('revoked_at'),
  },
  (t) => [
    index('user_tokens_user').on(t.user_id),
    // Partial index: active (non-revoked) tokens only — keeps the lookup set small.
    index('user_tokens_lookup').on(t.token_hash).where(sql`revoked_at IS NULL`),
  ],
);

// Per-workspace connector enablement (Connectors slice). One row per
// (workspace, connector). `enabled` gates every gateway call — a disabled or
// missing row means the connector is off for that workspace. `tier` mirrors
// the static registry (tier1 = GitHub App, tier2 = Pipedream). `config` holds
// the tier-specific binding: GitHub stores {installation_id}; Pipedream stores
// {pipedream_account_id}. `connected_by` is the Clerk user id who flipped it on.
export const workspaceConnectors = pgTable(
  'workspace_connectors',
  {
    id: text('id').primaryKey(), // wsc_<ulid>
    workspace_id: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connector_id: text('connector_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    tier: text('tier').notNull(),
    config: jsonb('config'),
    connected_at: timestampDate('connected_at'),
    connected_by: text('connected_by'),
  },
  // One enablement row per connector per workspace — the gateway allowlist
  // check and the Console toggle both key off this pair.
  (t) => [uniqueIndex('uq_workspace_connectors').on(t.workspace_id, t.connector_id)],
);

// Connector call audit log (Connectors slice). One row per gateway tool call —
// written after the underlying client returns. Summaries are truncated JSON
// (caller slices to ~500 chars) so the table never holds full payloads. Sole
// reader today is the Console per-workspace audit view.
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(), // aud_<ulid>
    workspace_id: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    connector_id: text('connector_id').notNull(),
    tool_name: text('tool_name').notNull(),
    request_summary: text('request_summary'),
    response_summary: text('response_summary'),
    duration_ms: integer('duration_ms'),
    created_at: timestampDate('created_at'),
  },
  // Audit view scrolls a single workspace newest-first — index the access path.
  (t) => [index('idx_audit_log_workspace_created').on(t.workspace_id, t.created_at)],
);
