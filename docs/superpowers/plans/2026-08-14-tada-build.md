# tada-build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app match `docs/design/tada-build.dc.html` exactly — seven Instrument Ink screens, fully functional — with the backend features they require.

**Architecture:** Fastify + drizzle/SQLite server grows accept/send-back/nudge/proposal/memory-provenance/activity/discovery features; the Expo app (already carrying Instrument Ink tokens) is rebuilt screen-by-screen, responsive: ≥1000px renders the web rail layout, narrower renders the mobile artboards. Shared DTOs in `packages/shared` are the contract between the two.

**Tech Stack:** Fastify 5, drizzle-orm + better-sqlite3, zod 4, @anthropic-ai/claude-agent-sdk (streaming input), execa; Expo SDK 57 / RN 0.86 / expo-router / TanStack Query v5 / react-native-web; vitest (server), jest-expo (client).

**Spec:** `docs/superpowers/specs/2026-08-14-tada-build-design.md` — read it first. Design source of truth: `docs/design/tada-build.dc.html` (open it; every pixel decision is in its inline styles) and `docs/design/instrument-ink-readme.md` (content + interaction rules).

## Global Constraints

- **No backwards compatibility.** Delete obsolete code/endpoints/DTO fields/screens/tests. No shims, no deprecated fields. The SQLite DB is disposable — rewrite migrations from scratch (delete `apps/server/drizzle/` and regenerate one fresh migration).
- **Instrument Ink content rules** (readme is law): sentence case UI, agent voice lowercase mono, no emoji/exclamations, numbers/ids/paths always mono, relative lowercase timestamps, `·` separators, red only for failure. The only celebration is the tada★ on accept.
- Accept = ticket moves to Done, nothing merges. Copy near accept reads as closing the ticket (spec Decision 2).
- Commits: conventional commits (`feat:`, `fix:`, `test:`, `docs:`). **Never add AI attribution (no Co-Authored-By: Claude, no "Generated with" lines).** Repo is jj-colocated — commit with `jj commit -m '...'` (working copy auto-tracks; no staging).
- Commands: server tests `pnpm --filter @tada/server test`, client tests `pnpm --filter @tada/mobile test`, typecheck `pnpm -r typecheck`, lint `pnpm lint`. Run from repo root.
- Client tests must not depend on theme values; render screens bare (ThemeProvider fallback works). Keep existing `testID` conventions (see existing suites in `apps/mobile/test/`).
- TypeScript strict; follow existing file/naming patterns in each package.

---

### Task 1: Shared contracts rewrite (`packages/shared`)

**Files:**
- Modify: `packages/shared/src/api.ts` (rewrite), `packages/shared/src/domain.ts`
- Delete: `packages/shared/src/api.js`, `packages/shared/src/domain.js`, `packages/shared/src/stateMachine.js` (stale compiled leftovers)
- Test: `packages/shared/test/stateMachine.test.ts` (unchanged; just verify still passes)

**Interfaces (Produces — every later task consumes these exact names):**

```ts
// domain.ts additions
export type Effort = string; // adapter-defined; claude uses 'low' | 'medium' | 'high'
export type TicketOrigin = 'human' | 'agent';
export type ProposalState = 'pending' | null;
export type CommentKind = 'note' | 'feedback' | 'nudge';
export type MemoryScope = 'global' | 'workspace';
export type NoteState = 'kept' | 'pending';
export type SourceType = 'repo' | 'folder';
export type ActivityType =
  | 'run_started' | 'needs_review' | 'run_failed' | 'accepted' | 'sent_back'
  | 'follow_up_filed' | 'memory_written' | 'note_kept' | 'note_discarded' | 'ticket_created';
```

