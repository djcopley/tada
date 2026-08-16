# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal kanban app where tickets are tasks for **coding agents**. Tickets are dragged into a
Ready queue; a scheduler on a self-hosted server picks them up, runs an agent (Claude Agent SDK,
codex, gemini) in a git worktree, and reports back on the ticket. Single-user tool. See `README.md`
for install/deploy and `docs/superpowers/specs/` for the design specs that drove the build.

pnpm workspace, Node 22+:

| Package | Path | What |
|---|---|---|
| `@tada/server` | `apps/server` | Fastify REST + WebSocket daemon, SQLite (drizzle), scheduler, agent adapters, MCP server |
| `@tada/mobile` | `apps/mobile` | Expo / React Native app (`tada-app`) — iOS, Android, and web from one codebase |
| `@tada/shared` | `packages/shared` | API response types (`api.ts`), domain enums (`domain.ts`), and the run/card state machine |

## Commands

```sh
pnpm lint          # biome check . && expo lint (mobile)
pnpm format        # biome check --write .
pnpm typecheck     # tsc --noEmit in every package
pnpm test          # vitest (server, shared) + jest (mobile)
pnpm start         # runs the server: tsx apps/server/src/index.ts
```

Single test:

```sh
pnpm --filter @tada/server exec vitest run test/scheduler.test.ts
pnpm --filter @tada/server exec vitest run test/scheduler.test.ts -t 'name of test'
pnpm --filter @tada/mobile exec jest test/board.test.tsx
```

Mobile dev: `pnpm --filter @tada/mobile start` (Expo Go / dev client) or `... web`.

After changing `apps/server/src/db/schema.ts`, regenerate the migration —
`pnpm --filter @tada/server exec drizzle-kit generate` — and commit it. `openDb()` runs
`migrate()` against `apps/server/drizzle` on every boot, so an unregenerated schema change is
invisible at runtime.

**Biome formats/lints everything except `apps/mobile`** (see the `files.includes` exclusion in
`biome.json`); the mobile app uses `eslint-config-expo`. Both follow the same style anyway: single
quotes, no semicolons, 100 columns, 2-space indent.

`apps/server` and `packages/shared` are `NodeNext` ESM TypeScript run straight from source via
`tsx`/vitest — **relative imports must carry a `.js` extension** (`./db/schema.js`). The mobile app
is bundled by Metro and does not. `strict` and `noUncheckedIndexedAccess` are on everywhere.

## Version control

The repo is a **jj (jujutsu) colocated repo** (`.jj/` alongside `.git/`). Prefer jj commands; git
still works against the same store.

## Server architecture

`src/index.ts` wires the whole daemon: `loadConfig()` → `openDb()` → `WorkspaceManager` →
`buildAdapterRegistry()` → `BroadcastHub` → `Scheduler` (`.recover()`) → `buildApp()` → listen.
Everything downstream takes its collaborators by constructor/deps object, which is what lets tests
stand up a real app against a temp SQLite file (`test/helpers/appDeps.ts`).

### The run lifecycle

This is the core of the system; changing it means touching all of these:

1. **Dispatch** — moving a card into Ready (`POST /tickets/:id/move`) sets `queueState: 'queued'`
   and calls `Scheduler.enqueue`, which inserts an `agent_runs` row (status `queued`, a per-run
   `runToken`) resolving adapter/model/effort as `explicit → ticket override → workspace default`.
2. **Scheduling** — `Scheduler.tick()` is timer-free. Active runs live in an in-memory map; queue
   state and ordering are re-read from SQLite on every tick. Per-workspace `concurrency` caps
   in-flight runs; candidates are ordered by `tickets.position` (fractional `real` for cheap
   reorder). Every run completion re-ticks via `.finally`.
3. **Execution** — `runs/runner.ts#executeRun` marks the run running, moves the card
   ready→in_progress, tears down earlier attempts' run dirs, builds a fresh run dir
   (`runs/runDir.ts`: `<stateDir>/runs/<runId>/` with one **git worktree per repo source** on
   branch `ticket/<id>`, plus symlinks to workspace and global memory), composes the prompt
   (`runs/prompt.ts`), and starts the adapter under an `AbortSignal.any` of the workspace timeout,
   a manual controller, and the scheduler's cancel signal.
4. **Outcome** — MCP `report_outcome` is the primary channel; `scratch/outcome.json` is the
   fallback for CLI adapters that can't call tools. No outcome = failure.
5. **Completion** — `runs/completion.ts` pushes each ticket branch that's ahead of its default
   branch and opens a PR via `gh`. Push/PR/diffstat failures are non-fatal and journaled; the run
   still reaches `needs_review` and the card moves in_progress→in_review.

Every transition is guarded by `@tada/shared`'s `canTransitionRun` / `canMoveCard` and **throws**
on an illegal move. Inside `executeRun`, every failure path between "marked running" and a terminal
state must route through the local `markFailed`/`markCancelled` closures — a throw that escapes
leaves the run wedged at `running` with the card stuck in in_progress.

### Adapters

`adapters/types.ts` is the contract: `available()`, `start(ctx) -> { done, inject }`. The registry
(`adapters/registry.ts`) registers *every* adapter regardless of whether its CLI is installed —
`available()` reports false and a run against it fails with a journaled reason rather than
vanishing from the UI. `TADA_FAKE_ADAPTER=1` additionally registers `FakeAdapter`, which is how
tests drive end-to-end flows with zero tokens.

- `claude.ts` — Claude Agent SDK in **streaming-input mode**. `claudeQueue.ts`'s `UserMessageQueue`
  keeps the session alive so `POST /runs/:id/nudge` can inject a mid-run note; it counts injected-
  but-unanswered messages so the session doesn't close underneath a nudge.
