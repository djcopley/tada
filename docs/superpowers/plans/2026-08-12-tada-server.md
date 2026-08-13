# tada Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `tada-server` daemon: SQLite-backed kanban/queue, workspace + worktree management, adapter-based agent runner with a FakeAdapter, tada MCP server, REST/WebSocket API, Claude adapter, and Expo push — everything from the spec except the Expo client (separate plan).

**Architecture:** pnpm monorepo. `packages/shared` holds domain types and the pure ticket/run state machine. `apps/server` is a Fastify daemon: Drizzle/better-sqlite3 storage, a per-workspace sequential scheduler that builds git-worktree run dirs and executes agents through a thin `Adapter` interface, a Streamable-HTTP MCP server for agent→ticket updates, and REST+WS for clients. Spec: `docs/superpowers/specs/2026-08-12-tada-design.md`.

**Tech Stack:** Node 22, TypeScript (strict), pnpm workspaces, Biome (lint+format), Vitest, Fastify (+ @fastify/websocket), Drizzle ORM + better-sqlite3, execa, @modelcontextprotocol/sdk, @anthropic-ai/claude-agent-sdk, zod.

## Global Constraints

- Node >= 22, ESM everywhere (`"type": "module"`).
- Strict TS: `strict: true`, `noUncheckedIndexedAccess: true`. `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass at every commit.
- Data under `$XDG_DATA_HOME/tada` (fallback `~/.local/share/tada`); config under `$XDG_CONFIG_HOME/tada`; transcripts/logs under `$XDG_STATE_HOME/tada`. Tests override all three via env vars — never touch real XDG dirs in tests.
- Default columns: Backlog / Ready / In Progress / In Review / Done. Ready order = execution priority. Done is human-only.
- Run statuses: `queued → running → needs_review | failed | cancelled`. Failed runs are never auto-retried.
- Per-workspace concurrency default 1; timeout default 30 min.
- PR is an artifact, never a requirement: open one only when commits exist on `ticket/<id>`.
- No AI attribution in any git commit or PR the system (or you) creates.
- Git tests use local bare repos in temp dirs — no network.

---

### Task 1: Monorepo scaffold + tooling

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `.nvmrc`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/index.ts`, `apps/server/vitest.config.ts`

**Interfaces:**
- Produces: workspace commands `pnpm lint`, `pnpm typecheck`, `pnpm test`; package name `@tada/shared` importable from `@tada/server`.

- [ ] **Step 1: Write config files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

Root `package.json`:
```json
{
  "name": "tada",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  },
  "devDependencies": { "@biomejs/biome": "^2.0.0", "typescript": "^5.6.0" }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist"
  }
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } },
  "files": { "ignore": ["**/dist/**", "**/node_modules/**"] }
}
```

`.gitignore`: `node_modules/`, `dist/`, `*.tsbuildinfo`, `.env`. `.nvmrc`: `22`.

`packages/shared/package.json`:
```json
{
  "name": "@tada/shared",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": { "vitest": "^3.0.0" }
}
```

`apps/server/package.json` mirrors it with name `@tada/server`, plus `"dependencies": { "@tada/shared": "workspace:*" }`. Each package `tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src", "test"] }`. `packages/shared/src/index.ts` and `apps/server/src/index.ts`: `export {}` for now. `apps/server/vitest.config.ts`: `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { pool: 'forks' } })` (better-sqlite3 is native).

- [ ] **Step 2: Install and verify**

Run: `pnpm install && pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass ("no test files found" is acceptable at this point — configure vitest `passWithNoTests: true` in both packages).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm monorepo with biome, strict tsconfig, vitest"
```

---

### Task 2: Domain types + state machine (`@tada/shared`)

**Files:**
- Create: `packages/shared/src/domain.ts`, `packages/shared/src/stateMachine.ts`
- Modify: `packages/shared/src/index.ts` (re-export both)
- Test: `packages/shared/test/stateMachine.test.ts`

**Interfaces:**
- Produces:
```ts
export type ColumnKind = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done' | 'custom'
export type RunStatus = 'queued' | 'running' | 'needs_review' | 'failed' | 'cancelled'
export type QueueState = 'queued' | 'held' | null  // held = failed run; needs re-queue by human
export type Actor = 'human' | 'orchestrator'
export interface RunOutcome { status: 'success' | 'failed'; summary: string }
export function canTransitionRun(from: RunStatus, to: RunStatus): boolean
export function canMoveCard(actor: Actor, from: ColumnKind, to: ColumnKind): boolean
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from 'vitest'
import { canMoveCard, canTransitionRun } from '../src/stateMachine.js'

describe('canTransitionRun', () => {
  test.each([
    ['queued', 'running', true], ['queued', 'cancelled', true],
    ['running', 'needs_review', true], ['running', 'failed', true], ['running', 'cancelled', true],
    ['queued', 'needs_review', false], ['needs_review', 'running', false],
    ['failed', 'running', false], ['running', 'queued', false],
  ] as const)('%s -> %s = %s', (from, to, ok) => {
    expect(canTransitionRun(from, to)).toBe(ok)
  })
})

describe('canMoveCard', () => {
  test('orchestrator: ready->in_progress, in_progress->in_review, in_progress->ready only', () => {
    expect(canMoveCard('orchestrator', 'ready', 'in_progress')).toBe(true)
    expect(canMoveCard('orchestrator', 'in_progress', 'in_review')).toBe(true)
    expect(canMoveCard('orchestrator', 'in_progress', 'ready')).toBe(true)
    expect(canMoveCard('orchestrator', 'backlog', 'ready')).toBe(false)
    expect(canMoveCard('orchestrator', 'in_review', 'done')).toBe(false)
  })
  test('human: anywhere except into in_progress', () => {
    expect(canMoveCard('human', 'backlog', 'ready')).toBe(true)
    expect(canMoveCard('human', 'in_review', 'done')).toBe(true)
    expect(canMoveCard('human', 'in_review', 'ready')).toBe(true)
    expect(canMoveCard('human', 'ready', 'in_progress')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests, verify FAIL** — `pnpm --filter @tada/shared test`

- [ ] **Step 3: Implement**

`domain.ts` holds the types above plus entity interfaces used across the app (Workspace, Ticket, Comment, AgentRun, RunEvent — plain interfaces mirroring the DB rows in Task 3). `stateMachine.ts`:

```ts
import type { Actor, ColumnKind, RunStatus } from './domain.js'

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['needs_review', 'failed', 'cancelled'],
  needs_review: [], failed: [], cancelled: [],
}
export const canTransitionRun = (from: RunStatus, to: RunStatus): boolean =>
  RUN_TRANSITIONS[from].includes(to)

