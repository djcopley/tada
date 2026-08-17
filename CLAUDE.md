# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal kanban app where tickets are tasks for **coding agents**. A ticket is queued; a scheduler
on a self-hosted server runs an agent (Claude Agent SDK, codex, gemini) out of a run directory
with a git worktree per repo the agent touches, and the run files itself as done. Approval happens
**mid-run**: a rule table gates tool calls, and a held run keeps its context, frees its slot, and
resumes when the human decides. Single-user tool. See `README.md` for install/deploy and
`docs/superpowers/specs/` for the design specs that drove the build — the current one is
`2026-08-17-v7-gates-one-board.md`.

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

`src/index.ts` wires the whole daemon: `loadConfig()` → `openDb()` (migrates + seeds the single
`settings` row and the default rule table) → `SourceStore` → `buildAdapterRegistry()` →
`BroadcastHub` → `Scheduler` (`.recover()`) → `buildApp()` → listen. Everything downstream takes
its collaborators by constructor/deps object, which is what lets tests stand up a real app
against a temp SQLite file (`test/helpers/testApp.ts`).

There is **no workspace layer**: one board, one memory list, one rule table, one `settings` row,
one `manifest.json` of sources.

### The run lifecycle

This is the core of the system; changing it means touching all of these:

1. **Dispatch** — a card landing on `queued` (`POST /tickets/:id/move`, or `POST /tickets` with
   `column: 'queued'`) calls `Scheduler.enqueue`, which snapshots settings (adapter/model/effort,
   `budgetMs`) onto a new `agent_runs` row (status `queued`, per-run `runToken`).
2. **Scheduling** — `Scheduler.tick()` is timer-free. Only runs whose status is `running` count
   against `settings.concurrency`; a **held run keeps its process but frees its slot** — that is
   what lets the overnight queue keep moving past a gate. Resuming a held run never waits for a
   slot (it may briefly oversubscribe; new starts wait). Every completion and every hold re-ticks.
3. **Execution** — `runs/runner.ts#executeRun` marks the run running, moves the card
   queued→running, tears down earlier attempts' run dirs, builds `<stateDir>/runs/<runId>/`
   (scratch + folder-source symlinks; **repo worktrees are created lazily** by the MCP tool
   `use_repo`, which is also the only place a ticket's `repoTags` are written — see
   `runs/tags.ts`), composes the prompt (`runs/prompt.ts`), arms the time budget, and starts the
   adapter with a **gate** (`ctx.gate`) the Claude adapter installs as a `PreToolUse` hook.
4. **Holds** — the gate applies the rule table (`src/rules.ts`, first match wins, unmatched =
   allow): `never` denies outright, `ask` holds the run with reason `permission`; the
   `mcp__tada__ask_user` tool holds with reason `question`; an exhausted budget holds with reason
   `time` at the next tool call (CLI adapters, which have no gate, are SIGSTOPped instead). A hold
   is a pending promise: status `held` + `heldReason` + `hold` payload, card → `stopped`, slot
   released, ping sent. Routes resolve it through `Scheduler.liveRun(id).resolve(...)`:
   approve (optionally **always allow**, which rewrites the matched rule with provenance and a
   Today receipt in the same synchronous block), deny with a note (fed back to the agent as the
   tool error), answer, continue (+time). Timeout and deny are resumes; only failure and re-run are
   restarts — don't share code paths between them.
5. **Outcome** — MCP `report_outcome` is the primary channel; `scratch/outcome.json` is the
   fallback for CLI adapters. No outcome = failure. The run **files itself**: status `done`, card
   → `done`, run dir cleaned. There is no automatic push or PR — the agent does that itself
   (`git push`, `gh pr create`), which is what the default rules gate.
6. **Failure / cancel** — `failed` parks the card in `stopped` (the only red); `cancelled` (Stop
   run) parks it in `backlog`. Nothing auto-retries; re-run (`POST /tickets/:id/rerun`) is a fresh
   attempt with new worktrees.

Every transition is guarded by `@tada/shared`'s `canTransitionRun` / `canMoveCard` and **throws**
on an illegal move. Inside `executeRun`, every failure path between "marked running" and a terminal
state must route through the local `markFailed`/`markCancelled` closures. Recovery on boot: queued
runs stay queued; running/held runs fail (their process is gone).

### Adapters

`adapters/types.ts` is the contract: `available()`, `start(ctx) -> { done, inject, pause, resume }`,
`supportsGates`. The registry registers *every* adapter regardless of whether its CLI is installed.
`TADA_FAKE_ADAPTER=1` additionally registers `FakeAdapter`, whose script can call `ctx.gate(...)`
to exercise holds exactly as the Claude hook would — that is how the runner/scheduler tests drive
holds with zero tokens.

- `claude.ts` — Claude Agent SDK in **streaming-input mode** with a `PreToolUse` hook (`gateHook`)
  that awaits `ctx.gate` — the hold *is* that pending hook. `claudeQueue.ts`'s `UserMessageQueue`
  keeps the session alive so notes can be injected mid-run; it counts injected-but-unanswered
  messages so the session doesn't close underneath a nudge.
