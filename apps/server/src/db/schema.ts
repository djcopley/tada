import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())

/** Exactly one row (id = 1), seeded on first boot. Board, memory, rules and limits all hang off
 * the server root — there is no workspace layer. */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  adapter: text('adapter').notNull().default('claude'),
  model: text('model').notNull().default('sonnet'),
  effort: text('effort').notNull().default('medium'),
  concurrency: integer('concurrency').notNull().default(2),
  timeoutMs: integer('timeout_ms')
    .notNull()
    .default(30 * 60 * 1000),
  pingChannel: text('ping_channel', { enum: ['push', 'off'] })
    .notNull()
    .default('push'),
  repingMs: integer('reping_ms')
    .notNull()
    .default(60 * 60 * 1000),
})
// Sources (repo clones and attached folders) live in dataDir/manifest.json — the manifest is the
// single source of truth for what is actually cloned; SQLite has no repos table by design.

export const tickets = sqliteTable('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  column: text('column', { enum: ['backlog', 'queued', 'running', 'stopped', 'done'] })
    .notNull()
    .default('backlog'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  position: real('position').notNull(), // fractional ordering for cheap drag-reorder
  // Written only by the runner when a run checks a repo out — never by the API. A tag is
  // evidence of what a run touched, not a plan.
  repoTags: text('repo_tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  origin: text('origin', { enum: ['human', 'agent'] })
    .notNull()
    .default('human'),
  // Per-ticket overrides of the global settings row, snapshotted onto the run at enqueue time
  // (`Scheduler.enqueue`) exactly like `settings.adapter`/`settings.model` are. Null = "use
  // whatever the global settings say".
  adapter: text('adapter'),
  model: text('model'),
  proposalState: text('proposal_state', { enum: ['pending'] }), // null = not a proposal
  followUpOfTicketId: integer('follow_up_of_ticket_id').references(
    (): AnySQLiteColumn => tickets.id,
    { onDelete: 'set null' },
  ),
  doneAt: integer('done_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
})

/** The ticket thread. Human entries are notes to the agent; agent entries are its updates. */
export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  runId: integer('run_id'),
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
  effort: text('effort').notNull().default('medium'),
  attemptNumber: integer('attempt_number').notNull().default(1),
  status: text('status', {
    enum: ['queued', 'running', 'held', 'done', 'failed', 'cancelled'],
  }).notNull(),
  heldReason: text('held_reason', { enum: ['permission', 'question', 'time'] }),
  hold: text('hold', { mode: 'json' }), // shared Hold, present while status = held
  heldAt: integer('held_at', { mode: 'timestamp' }),
  budgetMs: integer('budget_ms').notNull(),
  summary: text('summary'),
  transcriptPath: text('transcript_path'),
  runToken: text('run_token').notNull(), // MCP bearer token for this run
  diffAdditions: integer('diff_additions'),
  diffDeletions: integer('diff_deletions'),
  testsPassed: integer('tests_passed'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
})

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'status' | 'tool_use' | 'text' | 'error' | 'gate'
    payload: text('payload', { mode: 'json' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('events_run_id_idx').on(t.runId)],
)

/** The permission rule table. Checked before every gated tool call; first match (by position)
 * wins; an unmatched call is allowed. */
export const rules = sqliteTable('rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  tool: text('tool').notNull(),
  patterns: text('patterns', { mode: 'json' }).$type<string[]>().notNull().default([]),
  decision: text('decision', { enum: ['allow', 'ask', 'never'] }).notNull(),
  publishes: integer('publishes', { mode: 'boolean' }).notNull().default(false),
  position: real('position').notNull(),
  source: text('source', { enum: ['default', 'human', 'gate'] })
    .notNull()
    .default('human'),
  sourceRunId: integer('source_run_id'),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const pushTokens = sqliteTable('push_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  createdAt: createdAt(),
})

export const activity = sqliteTable('activity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id'),
  runId: integer('run_id'),
  type: text('type').notNull(),
  message: text('message').notNull(),
  createdAt: createdAt(),
})

/** One memory list. Untagged notes ride on every run; a note tagged to a repo is handed to the
 * agent when a run checks that repo out. */
export const memoryNotes = sqliteTable('memory_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  author: text('author', { enum: ['human', 'agent'] })
    .notNull()
    .default('human'),
  runId: integer('run_id'),
  state: text('state', { enum: ['kept', 'pending'] })
    .notNull()
    .default('kept'),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})