```ts
// api.ts — full rewrite (dates are ISO strings, ids integers)
export interface ApiWorkspace { id: number; name: string; defaultAdapter: string; defaultModel: string; defaultEffort: string; concurrency: number; timeoutMs: number; createdAt: string; }
export interface ApiWorkspaceListItem extends ApiWorkspace { runningCount: number; needsReviewCount: number; queuedCount: number; sourceCount: number; }
export interface ApiSource { type: SourceType; name: string; url?: string; defaultBranch?: string; path?: string; }
export interface ApiWorkspaceDetail extends ApiWorkspace { sources: ApiSource[]; }
export interface ApiColumn { id: number; workspaceId: number; kind: ColumnKind; title: string; position: number; }
export interface ApiTicket { id: number; workspaceId: number; columnId: number; title: string; description: string; position: number; queueState: QueueState; adapterOverride: string | null; modelOverride: string | null; effortOverride: string | null; origin: TicketOrigin; proposalState: ProposalState; followUpOfTicketId: number | null; createdAt: string; }
export interface ApiComment { id: number; ticketId: number; author: 'human' | 'agent'; kind: CommentKind; body: string; createdAt: string; }
export interface ApiRun { id: number; ticketId: number; adapter: string; model: string; effort: string; attemptNumber: number; status: RunStatus; branch: string | null; prUrl: string | null; summary: string | null; diffAdditions: number | null; diffDeletions: number | null; testsPassed: number | null; startedAt: string | null; finishedAt: string | null; createdAt: string; }
export interface ApiRunDetail extends ApiRun { ticketTitle: string; workspaceId: number; }
export interface ApiTicketDetail extends ApiTicket { comments: ApiComment[]; runs: ApiRun[]; followUps: { id: number; title: string; proposalState: ProposalState }[]; }
export interface ApiBoard { columns: (ApiColumn & { tickets: ApiTicket[] })[]; }
export interface ApiActivity { id: number; workspaceId: number; ticketId: number | null; runId: number | null; type: ActivityType; ticketTitle: string | null; message: string; createdAt: string; }
export interface ApiMemoryNote { id: number; scope: MemoryScope; workspaceId: number | null; file: string; title: string; author: 'human' | 'agent'; runId: number | null; state: NoteState; body: string; updatedAt: string; }
export interface ApiMemory { agentsMd: string; notes: ApiMemoryNote[]; }
export interface ApiAdapterInfo { id: string; label: string; available: boolean; models: string[]; efforts: string[]; supportsInjection: boolean; }
export interface ApiHealth { ok: true; version: string; }
export interface ApiStatus { ok: true; version: string; workspaces: string[]; agents: { id: string; available: boolean }[]; }
export interface ApiRunEvent { id: number; runId: number; type: string; payload: unknown; createdAt: string; }
export interface ApiKnownRepo { url: string; name: string; }
export interface ApiNameCheck { id: string; available: boolean; }
export type WsMessage =
  | { type: 'run_event'; runId: number; event: { type: string; payload: unknown } }
  | { type: 'board_changed'; workspaceId: number }
  | { type: 'activity'; workspaceId: number };
```

