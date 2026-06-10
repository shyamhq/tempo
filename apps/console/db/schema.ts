import { sql } from 'drizzle-orm';
import {
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

// Timestamps are stored as `timestamp with time zone` but exposed to TS as ISO
// strings (mode: 'string'). The wire shape and the prior SQLite-era helpers
// (`toIso`, `nowIso`) already assume strings, so this keeps the surface stable.
const timestampString = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'string' }).notNull().defaultNow();

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  clerk_org_id: text('clerk_org_id').notNull().unique(),
  agent_api_key: text('agent_api_key').notNull().unique(),
  created_at: timestampString('created_at'),
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
  created_at: timestampString('created_at'),
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
  created_at: timestampString('created_at'),
  updated_at: timestampString('updated_at'),
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
    last_seen_at: timestampString('last_seen_at'),
    attached_repo_remote: text('attached_repo_remote'),
    attached_repo_path: text('attached_repo_path'),
    created_at: timestampString('created_at'),
  },
  (t) => [
    uniqueIndex('idx_sessions_one_connected_per_thread')
      .on(t.thread_id)
      .where(sql`${t.status} = 'connected'`),
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
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  created_at: timestampString('created_at'),
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
  created_at: timestampString('created_at'),
});

export const replies = pgTable('replies', {
  id: text('id').primaryKey(),
  comment_id: text('comment_id')
    .notNull()
    .references(() => comments.id),
  author: text('author', { enum: ['dev', 'agent'] }).notNull(),
  text: text('text'),
  created_at: timestampString('created_at'),
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
    created_at: timestampString('created_at'),
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
    created_at: timestampString('created_at'),
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
    kind: text('kind').notNull(),
    payload_json: jsonb('payload_json').notNull(),
    created_at: timestampString('created_at'),
  },
  (t) => [
    primaryKey({ columns: [t.thread_id, t.id] }),
    index('idx_events_thread_id').on(t.thread_id, t.id),
  ],
);