- `codex.ts` / `gemini.ts` — one-shot CLIs via `adapters/exec.ts#startCliSession`. No gate, no
  tools: they get every repo checked out eagerly (tags stamped for repos whose branch moved),
  their prompt gets the outcome-file instruction appended, `inject()` declines, and out-of-time
  is SIGSTOP/SIGCONT.

### MCP server

`mcp/server.ts` mounts at `/mcp`, authenticated per-run by the `runToken` (not the global bearer
token — `/mcp` and `/ws` are exempt from the auth hook in `app.ts`). Tools: `use_repo`,
`ask_user`, `update_ticket`, `attach_link`, `attach_file`, `write_memory_note`, `propose_ticket`,
`report_outcome`. `ask_user` never waits itself — the gate holds the run and passes the answer
back as `updatedInput.answer` (with `runs/answers.ts` as the fallback channel).

### Auth, CORS, and WebSocket ordering in `app.ts`

`app.ts` has load-bearing ordering that is easy to break — the auth hook is added inside `.after()`
so it lands *behind* the CORS hook (otherwise preflights 401 before CORS answers them, and the
client reports "could not reach server" instead of "invalid token"), and `registerWsRoute` likewise
runs inside `.after()` so the websocket plugin's `onRoute` hook is installed first. The long
comments there explain why; read them before reordering anything.

### State on disk

Sources (repo clones and attached folders) live in `dataDir/manifest.json` — SQLite has no repos
table, by design. Memory notes, rules, settings, tickets, runs and activity live in SQLite.
Paths come from `src/paths.ts` (XDG with `TADA_DATA_DIR` / `TADA_CONFIG_DIR` / `TADA_STATE_DIR`
overrides). Tests call `isolateXdg()` (via `makeTestApp()`) to point all three at a temp dir and
disable commit signing.

### Broadcast

`ws.ts#BroadcastHub` is one room (no per-workspace subscriptions). It's wired as the run journal's
broadcast hook, so any journaled `status` event also re-emits `board_changed`. Route handlers that
mutate the board directly call `boardChanged` themselves; rule edits emit `rules_changed`.

## Mobile architecture

expo-router file-based routing under `app/`. Root `_layout.tsx` composes
`GestureHandlerRootView → SafeAreaProvider → ThemeProvider → ConnectionProvider → AppQueryProvider
→ Stack`, plus a globally-mounted `ToastHost`.

- **Native headers are always hidden.** Every screen draws the shared `AppHeader` itself.
- **`app/(tabs)` is a Tabs navigator**, not a stack: Control (`index`), `board`, `memory`,
  `settings` slide sideways and never pile up. Ticket (`/tickets/[id]`), run (`/runs/[id]`,
  `/runs/[id]/diff`) and note (`/notes/[id]`) screens live in the root stack and push over the
  whole group. Navigation helpers are in `src/nav.ts` — `goToSection` (plain `navigate`, tabs) vs
  `goBackOr` (falls back to a replace, because a screen opened cold from a push notification has
  no back stack).
- **Connection gating.** `GuardedStack` / the tabs layout redirect to `/connect` when no
  connection is stored. A 401 from any query or mutation triggers a global `disconnect()` in
  `AppQueryProvider`, which routing turns into that redirect. Credentials live in
  `expo-secure-store` on native and `localStorage` on web (`src/settings.ts`).
- **Query cache.** All keys are defined in `src/api/queries.ts#keys`. `useAppSocket` opens one
  WebSocket and invalidates on `board_changed` / `activity` / `rules_changed`, forwarding
  `run_event` to the caller. Changing the connection's identity `resetQueries()` (not `clear()`)
  — the comment in `app/_layout.tsx` explains why.
- **Gates.** `src/components/gate/HoldActions.tsx` is the one implementation of the stopped-on-you
  actions (approve / always allow / deny with a note / view diff, question options, continue,
  re-run) — every surface renders it rather than its own buttons.
- **Layout.** `src/layout.ts#useLayout` is the single responsive switch: `wide` (≥1000px) gets the
  `Rail` sidebar, narrow gets the `BottomStrip`.
- **Design system.** "Instrument Ink" — `src/design/tokens.ts`. Night (warm brown-black) is the
  primary theme, paper day is opt-in. Two voices: the agent speaks IBM Plex Mono on recessed dark
  ink (the `agent*` tokens are theme-invariant), you speak Instrument Sans on raised surfaces.
  Orange = live (running *and* held), sage = done/ok, red = failure only. **No other decorative
  color exists** — never introduce a raw hex literal in a component; add or use a token.
- Screen logic that can be tested without rendering is split into plain modules
  (`src/control.ts`, `src/ticketDetail.ts`, `src/board/*.ts`, `src/runActivity.ts`).

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