const ORCHESTRATOR_MOVES: ReadonlyArray<readonly [ColumnKind, ColumnKind]> = [
  ['ready', 'in_progress'], ['in_progress', 'in_review'], ['in_progress', 'ready'],
]
export function canMoveCard(actor: Actor, from: ColumnKind, to: ColumnKind): boolean {
  if (actor === 'orchestrator') return ORCHESTRATOR_MOVES.some(([f, t]) => f === from && t === to)
  return to !== 'in_progress'
}
```

- [ ] **Step 4: Run tests, verify PASS**; run `pnpm lint && pnpm typecheck`

- [ ] **Step 5: Commit** — `git commit -m "feat(shared): domain types and card/run state machine"`

---

### Task 3: Database schema + access layer

**Files:**
- Create: `apps/server/src/db/schema.ts`, `apps/server/src/db/index.ts`, `apps/server/drizzle.config.ts`, `apps/server/drizzle/` (generated migrations)
- Test: `apps/server/test/db.test.ts`

**Interfaces:**
- Consumes: types from `@tada/shared`.
- Produces: `openDb(path: string): TadaDb` where `TadaDb = { drizzle: BetterSQLite3Database<typeof schema>; raw: Database }`; tables `workspaces, columns, tickets, comments, agentRuns, events, pushTokens`; `createDefaultColumns(db, workspaceId)`.

- [ ] **Step 1: Add deps** — `pnpm --filter @tada/server add drizzle-orm better-sqlite3 zod && pnpm --filter @tada/server add -D drizzle-kit @types/better-sqlite3`

- [ ] **Step 2: Write failing test**

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createDefaultColumns, openDb } from '../src/db/index.js'
import { columns, tickets, workspaces } from '../src/db/schema.js'

describe('db', () => {
  test('migrates, seeds default columns, round-trips a ticket', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'tada-')), 'tada.db'))
    const [ws] = db.drizzle.insert(workspaces).values({ name: 'demo', path: '/tmp/x' }).returning().all()
    createDefaultColumns(db, ws!.id)
    const cols = db.drizzle.select().from(columns).all()
    expect(cols.map((c) => c.kind)).toEqual(['backlog', 'ready', 'in_progress', 'in_review', 'done'])
    const ready = cols.find((c) => c.kind === 'ready')!
    const [t] = db.drizzle.insert(tickets).values({
      workspaceId: ws!.id, columnId: ready.id, title: 'Fix crash', description: 'Repro: …', position: 1,
    }).returning().all()
    expect(t!.queueState).toBeNull()
  })
})
```

- [ ] **Step 3: Run test, verify FAIL**

- [ ] **Step 4: Implement schema**

`schema.ts` (sqlite-core; ids are `integer('id').primaryKey({ autoIncrement: true })`; timestamps `integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())` — same pattern on every table, not repeated below):

```ts
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const workspaces = sqliteTable('workspaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  path: text('path').notNull(),
  defaultAdapter: text('default_adapter').notNull().default('claude'),
  defaultModel: text('default_model').notNull().default('sonnet'),
  concurrency: integer('concurrency').notNull().default(1),
  timeoutMs: integer('timeout_ms').notNull().default(30 * 60 * 1000),
})
// repos live in manifest.json on disk (workspace manager owns them), not in SQLite —
// single source of truth for what's actually cloned.

export const columns = sqliteTable('columns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['backlog', 'ready', 'in_progress', 'in_review', 'done', 'custom'] }).notNull(),
  title: text('title').notNull(),
  position: integer('position').notNull(),
})

export const tickets = sqliteTable('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  columnId: integer('column_id').notNull().references(() => columns.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  position: real('position').notNull(), // fractional ordering for cheap drag-reorder
  queueState: text('queue_state', { enum: ['queued', 'held'] }), // null = not in queue
  adapterOverride: text('adapter_override'),
  modelOverride: text('model_override'),
})

export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  author: text('author', { enum: ['human', 'agent'] }).notNull(),
  body: text('body').notNull(),
})

export const agentRuns = sqliteTable('agent_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  adapter: text('adapter').notNull(),
  model: text('model').notNull(),
  status: text('status', { enum: ['queued', 'running', 'needs_review', 'failed', 'cancelled'] }).notNull(),
  branch: text('branch'),
  prUrl: text('pr_url'),
  summary: text('summary'),
  transcriptPath: text('transcript_path'),
  runToken: text('run_token').notNull(), // MCP bearer token for this run
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
})

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'status' | 'tool_use' | 'text' | 'error'
  payload: text('payload', { mode: 'json' }).notNull(),
})

export const pushTokens = sqliteTable('push_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
})
```

`db/index.ts`:

```ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.js'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle')
const DEFAULT_COLUMNS = [
  ['backlog', 'Backlog'], ['ready', 'Ready'], ['in_progress', 'In Progress'],
  ['in_review', 'In Review'], ['done', 'Done'],
] as const

export type TadaDb = { drizzle: ReturnType<typeof drizzle<typeof schema>>; raw: Database.Database }

export function openDb(path: string): TadaDb {
  const raw = new Database(path)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  const d = drizzle(raw, { schema })
  migrate(d, { migrationsFolder: MIGRATIONS })
  return { drizzle: d, raw }
}

export function createDefaultColumns(db: TadaDb, workspaceId: number): void {
  db.drizzle.insert(schema.columns)
    .values(DEFAULT_COLUMNS.map(([kind, title], i) => ({ workspaceId, kind, title, position: i })))
    .run()
}
```

`drizzle.config.ts`: `{ schema: './src/db/schema.ts', out: './drizzle', dialect: 'sqlite' }`. Generate migrations: `pnpm --filter @tada/server exec drizzle-kit generate`.

- [ ] **Step 5: Run test, verify PASS**; `pnpm lint && pnpm typecheck`

- [ ] **Step 6: Commit** — `git commit -m "feat(server): sqlite schema, migrations, db bootstrap"`

---

### Task 4: XDG paths + workspace manager

**Files:**
- Create: `apps/server/src/paths.ts`, `apps/server/src/workspaces/manager.ts`, `apps/server/src/git.ts`
- Test: `apps/server/test/workspaces.test.ts`, `apps/server/test/helpers/gitFixtures.ts`

**Interfaces:**
- Consumes: `TadaDb`.
- Produces:
```ts
// paths.ts — every fn respects env override, then XDG var, then fallback
export function dataDir(): string   // $TADA_DATA_DIR ?? $XDG_DATA_HOME/tada ?? ~/.local/share/tada
export function configDir(): string // $TADA_CONFIG_DIR ?? $XDG_CONFIG_HOME/tada ?? ~/.config/tada
export function stateDir(): string  // $TADA_STATE_DIR ?? $XDG_STATE_HOME/tada ?? ~/.local/state/tada

// git.ts
export function git(cwd: string, ...args: string[]): Promise<string> // execa wrapper, trimmed stdout, throws on nonzero

// workspaces/manager.ts
export interface RepoEntry { name: string; url: string; defaultBranch: string }
export interface Manifest { repos: RepoEntry[] }
export class WorkspaceManager {
  constructor(db: TadaDb)
  async create(name: string): Promise<number>            // db row + dirs + empty manifest + memory/AGENTS.md stub
  async addRepo(wsId: number, url: string): Promise<void>    // clone into repos/<name>, append manifest
  async removeRepo(wsId: number, name: string): Promise<void> // rm -rf clone, update manifest
  manifest(wsId: number): Manifest
  memoryDir(wsId: number): string
  reposDir(wsId: number): string
}
```

- [ ] **Step 1: Add dep** — `pnpm --filter @tada/server add execa`

- [ ] **Step 2: Write git fixture helper + failing tests**

`test/helpers/gitFixtures.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../../src/git.js'

/** Creates a bare origin with one commit on main; returns its path (file:// clonable). */
export async function makeOrigin(name = 'proj'): Promise<string> {
  const base = mkdtempSync(join(tmpdir(), 'tada-git-'))
  const work = join(base, 'work')
  await git(base, 'init', '-b', 'main', work)
  writeFileSync(join(work, 'README.md'), `# ${name}\n`)
  await git(work, 'add', '.')
  await git(work, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init')
  const bare = join(base, `${name}.git`)
  await git(base, 'clone', '--bare', work, bare)
  return bare
}

/** Test env: point all tada dirs at a fresh temp dir. Call in beforeEach. */
export function isolateXdg(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tada-xdg-'))
  process.env.TADA_DATA_DIR = join(dir, 'data')
  process.env.TADA_CONFIG_DIR = join(dir, 'config')
  process.env.TADA_STATE_DIR = join(dir, 'state')
  return dir
}
```

Tests: `create` makes `workspaces/<name>/{repos,memory}` under `dataDir()` with `manifest.json` `{"repos":[]}` and a `memory/AGENTS.md` stub; `addRepo(makeOrigin())` clones into `repos/proj` and manifest lists it with `defaultBranch: 'main'`; `removeRepo` deletes the dir and manifest entry; `paths.ts` honors `TADA_DATA_DIR` override.

- [ ] **Step 3: Run tests, verify FAIL**

- [ ] **Step 4: Implement**

`paths.ts` pattern (one fn shown; others identical with their vars):
```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
export const dataDir = (): string =>
  process.env.TADA_DATA_DIR ??
  join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'tada')
```

`git.ts`:
```ts
import { execa } from 'execa'
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd })
  return stdout.trim()
}
```

`manager.ts`: repo name = basename of URL minus `.git`; `defaultBranch` from `git(clone, 'symbolic-ref', '--short', 'HEAD')`; manifest read/written with zod validation (`Manifest` schema). `create` seeds `AGENTS.md` with: `# <name>\n\nWorkspace charter. Conventions, goals, and gotchas agents should know.\n` and `mkdir -p memory/notes`.

- [ ] **Step 5: Run tests, verify PASS**; lint + typecheck

- [ ] **Step 6: Commit** — `git commit -m "feat(server): xdg paths and workspace manager with manifest-backed repos"`

---

### Task 5: Run directory builder (worktrees)

**Files:**
- Create: `apps/server/src/runs/runDir.ts`
- Test: `apps/server/test/runDir.test.ts`

**Interfaces:**
- Consumes: `WorkspaceManager`, `git()`, `stateDir()`.
- Produces:
```ts
export interface RunDir { path: string; repoDirs: Record<string, string> } // repoName -> worktree path
export async function buildRunDir(wm: WorkspaceManager, wsId: number, ticketId: number, runId: number): Promise<RunDir>
export async function cleanupRunDir(wm: WorkspaceManager, wsId: number, runDir: RunDir): Promise<void>
export const branchFor = (ticketId: number): string => `ticket/${ticketId}`
```