- [ ] Write the new `domain.ts`/`api.ts`, delete the three stale `.js` files
- [ ] `pnpm --filter @tada/shared test` and `pnpm --filter @tada/shared typecheck` pass (server/mobile will break until later tasks — that's expected; do NOT run repo-wide typecheck here)
- [ ] Commit: `feat(shared): rewrite DTOs for the tada-build feature set`

### Task 2: Server schema + scaffolding rewrite

**Files:**
- Modify: `apps/server/src/db/schema.ts`, `apps/server/src/db/index.ts`
- Delete + regenerate: `apps/server/drizzle/` (one fresh migration via `pnpm --filter @tada/server exec drizzle-kit generate`)
- Test: extend `apps/server/test/db.test.ts`

**Interfaces (Produces):** drizzle tables — `workspaces` + `defaultEffort` (text, default `'medium'`); `tickets` + `origin` (text, default `'human'`), `proposalState` (text, nullable), `followUpOfTicketId` (int FK tickets.id, on delete set null); `comments` + `kind` (text, default `'note'`); `agentRuns` + `attemptNumber` (int, default 1), `effort` (text, default `'medium'`), `diffAdditions`/`diffDeletions`/`testsPassed` (int, nullable); index `events_run_id_idx` on `events.runId`; new tables:

```ts
export const activity = sqliteTable('activity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  ticketId: integer('ticket_id'),
  runId: integer('run_id'),
  type: text('type').notNull(),
  message: text('message').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
export const memoryNotes = sqliteTable('memory_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scope: text('scope').notNull(), // 'global' | 'workspace'
  workspaceId: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  title: text('title').notNull(),
  author: text('author').notNull().default('human'),
  runId: integer('run_id'),
  state: text('state').notNull().default('kept'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => [uniqueIndex('memory_notes_scope_ws_file').on(t.scope, t.workspaceId, t.file)]);
```

Also in `db/index.ts`: `createDefaultColumns` seeds titles `Backlog / Queued / Running / In review / Done` (kinds unchanged: `backlog|ready|in_progress|in_review|done`).

- [ ] Rewrite schema, delete `apps/server/drizzle/`, regenerate one migration, update `createDefaultColumns`
- [ ] Test: fresh DB boots, seeded column titles match the five above, new tables/columns queryable
- [ ] `pnpm --filter @tada/server test` — fix any suite broken purely by schema/titles (e.g. seeded-title assertions); leave feature suites for their tasks
- [ ] Commit: `feat(server): rewrite schema for activity, memory provenance, proposals, effort`

### Task 3: Sources rework (repo + folder), known repos, name check

**Files:**
- Modify: `apps/server/src/workspaces/manager.ts`, `apps/server/src/routes/workspaces.ts`, `apps/server/src/runs/runDir.ts`
- Test: `apps/server/test/workspaces.test.ts`, `apps/server/test/runDir.test.ts`, `apps/server/test/api.test.ts`

**Interfaces:** Manifest becomes `{ sources: Array<{type:'repo', name, url, defaultBranch} | {type:'folder', name, path}> }`. Manager methods: `addRepoSource(wsId, url)`, `addFolderSource(wsId, path)` (name = basename; reject non-absolute or missing paths), `removeSource(wsId, name)`, `listSources(wsId): ApiSource[]`, `knownRepos(): ApiKnownRepo[]` (union across workspaces, deduped by url). Routes: `POST /workspaces/:id/sources` (body `{type:'repo', url}` | `{type:'folder', path}` → 201), `DELETE /workspaces/:id/sources/:name`, `GET /repos/known`, `GET /workspaces/check-name?name=` → `{ id, available }` where `id` = lowercased, spaces→`-`, stripped to `[a-z0-9-]`. **Delete** `POST /workspaces/:id/repos` and `DELETE /workspaces/:id/repos/:name`. `GET /workspaces/:id` returns `sources` (was `repos`); list items gain `queuedCount` + `sourceCount`. `buildRunDir` symlinks folder sources into the run dir by name (repos keep worktree behavior).

- [ ] Tests first: folder source add/remove + validation (400 on relative path), known-repos union, check-name (`Acme Web` → `acme-web`, taken name → `available:false`), run dir contains folder symlink, old `/repos` routes 404
- [ ] Implement; migrate nothing (old manifests are dead data — fresh format only)
- [ ] `pnpm --filter @tada/server test` passes
- [ ] Commit: `feat(server): tagged sources with folder support, known repos, name check`

### Task 4: Memory rework — global scope, provenance, keep/discard

**Files:**
- Modify: `apps/server/src/paths.ts` (add `globalMemoryDir()`), `apps/server/src/routes/memory.ts` (rewrite), `apps/server/src/mcp/server.ts`, `apps/server/src/runs/{runDir,prompt}.ts`
- Test: `apps/server/test/{memory,api,mcp,prompt,runDir}.test.ts` (add `memory.test.ts` if routes lack one)

**Interfaces:** Global memory at `dataDir()/memory/global/` (`AGENTS.md`, `notes/*.md`). Routes: `GET /memory`, `PUT /memory/:file`, `DELETE /memory/:file`, `GET /workspaces/:id/memory`, `PUT /workspaces/:id/memory/:file`, `DELETE /workspaces/:id/memory/:file` — GET returns `ApiMemory` (notes joined with `memory_notes` rows; body from file; `title` = first `# ` heading else filename sans `.md`). Human PUT upserts metadata (`author:'human'`, `state:'kept'`). `POST /memory-notes/:id/keep` / `POST /memory-notes/:id/discard` (discard unlinks the file, deletes the row; both 404 unless `state==='pending'`; both write activity rows — activity table insert is a plain helper `recordActivity(db, {...})` in a new `apps/server/src/activity.ts`, full endpoint comes in Task 6). New MCP tool `write_memory_note({title, body})`: slugified title → `notes/<slug>.md` in the run's workspace memory, metadata row (`author:'agent'`, `state:'pending'`, `runId`), activity `memory_written`. `buildRunDir` symlinks global memory as `memory-global` beside `memory`. `composePrompt`: adds `## Global memory` section (AGENTS.md verbatim + note filenames), replaces the write-files-directly instruction with "use the write_memory_note tool to save durable learnings".

**Consumes:** Task 2 tables.

- [ ] Tests first: global GET/PUT round-trip; agent tool creates pending note + file; keep/discard transitions (+file deletion, 404 on non-pending); prompt contains both memory sections + tool instruction and NOT the old direct-write line; run dir has `memory-global` symlink
- [ ] Implement (rewrite `routes/memory.ts`; delete the old body wholesale)
- [ ] `pnpm --filter @tada/server test` passes
- [ ] Commit: `feat(server): global memory scope, note provenance, keep/discard, write_memory_note tool`

### Task 5: Ticket flows — accept, send-back, proposals, attempts, GET /runs/:id

**Files:**
- Modify: `apps/server/src/routes/tickets.ts`, `apps/server/src/routes/runs.ts`, `apps/server/src/mcp/server.ts`, `apps/server/src/runs/{scheduler,prompt}.ts`
- Test: `apps/server/test/{api,scheduler,prompt,mcp}.test.ts`

**Interfaces:**
- `POST /tickets/:id/accept` → 409 unless the ticket's column kind is `in_review`; moves to Done column (existing cleanup path), writes activity `accepted`, returns `ApiTicket`.
- `POST /tickets/:id/send-back { feedback: string (min 1) }` → 409 unless `in_review`; inserts comment (`author:'human'`, `kind:'feedback'`), moves to the `ready` column end, `scheduler.enqueue`, activity `sent_back`, returns `ApiTicket`.
- `composePrompt`: when the latest human `feedback` comment postdates the previous attempt, render it as the FIRST section after the title: `## Your feedback on attempt N\n\n<verbatim>`; `nudge`-kind comments render in Discussion labeled `(nudge during attempt N)`.
- MCP tool `propose_ticket({title, description?})` → ticket in Backlog, `origin:'agent'`, `proposalState:'pending'`, `followUpOfTicketId` = run's ticket, activity `follow_up_filed`; returns ticket id. Pending proposals are excluded from scheduler candidates and cannot be moved to Ready (403).
- `POST /tickets/:id/proposal { action: 'keep' | 'dismiss' }` → keep: sets `proposalState=null`, returns the ticket; dismiss: deletes the ticket, returns 204. Neither writes activity (the feed already carries `follow_up_filed`). 404 unless `proposalState==='pending'`.
- `GET /tickets/:id` returns `ApiTicketDetail` (adds `followUps`: tickets whose `followUpOfTicketId` = this id).
- `GET /runs/:id` → `ApiRunDetail` (join ticket title + workspaceId).
- `scheduler.enqueue` sets `attemptNumber = 1 + count(prior runs for ticket)` and resolves `effort` (`opts ?? ticket.effortOverride ?? workspace.defaultEffort`); `PATCH /tickets/:id` accepts `effortOverride`.
- Human ticket creation writes activity `ticket_created`.

**Consumes:** `recordActivity` from Task 4; Task 2 columns.

- [ ] Tests first (accept 409/success + Done placement; send-back inserts feedback comment + re-enqueues + prompt renders it first; propose_ticket → pending backlog ticket + 403 on move-to-ready; proposal keep/dismiss; attempt numbering across three runs; GET /runs/:id shape; effortOverride PATCH)
- [ ] Implement
- [ ] `pnpm --filter @tada/server test` passes
- [ ] Commit: `feat(server): accept, send-back, agent proposals, attempt numbers, run detail`

### Task 6: Activity feed + WS

**Files:**
- Modify: `apps/server/src/activity.ts` (add route registration or new `apps/server/src/routes/activity.ts`), `apps/server/src/runs/runner.ts`, `apps/server/src/ws.ts`, `apps/server/src/app.ts`
- Test: `apps/server/test/activity.test.ts` (new), `apps/server/test/runner.test.ts`

**Interfaces:** `recordActivity` broadcasts `{type:'activity', workspaceId}` on the hub. Runner writes `run_started` (on start), `needs_review` / `run_failed` (on completion; failure message includes plain reason, e.g. `timed out at 30m`). `GET /activity?workspaceId=<id>&limit=<n=50>` → `ApiActivity[]` newest-first with `ticketTitle` joined; omit `workspaceId` for all workspaces.

- [ ] Tests first: endpoint ordering/joins/limit; runner writes start + review/fail rows; WS receives `activity` message
- [ ] Implement
- [ ] `pnpm --filter @tada/server test` passes
- [ ] Commit: `feat(server): activity feed with live broadcast`

### Task 7: Adapters — interface, streaming Claude + nudge, Codex/Gemini, discovery, status

**Files:**
- Modify: `apps/server/src/adapters/{types,claude,fake}.ts`, `apps/server/src/adapters/registry` (wherever the registry lives — follow current wiring in `app.ts`), `apps/server/src/runs/{runner,scheduler}.ts`, `apps/server/src/routes/runs.ts`, `apps/server/src/app.ts`, `apps/server/src/config.ts`
- Create: `apps/server/src/adapters/codex.ts`, `apps/server/src/adapters/gemini.ts`, `apps/server/src/version.ts` (reads server package.json version)
- Test: `apps/server/test/{adapters.test.ts (new), runner, api, app}.test.ts`

**Interfaces:**

```ts
export interface AdapterStartCtx { prompt: string; runDir: string; model: string; effort: string; mcpUrl: string; runToken: string; signal: AbortSignal; journal: Journal; }
export interface AdapterSession { done: Promise<AdapterResult>; inject(note: string): boolean; } // inject returns false when unsupported
export interface Adapter {
  id: string; label: string; models: string[]; efforts: string[]; supportsInjection: boolean;
  available(): Promise<boolean>;
  start(ctx: AdapterStartCtx): AdapterSession;
}
```

- `ClaudeAdapter`: streaming-input `query()` (async generator fed from an in-memory queue); `inject(note)` pushes a user message (`the user says: <note>`) between turns → returns true. Effort → `maxThinkingTokens`: low `1024`, medium adapter default (omit), high `32768`. `available()`: SDK importable + `claude` auth present (probe cheaply; a failed probe just returns false). Models `['sonnet','opus','haiku']`, efforts `['low','medium','high']`, label `Claude`.
- `CodexAdapter` (`codex`, label `Codex`): `execa('codex', ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', prompt], {cwd: runDir})`; journal stdout JSON lines as `text` events (fall back to raw lines). `GeminiAdapter` (`gemini`, label `Gemini`): `execa('gemini', ['-p', prompt, '--yolo'], {cwd: runDir})`, journal stdout lines. Both: `supportsInjection:false` (`inject` → false), `available()` = CLI on PATH (`execa(cmd, ['--version'])` succeeds, cached). Models: codex `['gpt-5.2-codex','gpt-5.2']` efforts `['low','medium','high']`; gemini `['gemini-3-pro','gemini-3-flash']` efforts `['default']`. Since they can't call MCP tools reliably, their prompt (adapter-side wrapper, not `composePrompt`) appends: write `scratch/outcome.json` `{"status":"success"|"failed","summary":"...","testsPassed"?:n}`; the runner, when MCP `pendingOutcome` is empty, reads that file for the outcome.
- Registry: always register all three (+Fake behind `TADA_FAKE_ADAPTER`); scheduling a run on an unavailable adapter fails the run with a journaled `adapter not available on this server` error.
- Runner: holds the `AdapterSession`; scheduler `active` map gains `session`. `POST /runs/:id/nudge { note }` → 404 unless run `running`; inserts ticket comment (`kind:'nudge'`); calls `session.inject(note)`; responds `{ delivered: boolean }`.
- `report_outcome` MCP tool gains optional `testsPassed: number`.
- `GET /adapters` → `ApiAdapterInfo[]`. `GET /status` (authed) → `ApiStatus`. `GET /health` → `{ ok: true, version }` from `version.ts`.

**Consumes:** Task 5 scheduler effort plumbing.

- [ ] Tests first: adapter registry/discovery endpoint shapes (mock availability); nudge delivered=true via FakeAdapter (give Fake an inject that records notes), delivered=false path; outcome-file fallback parsing; health/status version fields; effort reaches the adapter ctx
- [ ] Implement (consult claude-agent-sdk docs for streaming input via ctx7 `library "Claude Agent SDK"` if needed; keep CLI arg details encapsulated per adapter so they're one-file fixes)
- [ ] `pnpm --filter @tada/server test` passes
- [ ] Commit: `feat(server): adapter discovery, streaming claude with nudge, codex and gemini adapters`

### Task 8: Diffstat on completion

**Files:**
- Modify: `apps/server/src/runs/completion.ts`, `apps/server/src/runs/runner.ts`
- Test: `apps/server/test/completion.test.ts`

**Interfaces:** After a successful run, for each repo source with a `ticket/<id>` branch ahead of default: `git diff --shortstat <defaultBranch>...<branch>` → parse insertions/deletions, sum across repos, store `diffAdditions`/`diffDeletions` on the run row. `testsPassed` comes from the outcome (`report_outcome` arg or outcome.json) and is stored alongside. Parse failure → nulls, journaled, never fatal.

- [ ] Tests first (git fixture with known diff; multi-repo summing; no-branch → nulls)
- [ ] Implement; `pnpm --filter @tada/server test` passes
- [ ] Commit: `feat(server): per-attempt diffstat and reported test counts`

### Task 9: Client foundation — API client, queries, layout frame, primitives

**Files:**
- Modify: `apps/mobile/src/api/client.ts`, `apps/mobile/src/api/queries.ts`, `apps/mobile/src/settings.ts` (persist `activeWorkspaceId`)
- Delete: `apps/mobile/src/adapters.ts` (hardcoded mirror — server discovery replaces it)
- Create: `apps/mobile/src/layout.ts` (`useLayout(): {wide: boolean}` — `useWindowDimensions().width >= 1000`), `apps/mobile/src/components/ui/{Rail.tsx, BottomStrip.tsx, Menu.tsx, RunStatusChip.tsx, Badge.tsx, Stepper.tsx}`, `apps/mobile/src/components/WorkspaceSwitcher.tsx`
- Modify: `apps/mobile/src/components/ui/{AgentPanel.tsx, index.ts}`, `apps/mobile/app/_layout.tsx`
- Test: `apps/mobile/test/{client,layoutFrame,switcher}.test.tsx`

**Interfaces (Produces):**
- `TadaClient` methods (one per server route; deletions too): `accept(ticketId)`, `sendBack(ticketId, feedback)`, `nudge(runId, note)`, `proposal(ticketId, action)`, `run(runId): ApiRunDetail`, `activity(workspaceId?|'all', limit?)`, `adapters(): ApiAdapterInfo[]`, `status(): ApiStatus`, `health(): ApiHealth`, `globalMemory()/putGlobalMemory/deleteGlobalMemory`, `memory(wsId)` etc., `keepNote(id)/discardNote(id)`, `addSource(wsId, body)`, `removeSource(wsId, name)`, `knownRepos()`, `checkName(name)`. Remove `addRepo/removeRepo`, the `?ticketId=` run plumbing.
- Query hooks (`queries.ts`): `useAccept`, `useSendBack`, `useNudge`, `useProposal`, `useRun(runId)`, `useActivity(workspaceId)`, `useAdapters`, `useStatus`, `useGlobalMemory`, `useKeepNote/useDiscardNote`, `useAddSource/useRemoveSource`, `useKnownRepos`, `useCheckName(name)` (debounced), plus keys. `useWorkspaceSocket` also invalidates `keys.activity` on `activity`/`board_changed` messages.
- `useActiveWorkspace()`: persisted id + setter, defaulting to first workspace.
- Primitives (match artboard styles exactly — read the HTML): `Badge` (pill; statuses `accepted`(sage)/`failed`(red)/`live`(orange), lowercase label), `RunStatusChip` (`status: 'live'|'ok'|'neutral'`, dot with `ii-pulse` when live, label + optional mono meta like `12m`), `Menu` (overlay on `--surface-overlay`, `--shadow-overlay`, radius card — powers switcher + dropdown buttons `parlor ▾`, `30 min ▾`, `Sonnet ▾`), `Stepper` (− count + row), `Rail` (188px web sidebar per artboard lines 45-56: wordmark, nav items with count, spacer, scope line, Day mode `Switch`), `BottomStrip` (mobile Control/Board/Memory segmented row, artboard lines 213-217), `AgentPanel` gains optional `header`/`meta` props + collapsible `rawOutput` section (artboard lines 307-320).
- `WorkspaceSwitcher`: Menu listing Scope→Global (memory contexts only), Workspaces with `N repos · M live` meta rows, divider, `+ New workspace`, `⌘K to switch` hint (artboard lines 463-489); opens from any `▾` trigger; on web, ⌘K toggles it (document keydown listener, web only).

- [ ] Tests first: client method → fetch URL/body mapping for every new method; `useLayout` breakpoint; switcher renders workspaces + fires selection; Rail nav fires router pushes
- [ ] Implement; delete `src/adapters.ts` and fix all imports (settings screen temporarily broken is fine — Task 14 rewrites it; keep the tree compiling with minimal stubs, not compat shims)
- [ ] `pnpm --filter @tada/mobile test` passes (screens' existing suites may need touch-ups where client methods changed)
- [ ] Commit: `feat(mobile): client + query layer for new API, responsive frame, switcher, primitives`

### Task 10: Control screen (web + mobile artboards)

**Files:**
- Modify: `apps/mobile/app/workspaces/index.tsx` (full rebuild), `apps/mobile/src/components/{TicketCard? → new ControlCards}.tsx` as needed
- Test: `apps/mobile/test/workspaces.test.tsx` (rebuild)

**Design:** artboard lines 40-220 (`Control web`, `Control mobile`). Wide: Rail + content — headline `Two things need you` (count-driven: `One thing needs you`, `All quiet` at zero) + mono subline from activity (`3 ran overnight · memory grew by one note` — compute: runs finished since local midnight, pending agent notes; keep the format, degrade gracefully to e.g. `nothing ran overnight`); NEEDS YOU cards (badge `your turn`/`failed`, mono stat line `attempt N · pr #481 · +412 −38 · 214 tests pass` — omit missing pieces, `timed out at 30m` for failures from the run row, agent-well with last agent thread comment or summary, actions: needs-review → `Accept run` (useAccept + TadaStar moment) / `Send back` (opens feedback dialog → useSendBack) / `Open diff` (Linking to prUrl); failed → `Re-run` (move to queued column via existing move mutation) / `Edit brief and re-run` (router to ticket) / `Move to backlog`); LIVE NOW cards (title, source Tag, RunStatusChip `live` + elapsed, AgentPanel tail = last two run events rendered as narration, `Full log` → run screen, `Nudge with a note` → dialog → useNudge); slot-free pill (artboard 136-141: shown when any workspace has spare concurrency and a queued ticket — `1 slot free — next: <title>` + `Start now` = move that ticket to front of Queued); right rail: Memory card (first two kept notes one-line + newest pending agent note in agent-well with `· new, by agent`, `Edit memory` → memory screen), Today card (useActivity: `HH:MM` + glyph per type — `✱` ok accept, `+` live follow-up, `✎` live memory, `✕` fail — bold ticket titles inline, `Full history` grows the list), workspace strips (name, `2 queued · 1 live · 2 yours` counts from list DTO, `Board` button). Narrow: mobile artboard (header wordmark + `2 live` chip, headline, needs-you cards with paired 46px buttons, live-now AgentPanel digest `▸ session test · 12m · suite ×20 green` per live run, BottomStrip).

- [ ] Tests first: triage grouping, accept fires POST + tada moment renders, send-back dialog posts feedback, nudge dialog, slot pill logic, activity glyph mapping, narrow/wide swap (mock useWindowDimensions)
- [ ] Implement, matching artboard spacing/typography via existing tokens
- [ ] `pnpm --filter @tada/mobile test` passes
- [ ] Commit: `feat(mobile): control screen per tada-build`

### Task 11: Ticket detail + Live run screens

**Files:**
- Modify: `apps/mobile/app/tickets/[id].tsx`, `apps/mobile/app/runs/[id].tsx` (both rebuilds), `apps/mobile/src/components/{CommentThread,EventFeed,RunRow}.tsx`
- Test: `apps/mobile/test/{ticketDetail,runActivity}.test.tsx`

**Design:** artboard lines 223-328. Ticket: header (`← Control` ghost back, Badge, `attempt N` Tag); title + mono meta (`parlor · parlor-web · created 3d ago by you` — workspace · first repo source · relative created); review card only when in_review (agent well = summary + mono sub `pr #481 · +412 −38 · 214 tests pass`, `Accept run`/`Send back`/`Open pr`, helper copy `On accept the ticket is closed.`); Brief card (`what the agent reads` meta, description body, `Edit brief`); THREAD via CommentThread (feedback comments get a `sent back:` prefix in the user bubble; nudge comments render with a `(nudge)` mono suffix; agent messages relative-timestamped); composer (`Add a note — the agent reads the thread on its next attempt` + `Post`); right rail (wide) / stacked below (narrow): Attempts card (`#2 in review now` ok-text + `pr #481 · ran 34m` (finished−started), earlier attempts muted with send-back quote), Linked card (follow-ups: `FOLLOW-UP` caps live-text, title, `proposed by agent · in backlog`), `Memory it read` card (kept note titles + newest agent note highlighted), `If you send it back` card (verbatim copy from artboard line 284). Run screen: header (`← Control`, title, mono `parlor · parlor-api · attempt N`, Badge `live · 12m` elapsed ticking, `Stop run` danger + confirm); single AgentPanel `run #<id> · attempt <n>` / `live · 12m`: events → narration lines with `HH:MM` stamps (status/text payloads; latest line while running gets pulsing `▮` in live-text; error lines fail-text), RAW OUTPUT collapsible inside panel (transcript tail via existing transcript fetch, `collapse ▾`/`expand ▸`); nudge composer (`Nudge with a note — the agent sees it between steps`, `Send` → useNudge; on `delivered:false` toast `note saved for the next attempt`); footnote `Safe to close — it runs unattended. You'll get a ping when it needs you.`; uses `useRun(runId)` (no more `?ticketId=` param — delete that plumbing here and in push deep links `src/push.ts`).

- [ ] Tests first: review-card actions, thread kinds render, attempts math, run narration + live line, nudge delivered/undelivered toast, stop confirm
- [ ] Implement both screens
- [ ] `pnpm --filter @tada/mobile test` passes
- [ ] Commit: `feat(mobile): ticket detail and live run per tada-build`

### Task 12: Board screen

**Files:**
- Modify: `apps/mobile/app/workspaces/[id]/board.tsx`, `apps/mobile/src/components/{ColumnView,TicketCard}.tsx`
- Test: `apps/mobile/test/board.test.tsx`

**Design:** artboard lines 330-416. Header: `Board` + `parlor ▾` (WorkspaceSwitcher) + `New ticket` primary. Five columns, headers per artboard (mono caps + count; Running header has live StatusDot + live-text; In review has ok StatusDot + ok-text; Done column at 0.68 opacity). Cards: backlog/queued minimal (title 13.5/500 + mono meta `parlor-api · 4d` (first repo · relative age); queued top card meta `next up`; held-retry meta `retry · attempt N` in live-text); proposal card (dashed border raised, `PROPOSED BY AGENT` caps live-text, title, `follow-up of <parent title lowercased>`, `Keep`/`Dismiss` → useProposal); running card (title, `parlor-api · 12m` with live elapsed, one-line agent well (latest event, pulsing `▮`, ellipsized), `Watch live` → run screen); in-review card (Badge, title, `attempt 2 · pr #481 · tests pass` mono, `Accept`/`Send back`); done cards (`pr #468 merged · 1w` / `no pr · ops task · 1w`). `+ Add a ticket` ghost under Backlog only. Keep DnD (long-press lift, fractional positions, 409 toast) and narrow-screen column pager. FlipStrip is gone from the header — delete it here; if nothing else uses `FlipStrip`, delete the component and its tests.

- [ ] Tests first: five headers, proposal keep/dismiss calls, accept/send-back from card, watch-live routing, add-ticket only on backlog, done opacity present
- [ ] Implement
- [ ] `pnpm --filter @tada/mobile test` passes (delete FlipStrip suite if component deleted)
- [ ] Commit: `feat(mobile): board per tada-build with agent proposals`

### Task 13: Memory screens (scoped) 

**Files:**
- Modify: `apps/mobile/app/workspaces/[id]/memory/{index,[file]}.tsx` — plus a global-scope route `apps/mobile/app/memory/index.tsx` (switcher's Global row and rail Memory nav land here or on the active workspace per selection)
- Test: `apps/mobile/test/memory.test.tsx`

**Design:** artboard lines 418-458. Header: `Memory` + `parlor ▾` (switcher with Global row) + `N notes` mono + `New note` primary. Explainer line (`The agent reads every note before a run — and may add its own. Plain text, edit freely.`). Global card (title `Global`, meta `every workspace · 2`, note bodies stacked in mono muted). Scope divider (`PARLOR · 4 NOTES` caps + hairline). Kept note cards (title from note, meta `edited by you · 2w` / `by agent · <rel>`). Pending agent notes render as AgentPanel (`learned: <title>` header, `by agent · 07:58` meta, body with mono `(learned during pr #NNN)` styling as-is) + `Keep`/`Discard` buttons (useKeepNote/useDiscardNote). Editor screen unchanged in behavior (mono editor, unsaved guard) but works for both scopes. AGENTS.md remains the pinned first file per scope.

- [ ] Tests first: scope switching global↔workspace, pending note keep/discard, new-note dialog, editor guard still passes
- [ ] Implement
- [ ] `pnpm --filter @tada/mobile test` passes
- [ ] Commit: `feat(mobile): scoped memory with agent-note review`

### Task 14: Connect, Settings, New workspace

**Files:**
- Modify: `apps/mobile/app/connect.tsx`, `apps/mobile/app/workspaces/[id]/settings.tsx`, the create-workspace dialog (currently in `app/workspaces/index.tsx` — move to `apps/mobile/src/components/NewWorkspaceDialog.tsx`)
- Test: `apps/mobile/test/{connect,workspaceSettings,newWorkspace}.test.tsx`

**Design:** artboard lines 492-541 (New workspace, Connect) and 544-619 (Settings). Connect: force light palette for this screen only (render with day tokens regardless of scheme); 30px wordmark; copy `Tickets in, pull requests out. tada runs against your own server — point it there to begin.`; mono inputs `Server address` / `API token`; full-width `Connect`; on success render checklist from `/health` + `/status`: `✓ server reachable · v<version>`, `✓ N workspaces found — <names>`, `✓ agent keys present on the server` (from any `agents[].available`; if none: `— no agent keys on the server yet` muted, still connects); footer line. Settings: SOURCES (rows: mono name, Tag `repo · github`/`folder · server`, `Remove` ghost + confirm; `Add repo` + `Add folder` secondary — folder prompts for absolute server path); AGENT (Harness row: segmented buttons from `useAdapters` — selected secondary, others ghost, unavailable disabled with hint `not installed on the server`; Model: `Menu` dropdown of selected harness models; Effort: segmented from harness efforts; helper `Model and effort options come from the selected harness.`; changing harness resets model/effort to that harness's first entries via `usePatchWorkspace`); RUN LIMITS (Concurrent runs `Stepper` 1-8; Per-run timeout `Menu` of 10/15/30/60 min → timeoutMs); GLOBAL (Server row: ok StatusDot + mono url + `Disconnect` danger/confirm; API token row: masked `tada_••••••••••<last4>` + `Replace` secondary → dialog with token input → updates stored connection after a `status()` probe). NewWorkspaceDialog: explainer, Name input, live mono check line (`✓ id <slug> · available` ok-text / `✕ id <slug> · taken` fail-text via useCheckName), `ATTACH REPOS — OPTIONAL` checkboxes from `useKnownRepos`, note, `Cancel`/`Create workspace` (create → addSource per checked repo → navigate to its board).

- [ ] Tests first: connect checklist lines incl. version, settings adapters-driven segmented controls + harness switch resets model, token replace flow, sources add-folder, name-check states, create-with-repos calls
- [ ] Implement
- [ ] `pnpm --filter @tada/mobile test` passes
- [ ] Commit: `feat(mobile): connect, settings, new workspace per tada-build`

### Task 15: Sweep — dead code, full verification

**Files:** repo-wide.

- [ ] Delete now-unused exports/components/styles/tests (verify FlipStrip, old adapters mirror, run `?ticketId` plumbing, old repos routes/DTOs are all gone; `git grep` for their names)
- [ ] `pnpm -r typecheck` && `pnpm lint` && `pnpm test` all green
- [ ] Boot server (`TADA_FAKE_ADAPTER=1 pnpm start`) + `pnpm --filter @tada/mobile web`; walk all seven artboards wide + 390px against `docs/design/tada-build.dc.html`; fix visual deltas
- [ ] Commit: `chore: remove code obsoleted by the tada-build redesign`

## Self-review notes

- Spec coverage checked: schema (T2), sources (T3), memory (T4), flows (T5), activity (T6), adapters/nudge/status (T7), diffstat (T8), client foundation (T9), all seven screens (T10-T14), deletion sweep (T15). Accept-copy deviation lives in T11. Board column titles in T2.
- Type names cross-checked against Task 1 DTOs.
