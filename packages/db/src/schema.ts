import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  doublePrecision,
  foreignKey,
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
  // Slice 2 — gates the Hosted runtime per Workspace. Worker reads this in
  // the Mailbox enqueue decision; admin UI is a follow-up slice.
  hosted_enabled: boolean('hosted_enabled').notNull().default(false),
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
  status: text('status', { enum: ['unapproved', 'approved'] })
    .notNull()
    .default('unapproved'),
  connect_token: text('connect_token').notNull(),
  sort_order: doublePrecision('sort_order').notNull().default(0),
  created_at: timestampDate('created_at'),
  updated_at: timestampDate('updated_at'),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id),
    status: text('status', { enum: ['pending', 'connected', 'disconnected'] })
      .notNull()
      .default('pending'),
    last_seen_at: timestampDate('last_seen_at'),
    attached_repo_remote: text('attached_repo_remote'),
    attached_repo_path: text('attached_repo_path'),
    // Nullable: only set when the session is established via Worker MCP
    // (slice 1c-1 onwards). Old Console-routed sessions leave this NULL.
    mcp_session_id: text('mcp_session_id'),
    created_at: timestampDate('created_at'),
  },
  (t) => [
    uniqueIndex('idx_sessions_one_connected_per_thread')
      .on(t.thread_id)
      .where(sql`${t.status} = 'connected'`),
    // The MCP transport assigns one UUID per session. Two concurrent
    // tempo_attach calls with the same id (rapid reconnect) must not both
    // insert; the partial unique index lets `.onConflictDoNothing()` win.
    uniqueIndex('idx_sessions_mcp_session_id')
      .on(t.mcp_session_id)
      .where(sql`${t.mcp_session_id} IS NOT NULL`),
  ],
);

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id')
    .notNull()
    .unique()
    .references(() => threads.id),
  // Plain text column holding stringified ProseMirror JSON. Callers do their
  // own JSON.parse / JSON.stringify so the storage layer doesn't double-encode.
  body_pm_json: text('body_pm_json'),
  updated_by: text('updated_by', { enum: ['dev', 'agent'] }),
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
  resolved_by: text('resolved_by', { enum: ['dev'] }),
  created_at: timestampDate('created_at'),
});

export const replies = pgTable('replies', {
  id: text('id').primaryKey(),
  comment_id: text('comment_id')
    .notNull()
    .references(() => comments.id),
  author: text('author', { enum: ['dev', 'agent'] }).notNull(),
  text: text('text'),
  created_at: timestampDate('created_at'),
});

export const discussion_messages = pgTable(
  'discussion_messages',
  {
    id: text('id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id),
    author: text('author', { enum: ['dev', 'agent'] }).notNull(),
    text: text('text'),
    questions: jsonb('questions'),
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

// Hosted wake-up queue (Slice 2). Worker writes one row per Dev-originated
// event when the Thread has no fresh Local Session and its Workspace has
// hosted_enabled. The VM polls its own rows between Turns; an unconsumed
// row plus a NOTIFY 'mailbox' payload trigger Hosted provisioning.
// `kind`/`payload_json` deliberately omitted — joined from `events` at drain
// time (one source of truth).
export const mailbox_events = pgTable(
  'mailbox_events',
  {
    id: text('id').primaryKey(),
    // No explicit FK to threads — the composite FK below ties (thread_id,
    // event_id) to events, and events.thread_id already FKs to threads, so
    // thread existence is enforced transitively without a duplicate index.
    thread_id: text('thread_id').notNull(),
    event_id: text('event_id').notNull(),
    created_at: timestampDate('created_at'),
    consumed_at: nullableTimestamp('consumed_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.thread_id, t.event_id],
      foreignColumns: [events.thread_id, events.id],
      name: 'mailbox_events_event_fk',
    }),
    // Idempotent enqueue: duplicate writes for the same (thread, event) are
    // no-ops via ON CONFLICT DO NOTHING. Also satisfies the composite FK
    // target requirement on `events`.
    uniqueIndex('idx_mailbox_events_thread_event').on(t.thread_id, t.event_id),
    // Hot path: drain pending rows in created_at order. Partial index keeps
    // the scan tight as consumed rows accumulate.
    index('idx_mailbox_events_pending')
      .on(t.thread_id, t.created_at)
      .where(sql`${t.consumed_at} IS NULL`),
  ],
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
  },
  (t) => [index('idx_vm_runs_thread_started').on(t.thread_id, t.started_at)],
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