- [ ] **Step 1: Write failing tests**

Using `makeOrigin` + `isolateXdg` + a `WorkspaceManager` with one repo added:
1. `buildRunDir` creates `<stateDir>/runs/<runId>/` containing a worktree per repo on branch `ticket/<id>`, a `memory` symlink resolving to the canonical `memory/`, and an empty `scratch/`.
2. A commit made in the worktree is visible from the canonical clone (`git(canonical, 'log', 'ticket/<id>', '--oneline')` shows it) — the object-store-sharing property the design relies on.
3. Second `buildRunDir` for the same ticket (send-back) reuses the existing `ticket/<id>` branch including its commit.
4. `cleanupRunDir` removes worktrees (`git worktree list` no longer shows them) but the branch survives.

- [ ] **Step 2: Run tests, verify FAIL**

- [ ] **Step 3: Implement**

```ts
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { stateDir } from '../paths.js'
import { git } from '../git.js'
import type { WorkspaceManager } from '../workspaces/manager.js'

export const branchFor = (ticketId: number): string => `ticket/${ticketId}`

export async function buildRunDir(wm, wsId, ticketId, runId) {
  const path = join(stateDir(), 'runs', String(runId))
  mkdirSync(join(path, 'scratch'), { recursive: true })
  symlinkSync(wm.memoryDir(wsId), join(path, 'memory'))
  const branch = branchFor(ticketId)
  const repoDirs: Record<string, string> = {}
  for (const repo of wm.manifest(wsId).repos) {
    const canonical = join(wm.reposDir(wsId), repo.name)
    const wt = join(path, repo.name)
    const exists = (await git(canonical, 'branch', '--list', branch)) !== ''
    await (exists
      ? git(canonical, 'worktree', 'add', wt, branch)
      : git(canonical, 'worktree', 'add', '-b', branch, wt, repo.defaultBranch))
    repoDirs[repo.name] = wt
  }
  return { path, repoDirs }
}

export async function cleanupRunDir(wm, wsId, runDir) {
  for (const repo of wm.manifest(wsId).repos) {
    const canonical = join(wm.reposDir(wsId), repo.name)
    await git(canonical, 'worktree', 'remove', '--force', runDir.repoDirs[repo.name] ?? '').catch(() => {})
    await git(canonical, 'worktree', 'prune')
  }
  rmSync(runDir.path, { recursive: true, force: true })
}
```
(Real file includes the full type annotations from the interface block.)

- [ ] **Step 4: Run tests, verify PASS**; lint + typecheck

- [ ] **Step 5: Commit** — `git commit -m "feat(server): worktree-based run directories with shared memory mount"`

---

### Task 6: Adapter interface, event journal, FakeAdapter

**Files:**
- Create: `apps/server/src/adapters/types.ts`, `apps/server/src/adapters/fake.ts`, `apps/server/src/runs/journal.ts`
- Test: `apps/server/test/fakeAdapter.test.ts`

**Interfaces:**
- Produces:
```ts
// adapters/types.ts
export interface AdapterEvent { type: 'status' | 'tool_use' | 'text' | 'error'; payload: unknown }
export interface RunContext {
  runDir: string
  prompt: string
  model: string
  timeoutMs: number
  mcp: { url: string; token: string }
  onEvent: (e: AdapterEvent) => void
  signal: AbortSignal
}
export interface Adapter {
  readonly name: string
  readonly models: readonly string[]
  run(ctx: RunContext): Promise<{ exitCode: number }>
}

// runs/journal.ts — tee: every event -> events table + JSONL transcript + WS broadcast hook
export class Journal {
  constructor(db: TadaDb, runId: number, transcriptPath: string, broadcast?: (runId: number, e: AdapterEvent) => void)
  write(e: AdapterEvent): void
  close(): void
}

// adapters/fake.ts — test double, also used by API e2e tests
export interface FakeScript { events?: AdapterEvent[]; act?: (ctx: RunContext) => Promise<void>; exitCode?: number }
export class FakeAdapter implements Adapter { constructor(script?: FakeScript) }
```

- [ ] **Step 1: Write failing tests**

1. `FakeAdapter` with `events: [{type:'text',payload:'hi'}]` invokes `onEvent` for each and resolves `{ exitCode: 0 }`.
2. `act` callback runs with the ctx (test writes a file into `ctx.runDir` and asserts it exists after).
3. `Journal.write` appends a row to `events` and a JSON line to the transcript file; `broadcast` is called.
4. FakeAdapter honors `ctx.signal`: pre-aborted signal → rejects with `AbortError` before emitting events.

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

`fake.ts`:
```ts
export class FakeAdapter implements Adapter {
  readonly name = 'fake'
  readonly models = ['fake-1'] as const
  constructor(private script: FakeScript = {}) {}
  async run(ctx: RunContext): Promise<{ exitCode: number }> {
    ctx.signal.throwIfAborted()
    for (const e of this.script.events ?? []) ctx.onEvent(e)
    await this.script.act?.(ctx)
    return { exitCode: this.script.exitCode ?? 0 }
  }
}
```

`journal.ts`: `appendFileSync(transcriptPath, JSON.stringify(e) + '\n')`, insert into `events`, call `broadcast?.(runId, e)`. `close()` is a no-op placeholder kept for symmetry (fs appends are atomic enough at this scale).

- [ ] **Step 4: Run tests, verify PASS**; lint + typecheck

- [ ] **Step 5: Commit** — `git commit -m "feat(server): adapter interface, event journal, fake adapter"`

---

### Task 7: Prompt composer

**Files:**
- Create: `apps/server/src/runs/prompt.ts`
- Test: `apps/server/test/prompt.test.ts`