- `codex.ts` / `gemini.ts` — one-shot CLIs via `adapters/exec.ts#startCliSession`. They run outside
  the MCP server, so their prompt gets the outcome-file instruction appended and `inject()` always
  declines.

### MCP server

`mcp/server.ts` mounts at `/mcp`, authenticated per-run by the `runToken` (not the global bearer
token — `/mcp` and `/ws` are exempt from the auth hook in `app.ts`). Tools: `update_ticket`,
`attach_link`, `attach_file`, `write_memory_note`, `propose_ticket`, `report_outcome`. The MCP
callback URL handed to adapters is always `127.0.0.1` regardless of the configured bind host.

### Auth, CORS, and WebSocket ordering in `app.ts`

`app.ts` has load-bearing ordering that is easy to break — the auth hook is added inside `.after()`
so it lands *behind* the CORS hook (otherwise preflights 401 before CORS answers them, and the
client reports "could not reach server" instead of "invalid token"), and `registerWsRoute` likewise
runs inside `.after()` so the websocket plugin's `onRoute` hook is installed first. The long
comments there explain why; read them before reordering anything.

### State on disk

Server state is filesystem-first, not database-first. Workspace **sources** (repo clones and
attached folders) live in `manifest.json` on disk — SQLite has no repos table, by design, so the
manifest is the single source of truth for what's actually cloned. Memory is markdown on disk
(`memory/AGENTS.md` + `memory/notes/*.md`, per-workspace and global); the `memory_notes` table only
tracks review state (`kept` / `pending`) and authorship.

Paths come from `src/paths.ts` (XDG with `TADA_DATA_DIR` / `TADA_CONFIG_DIR` / `TADA_STATE_DIR`
overrides). Tests call `isolateXdg()` from `test/helpers/gitFixtures.ts` in `beforeEach` to point
all three at a temp dir and disable commit signing.

### Broadcast

`ws.ts#BroadcastHub` fans events out to sockets subscribed per workspace. It's wired as the run
journal's broadcast hook, so any journaled `status` event also re-emits `board_changed` (runner's
status events are always paired with a card move). Route handlers that mutate the board directly
call `boardChanged` themselves.

## Mobile architecture

expo-router file-based routing under `app/`. Root `_layout.tsx` composes
`GestureHandlerRootView → SafeAreaProvider → ThemeProvider → ConnectionProvider → AppQueryProvider
→ Stack`, plus globally-mounted `WorkspaceSwitcher`, `NewWorkspaceDialog`, and `ToastHost`.

- **Native headers are always hidden.** Every screen draws the shared `AppHeader` itself.
- **`/workspaces` is a Tabs navigator**, not a stack: Control (`index`), `[id]/board`,
  `[id]/memory`, `[id]/settings` slide sideways and never pile up. Ticket and run screens live in
  the root stack and push over the whole group. Navigation helpers are in `src/nav.ts` —
  `goToSection` (plain `navigate`, tabs) vs `goBackOr` (falls back to a replace, because a screen
  opened cold from a push notification has no back stack).
- **Connection gating.** `GuardedStack` / the workspaces layout redirect to `/connect` when no
  connection is stored. A 401 from any query or mutation triggers a global `disconnect()` in
  `AppQueryProvider`, which routing turns into that redirect. Credentials live in
  `expo-secure-store` on native and `localStorage` on web (`src/settings.ts`).
- **Query cache.** All keys are defined in `src/api/queries.ts#keys`; bare-prefix keys are
  deliberate (`['activity']` is a prefix of `['activity', wsId]`, so one invalidation refreshes
  both feeds). `useWorkspaceSocket` opens one WebSocket per mounted workspace and invalidates on
  `board_changed` / `activity`, forwarding `run_event` to the caller. Changing the connection's
  identity `resetQueries()` (not `clear()`) — the comment in `app/_layout.tsx` explains why.
- **Layout.** `src/layout.ts#useLayout` is the single responsive switch: `wide` (≥1000px) gets the
  `Rail` sidebar, narrow gets the `BottomStrip`.
- **Design system.** "Instrument Ink" — `src/design/tokens.ts`. Night (warm brown-black) is the
  primary theme, paper day is opt-in. Two voices: the agent speaks IBM Plex Mono on recessed dark
  ink (the `agent*` tokens are theme-invariant), you speak Instrument Sans on raised surfaces.
  Orange = live, sage = accepted/ok, red = failure only. **No other decorative color exists** —
  never introduce a raw hex literal in a component; add or use a token.
- Screen logic that can be tested without rendering is split into plain modules
  (`src/control.ts`, `src/ticketDetail.ts`, `src/board/positions.ts`, `src/runActivity.ts`).

`jest.config.js` has several non-obvious workarounds (setupFiles must re-include the jest-expo
preset's list, a chained resolver for Reanimated, a `.js`-extension stripper so `@tada/shared`'s
NodeNext source resolves) — each is commented; don't simplify them away.

## Testing

- Server/shared: vitest. Server uses `pool: 'forks'` (each file gets its own process — necessary
  because `isolateXdg()` mutates `process.env`).
- Mobile: jest + `@testing-library/react-native`.
- `pnpm test` consumes **zero LLM tokens**. The one exception is
  `apps/server/test/claudeAdapter.it.test.ts`, gated behind `TADA_IT=1` because it burns real
  Max/API quota — never run it in CI.
- Tests set `pr: false` in `RunnerDeps` (no `gh`/network) and pass `fetchImpl` to stub Expo push.

## Code style

The existing code carries unusually dense "why" comments on the load-bearing bits — plugin
registration order, cache reset semantics, worktree teardown, the nudge queue's turn accounting.
These document non-obvious failure modes that were actually hit. Match that density when touching
subtle code, and don't strip existing ones as noise.
