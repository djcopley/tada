import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())

export const workspaces = sqliteTable('workspaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  path: text('path').notNull(),
  defaultAdapter: text('default_adapter').notNull().default('claude'),
  defaultModel: text('default_model').notNull().default('sonnet'),
  concurrency: integer('concurrency').notNull().default(1),
  timeoutMs: integer('timeout_ms')
    .notNull()
    .default(30 * 60 * 1000),
  createdAt: createdAt(),
})
// repos live in manifest.json on disk (workspace manager owns them), not in SQLite —
// single source of truth for what's actually cloned.

export const columns = sqliteTable('columns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind', {
    enum: ['backlog', 'ready', 'in_progress', 'in_review', 'done', 'custom'],
  }).notNull(),
  title: text('title').notNull(),
  position: integer('position').notNull(),
  createdAt: createdAt(),
})

export const tickets = sqliteTable('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  columnId: integer('column_id')
    .notNull()
    .references(() => columns.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  position: real('position').notNull(), // fractional ordering for cheap drag-reorder
  queueState: text('queue_state', { enum: ['queued', 'held'] }), // null = not in queue
  adapterOverride: text('adapter_override'),
  modelOverride: text('model_override'),
  createdAt: createdAt(),
})

export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  author: text('author', { enum: ['human', 'agent'] }).notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
})

export const agentRuns = sqliteTable('agent_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  adapter: text('adapter').notNull(),
  model: text('model').notNull(),
  status: text('status', {
    enum: ['queued', 'running', 'needs_review', 'failed', 'cancelled'],
  }).notNull(),
  branch: text('branch'),
  prUrl: text('pr_url'),
  summary: text('summary'),
  transcriptPath: text('transcript_path'),
  runToken: text('run_token').notNull(), // MCP bearer token for this run
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
})

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id')
    .notNull()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'status' | 'tool_use' | 'text' | 'error'
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: createdAt(),
})

export const pushTokens = sqliteTable('push_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  createdAt: createdAt(),
})