**Interfaces:**
- Consumes: DB rows (ticket, comments, prior runs), `WorkspaceManager.memoryDir`.
- Produces: `composePrompt(input: PromptInput): string` with
```ts
export interface PromptInput {
  ticket: { id: number; title: string; description: string }
  comments: Array<{ author: 'human' | 'agent'; body: string; createdAt: Date }>
  agentsMd: string
  noteFiles: string[]           // filenames under memory/notes
  priorRunSummaries: string[]   // non-empty only on send-backs
}
```

- [ ] **Step 1: Write failing tests**

Assert the output: starts with `# Task: <title>`; contains the description verbatim; renders comments as `**human:** …` / `**agent:** …` in order; includes the AGENTS.md content under `## Workspace charter`; lists note filenames under `## Workspace memory` with the instruction sentence (exact string below); includes `## Previous attempts` only when `priorRunSummaries` is non-empty; always ends with the standing instructions section mentioning `report_outcome`.

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

Template (string builder, one section per block; skip empty sections):

```
# Task: {title}

{description}

## Discussion
**{author}:** {body}   (chronological)

## Workspace charter
{agentsMd}

## Workspace memory
Notes available in ./memory/notes: {filenames or '(none yet)'}
Read notes relevant to this task. If you learn something durable about this
workspace (a build quirk, credential location, API behavior), record it as a
new markdown note in ./memory/notes/.

## Previous attempts
{numbered priorRunSummaries}

## How to work
- Your working directory contains a checkout per repo on branch ticket/{id}; commit your work there. Not every task needs code changes — some are operational.
- Post progress or findings to your ticket with the tada MCP tool `update_ticket`. Attach non-PR artifacts with `attach_link`/`attach_file`.
- When finished, you MUST call `report_outcome` with status success or failed and a concise summary. Do not open pull requests yourself; the system handles that after you finish.
```

- [ ] **Step 4: Run tests, verify PASS**; lint + typecheck

- [ ] **Step 5: Commit** — `git commit -m "feat(server): run prompt composer"`

---

### Task 8: Fastify app skeleton + bearer auth + config

**Files:**
- Create: `apps/server/src/config.ts`, `apps/server/src/app.ts`
- Test: `apps/server/test/app.test.ts`

**Interfaces:**
- Produces:
```ts
// config.ts — reads <configDir>/config.json, zod-validated; creates with generated token on first run
export interface Config { port: number; bearerToken: string }
export function loadConfig(): Config

// app.ts — builds Fastify with auth hook; routes/plugins registered by later tasks
export interface AppDeps { db: TadaDb; config: Config }
export function buildApp(deps: AppDeps): FastifyInstance
// every route except /health and /mcp requires: Authorization: Bearer <config.bearerToken>
// /mcp uses per-run tokens (Task 9)
```

- [ ] **Step 1: Add deps** — `pnpm --filter @tada/server add fastify @fastify/websocket`

- [ ] **Step 2: Write failing tests** (use `app.inject`)

1. `GET /health` → 200 `{ ok: true }` with no auth.
2. Any other route without/with wrong bearer → 401.
3. Correct bearer passes (register a dummy `GET /whoami` in the test via `app.get` before `ready`).
4. `loadConfig()` on empty config dir writes `config.json` with a 32-byte-hex `bearerToken` and `port: 4242`; second call reads the same token back.

- [ ] **Step 3: Run, verify FAIL**

- [ ] **Step 4: Implement**

`config.ts`: `randomBytes(32).toString('hex')` for the token; zod schema `{ port: z.number().int().default(4242), bearerToken: z.string().min(32) }`; `mkdirSync(configDir(), {recursive:true})`. `app.ts`:

```ts
export function buildApp({ db, config }: AppDeps): FastifyInstance {
  const app = fastify()
  app.decorate('db', db)
  app.get('/health', async () => ({ ok: true }))
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health' || req.url.startsWith('/mcp')) return
    if (req.headers.authorization !== `Bearer ${config.bearerToken}`) {
      await reply.code(401).send({ error: 'unauthorized' })
    }
  })
  return app
}
```

- [ ] **Step 5: Run tests, verify PASS**; lint + typecheck

- [ ] **Step 6: Commit** — `git commit -m "feat(server): fastify skeleton with bearer auth and config bootstrap"`

---

### Task 9: tada MCP server

**Files:**
- Create: `apps/server/src/mcp/server.ts`
- Modify: `apps/server/src/app.ts` (register `/mcp` route)
- Test: `apps/server/test/mcp.test.ts`

**Interfaces:**
- Consumes: `TadaDb`, run rows (`runToken` column), Fastify app.
- Produces: HTTP MCP endpoint `POST /mcp` (Streamable HTTP transport, stateless mode) authed by `Authorization: Bearer <runToken>` resolving to that run's ticket. Tools:
  - `update_ticket({ comment: string })` → inserts `comments` row with `author: 'agent'`
  - `attach_link({ url: string, label: string })` → agent comment `[label](url)`
  - `attach_file({ path: string })` → copies file into `<stateDir>/attachments/<runId>/`, comment links it
  - `report_outcome({ status: 'success' | 'failed', summary: string })` → stores `summary` on the run row; the runner (Task 10) reads it after exit
- Also produces `pendingOutcome(db, runId): RunOutcome | null` helper for the runner.

- [ ] **Step 1: Add dep** — `pnpm --filter @tada/server add @modelcontextprotocol/sdk`

- [ ] **Step 2: Write failing tests**

Drive the endpoint with the SDK client (`StreamableHTTPClientTransport` pointed at the injected Fastify server via `app.listen({port:0})`):
1. `tools/list` with a valid run token returns the four tools.
2. `update_ticket` inserts an agent comment on the right ticket.
3. `report_outcome` persists `{status, summary}` retrievable via `pendingOutcome`.
4. Bad/missing token → HTTP 401 before any MCP handling.

