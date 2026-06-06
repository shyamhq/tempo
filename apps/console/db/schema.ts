import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  workspace_id: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  // Drag-reorder uses fractional indexing: drop between siblings writes the
  // midpoint of their sort_order values; no rebalance at this scale.
  sort_order: real('sort_order').notNull().default(0),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const threads = sqliteTable('threads', {
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
  sort_order: real('sort_order').notNull().default(0),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id),
    status: text('status', { enum: ['pending', 'connected', 'disconnected'] })
      .notNull()
      .default('pending'),
    last_seen_at: text('last_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    attached_repo_remote: text('attached_repo_remote'),
    attached_repo_path: text('attached_repo_path'),
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex('idx_sessions_one_connected_per_thread')
      .on(t.thread_id)
      .where(sql`${t.status} = 'connected'`),
  ],
);

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id')
    .notNull()
    .unique()
    .references(() => threads.id),
  body_markdown: text('body_markdown'),
  updated_by: text('updated_by', { enum: ['dev', 'agent'] }),
  updated_at: text('updated_at'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  thread_id: text('thread_id')
    .notNull()
    .references(() => threads.id),
  plan_quote: text('plan_quote').notNull(),
  plan_context: text('plan_context').notNull(),
  anchor_offset_hint: integer('anchor_offset_hint'),
  resolved_by: text('resolved_by', { enum: ['dev'] }),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const replies = sqliteTable('replies', {
  id: text('id').primaryKey(),
  comment_id: text('comment_id')
    .notNull()
    .references(() => comments.id),
  author: text('author', { enum: ['dev', 'agent'] }).notNull(),
  text: text('text'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const discussion_messages = sqliteTable(
  'discussion_messages',
  {
    id: text('id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id),
    author: text('author', { enum: ['dev', 'agent'] }).notNull(),
    text: text('text'),
    questions: text('questions', { mode: 'json' }),
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index('idx_discussion_messages_thread').on(t.thread_id, t.created_at, t.id)],
);

export const attachments = sqliteTable(
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
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    check('one_parent', sql`(${t.message_id} IS NULL) <> (${t.reply_id} IS NULL)`),
    index('idx_att_message').on(t.message_id),
    index('idx_att_reply').on(t.reply_id),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').notNull(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => threads.id),
    kind: text('kind').notNull(),
    payload_json: text('payload_json', { mode: 'json' }).notNull(),
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    primaryKey({ columns: [t.thread_id, t.id] }),
    index('idx_events_thread_id').on(t.thread_id, t.id),
  ],
);