- [ ] **Step 3: Run, verify FAIL**

- [ ] **Step 4: Implement**

`mcp/server.ts` builds an `McpServer` per request (stateless streamable HTTP per SDK docs), registers the four tools with zod input schemas, each closing over `{ db, runId, ticketId }` resolved from the bearer token (`agentRuns` lookup; 401 if absent or run not `running`/`queued`). Fastify route uses `app.route({ method: 'POST', url: '/mcp', handler })` bridging Fastify raw req/res to the SDK transport (`transport.handleRequest(req.raw, reply.raw, req.body)`).

- [ ] **Step 5: Run tests, verify PASS**; lint + typecheck

- [ ] **Step 6: Commit** — `git commit -m "feat(server): tada MCP server with ticket tools and per-run auth"`

---

### Task 10: Runner + completion flow (push, PR, outcome)

**Files:**
- Create: `apps/server/src/runs/runner.ts`, `apps/server/src/runs/completion.ts`
- Test: `apps/server/test/runner.test.ts`, `apps/server/test/completion.test.ts`

**Interfaces:**
- Consumes: everything so far: `buildRunDir`, `Journal`, `Adapter`, `composePrompt`, `pendingOutcome`, `branchFor`, `canTransitionRun`, `canMoveCard`.
- Produces:
```ts
// completion.ts
export interface CompletionResult { pushedRepos: string[]; prUrls: string[] }
/** For each repo: if ticket branch has commits ahead of default branch, push -u origin and
 *  open a PR via `gh pr create` (skipped when opts.pr === false, e.g. tests). */
export async function completeRun(wm, wsId, ticketId, opts: { pr: boolean }): Promise<CompletionResult>

// runner.ts — executes ONE run to terminal state; scheduling is Task 11
export interface RunnerDeps { db: TadaDb; wm: WorkspaceManager; adapters: Map<string, Adapter>; broadcast?: BroadcastFn; pr?: boolean }
export async function executeRun(deps: RunnerDeps, runId: number): Promise<void>
```
`executeRun` flow: mark run `running` + move card ready→in_progress (orchestrator) → buildRunDir → composePrompt → adapter.run with AbortController-based timeout (kills whole process tree for CLI adapters — they spawn `detached: true` and the abort handler kills `-pid`; FakeAdapter just observes the signal) → on exit read `pendingOutcome`; missing outcome or `failed` or nonzero exit or timeout ⇒ run `failed`, card in_progress→ready, `queueState = 'held'` → else `completeRun` ⇒ run `needs_review` with `prUrl`/`summary`, card in_progress→in_review, `queueState = null`. All state changes journal an event first. Worktree cleanup does NOT happen here (spec: cleanup on Done — API task).

- [ ] **Step 1: Write failing completion tests**

Using git fixtures (`pr: false` so no `gh` in tests):
1. Agent committed on `ticket/<id>` → `completeRun` pushes; assert bare origin now has the branch (`git(origin,'branch','--list','ticket/1')`).
2. No commits beyond base → nothing pushed, `pushedRepos: []`.

- [ ] **Step 2: Write failing runner tests**

FakeAdapter variants against a seeded db+workspace:
1. Success path: `act` calls a helper that inserts the outcome row (simulating `report_outcome`) → run ends `needs_review`, ticket lands in `in_review`, events include status transitions.
2. Agent never reports outcome → `failed`, ticket back in `ready` with `queueState: 'held'`.
3. `exitCode: 1` → `failed`.
4. Timeout: `act: () => new Promise(r => setTimeout(r, 60_000))` with `timeoutMs: 50` → `failed` within ~1s, abort signal fired.
5. Success with commits (act writes + commits in `ctx.runDir/<repo>`) → branch pushed to origin, summary stored.

- [ ] **Step 3: Run, verify FAIL**

- [ ] **Step 4: Implement**

`completion.ts` core:
```ts
const ahead = await git(canonical, 'rev-list', '--count', `${repo.defaultBranch}..${branch}`)
if (ahead !== '0') {
  await git(canonical, 'push', '-u', 'origin', branch)
  if (opts.pr) {
    const url = await execa('gh', ['pr', 'create', '--head', branch,
      '--title', ticket.title, '--body', body], { cwd: canonical }).then(r => r.stdout.trim())
    prUrls.push(url)
  }
}
```
PR body = agent summary + `Closes ticket #<id> (tada)`. No AI attribution lines. `gh` failures are caught and journaled as `error` events but do not fail the run (commits are safe; spec: push/PR failures non-fatal to the work).

`runner.ts` implements the flow above; timeout via `AbortSignal.timeout(timeoutMs)` combined with a manual controller (`AbortSignal.any`); every transition guarded by `canTransitionRun`/`canMoveCard(…)` with an assertion that throws on violation (bug guard, not runtime input).

- [ ] **Step 5: Run tests, verify PASS**; lint + typecheck

- [ ] **Step 6: Commit** — `git commit -m "feat(server): run executor with outcome-based completion, push and PR"`

---

### Task 11: Scheduler + crash recovery

**Files:**
- Create: `apps/server/src/runs/scheduler.ts`
- Test: `apps/server/test/scheduler.test.ts`

**Interfaces:**
- Consumes: `RunnerDeps`, `executeRun`, db.
- Produces:
```ts
export class Scheduler {
  constructor(deps: RunnerDeps)
  /** Called on boot: any run stuck in 'queued'/'running' -> 'failed', card back to ready (held), worktrees left in place. */
  recover(): void
  /** Enqueue: create AgentRun (status 'queued', fresh runToken via randomBytes(24).toString('hex')), set queueState 'queued'. */
  enqueue(ticketId: number, opts?: { adapter?: string; model?: string }): number
  /** Kick the loop: for each workspace, while active runs < concurrency, pick the queued ticket in Ready with lowest position and start executeRun (fire-and-forget with .finally(() => this.tick())). */
  tick(): void
  cancel(runId: number): void   // abort signal -> run 'cancelled', card back to ready (held: null)
}
```
Adapter/model resolution: ticket override ?? workspace default. Unknown adapter name ⇒ enqueue throws.

- [ ] **Step 1: Write failing tests**

With FakeAdapter whose `act` awaits a manually-resolved promise (test controls run duration):
1. Two tickets queued in Ready, concurrency 1 → second run starts only after first resolves; order follows `position`, not enqueue time.
2. Concurrency 2 → both run simultaneously.
3. Two workspaces, one busy → the other's ticket still starts (independence).
4. Held tickets (`queueState: 'held'`) are never picked.
5. `recover()` on a db seeded with a `running` run → run `failed`, ticket back in Ready held.
6. `cancel` mid-run → status `cancelled`, adapter's signal aborted.

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

Single-process, so the scheduler is plain in-memory bookkeeping over the db: `tick()` queries active-run counts per workspace (`agentRuns` join `tickets` where status in queued/running… actually track `running` set in a `Map<number, AbortController>` keyed by runId, count per workspace from db), picks candidates with one SQL query ordered by `tickets.position`, and calls `executeRun`. `enqueue` calls `tick()` itself. No timers needed — every run completion re-ticks.

- [ ] **Step 4: Run tests, verify PASS**; lint + typecheck

- [ ] **Step 5: Commit** — `git commit -m "feat(server): sequential per-workspace scheduler with crash recovery and cancel"`

---

### Task 12: REST API + WebSocket events

**Files:**
- Create: `apps/server/src/routes/workspaces.ts`, `apps/server/src/routes/tickets.ts`, `apps/server/src/routes/runs.ts`, `apps/server/src/routes/memory.ts`, `apps/server/src/ws.ts`
- Modify: `apps/server/src/app.ts` (register routes + ws), `apps/server/src/index.ts` (main: config → db → recover → listen)
- Test: `apps/server/test/api.test.ts`

**Interfaces:**
- Consumes: all prior modules. All bodies zod-validated; invalid → 400.
- Produces (all under bearer auth):
```
GET    /workspaces                        list + running/needs_review counts
POST   /workspaces                        { name } -> create (manager + default columns)
GET    /workspaces/:id                    detail incl. manifest repos + settings
PATCH  /workspaces/:id                    settings: defaultAdapter/defaultModel/concurrency/timeoutMs
POST   /workspaces/:id/repos              { url } -> addRepo
DELETE /workspaces/:id/repos/:name        removeRepo
GET    /workspaces/:id/board              columns with ordered tickets (board payload)
GET    /workspaces/:id/memory             { agentsMd, notes: [{name, body}] }
PUT    /workspaces/:id/memory/:file       write AGENTS.md or a note (path-traversal-guarded: basename only)
POST   /tickets                           { workspaceId, title, description }
PATCH  /tickets/:id                       edit title/description (409 if an active run exists), adapter/model override
POST   /tickets/:id/move                  { columnId, position } — human move; validated by canMoveCard;
                                          landing in Ready => scheduler.enqueue (clears 'held'); leaving Ready => dequeue;
                                          landing in Done => cancel-noop + cleanupRunDir for that ticket's runs
POST   /tickets/:id/comments              { body } (author human)
GET    /tickets/:id                       ticket + comments + runs
GET    /runs/:id/events?after=<eventId>   journaled events (poll fallback)
GET    /runs/:id/transcript               raw JSONL
POST   /runs/:id/cancel                   scheduler.cancel
POST   /push-tokens                       { token } register Expo push token
GET    /ws                                websocket; server pushes { type: 'run_event' | 'board_changed', ... } per workspace
```
- `ws.ts` produces `broadcast(runId, event)` + `boardChanged(workspaceId)` — the `BroadcastFn` consumed by Journal/RunnerDeps.

- [ ] **Step 1: Write failing e2e test (the big one)**

One test that walks the whole loop over HTTP with FakeAdapter (success script that comments via direct db insert in `act` + reports outcome) and `pr: false`:
create workspace → add repo (fixture origin) → create ticket → move to Ready → poll `GET /tickets/:id` until run `needs_review` → assert: ticket in In Review, agent comment present, summary stored, origin has `ticket/<id>` branch → move to Done → assert worktree gone. Plus small route tests: 401 without token, 400 on bad body, human move into In Progress rejected (403), PATCH ticket during active run → 409, memory PUT rejects `../evil`.

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement** routes as thin handlers over managers/scheduler/db; no business logic in routes (logic lives in the modules already built). `index.ts` main wires: `loadConfig → openDb(join(dataDir(),'tada.db')) → WorkspaceManager → adapters map ({ claude: … } added Task 13; from env `TADA_FAKE_ADAPTER=1` register FakeAdapter for manual testing) → Scheduler → recover() → buildApp → listen`.

- [ ] **Step 4: Run tests, verify PASS**; lint + typecheck

- [ ] **Step 5: Commit** — `git commit -m "feat(server): rest api, websocket events, board move semantics"`

---

### Task 13: Claude adapter

**Files:**
- Create: `apps/server/src/adapters/claude.ts`
- Test: `apps/server/test/claudeAdapter.it.test.ts` (integration, skipped unless `TADA_IT=1`)

**Interfaces:**
- Consumes: `Adapter`, `RunContext`.
- Produces: `class ClaudeAdapter implements Adapter` with `name: 'claude'`, `models: ['sonnet', 'opus', 'haiku']`.

- [ ] **Step 1: Add dep** — `pnpm --filter @tada/server add @anthropic-ai/claude-agent-sdk`

- [ ] **Step 2: Check current SDK docs** — run `npx ctx7@latest library "Claude Agent SDK" "run headless agent with mcp http server, bypass permissions, model option"` and follow with `docs` on the best match. Verify: option names for cwd, model, permission bypass, HTTP MCP server config, and abort support. Adjust Step 3's code to what the docs say — the snippet below is the expected shape, not gospel.

- [ ] **Step 3: Implement**

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Adapter, RunContext } from './types.js'

export class ClaudeAdapter implements Adapter {
  readonly name = 'claude'
  readonly models = ['sonnet', 'opus', 'haiku'] as const
  async run(ctx: RunContext): Promise<{ exitCode: number }> {
    const q = query({
      prompt: ctx.prompt,
      options: {
        cwd: ctx.runDir,
        model: ctx.model,
        permissionMode: 'bypassPermissions',
        abortController: abortControllerFrom(ctx.signal),
        mcpServers: {
          tada: { type: 'http', url: ctx.mcp.url, headers: { Authorization: `Bearer ${ctx.mcp.token}` } },
        },
      },
    })
    for (await const msg of q) ctx.onEvent(toAdapterEvent(msg)) // map SDK message types -> status/tool_use/text/error
    return { exitCode: 0 }
  }
}
```
`toAdapterEvent`: assistant text → `text`; tool use blocks → `tool_use` with `{name, inputPreview}` (inputs truncated to 500 chars); result/error messages → `status`/`error`. SDK errors reject → runner marks run failed (already handled).

- [ ] **Step 4: Write the gated integration test**

`describe.skipIf(!process.env.TADA_IT)` — real workspace fixture, ticket "Create a file named hello.txt containing 'hello tada', commit it, then report success via report_outcome", run through `executeRun` with ClaudeAdapter (model `haiku`), assert commit exists on the ticket branch and outcome summary stored. Document in the test header: requires `claude` login on this machine; consumes Max quota; run manually.

- [ ] **Step 5: Verify** — `pnpm lint && pnpm typecheck && pnpm test` (unit suite green without TADA_IT). Run the integration test once manually: `TADA_IT=1 pnpm --filter @tada/server exec vitest run test/claudeAdapter.it.test.ts` — expected PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(server): claude adapter via agent sdk with gated integration test"`

---

### Task 14: Push notifications

**Files:**
- Create: `apps/server/src/notify.ts`
- Modify: `apps/server/src/runs/runner.ts` (call notify on terminal states)
- Test: `apps/server/test/notify.test.ts`

**Interfaces:**
- Produces: `notifyRunFinished(db, run: {id, status, summary}, ticket: {id, title}, fetchImpl?: typeof fetch): Promise<void>` — POSTs to `https://exp.host/--/api/v2/push/send` one message per registered `pushTokens` row: title `Ticket "<title>" ready for review` (needs_review) or `Ticket "<title>" failed` (failed), body = summary first 150 chars, `data: { ticketId }` for deep-linking. Fires only for `needs_review` and `failed`. Errors logged, never thrown (notification failure must not affect run state).

- [ ] **Step 1: Write failing tests** — inject a fake `fetchImpl` capturing calls: correct payload per token; no tokens → no call; `cancelled` status → no call; fetch rejection swallowed.

- [ ] **Step 2: Run, verify FAIL** → **Step 3: Implement** (plain `fetch`, chunk tokens 100/request per Expo API) → **Step 4: verify PASS**; lint + typecheck

- [ ] **Step 5: Commit** — `git commit -m "feat(server): expo push notifications on run completion and failure"`

---

### Task 15: Deployment + docs

**Files:**
- Create: `deploy/tada-server.service`, `README.md`
- Modify: `apps/server/package.json` (add `"start": "node --experimental-strip-types src/index.ts"` or a `tsx` start script; pick one and use it in the unit)

**Interfaces:** none downstream — operational deliverable.

- [ ] **Step 1: Write the systemd unit**

```ini
[Unit]
Description=tada server
After=network-online.target

[Service]
Type=simple
User=tada
ExecStart=/usr/bin/env pnpm --dir /opt/tada start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Write README** covering: what tada is (2 paragraphs from the spec), server install (node 22, pnpm, `claude login` + `gh auth login` as the `tada` user, enable unit), where data/config/state live (XDG table), how auth works (bearer token from `config.json`), how to run tests, how to run the gated Claude integration test, and the security posture section copied faithfully from the spec (dedicated user/VM, scoped credentials, prompt-injection caveat).

- [ ] **Step 3: Verify** — `pnpm lint && pnpm typecheck && pnpm test` all green; `pnpm --filter @tada/server start` boots against a scratch `TADA_*` env and `GET /health` returns ok.

- [ ] **Step 4: Commit** — `git commit -m "chore: systemd unit and readme"`

---

## Self-review notes

- **Spec coverage:** board/queue semantics (T2, T11, T12), XDG layout (T4), worktrees + send-back reuse + branch-survives-cleanup (T5), memory scoping + prompt injection of charter/notes (T4, T7), outcome-based completion + PR-only-when-commits (T9, T10), MCP ticket tools incl. report_outcome (T9), sequential scheduler + independence + held-after-failure + never-auto-retry (T10, T11), crash recovery with preserved worktrees (T11), cleanup on Done (T12), auth posture (T8), Claude via Max login (T13), push notifications for exactly two events (T14), FakeAdapter e2e with zero tokens (T6, T12), systemd + retention docs (T15). Expo client: deliberately out of scope — next plan.
- **Known deferred items (documented, not placeholders):** transcript retention setting (default forever needs no code), "paused until Max window resets", container isolation, multi-agent compare — all spec-listed as out of scope for v1.
