# tada Expo Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/mobile` — the Expo React Native client (iOS/Android/web) for the tada server: workspace list, kanban board with dispatch, ticket detail with live agent activity, memory editor, settings, and push notifications.

**Architecture:** Expo (managed) + expo-router file-based navigation + TanStack Query for all REST state (WS `board_changed` messages invalidate queries; `run_event` messages stream into the activity view). A thin typed API client consumes DTO types from `@tada/shared`. Server URL + bearer token live in a settings store (SecureStore native / localStorage web). Task 1 is server-side prep: WS query-param token auth and aligning `@tada/shared` with real API shapes.

**Tech Stack:** Expo SDK (latest), TypeScript strict, expo-router, @tanstack/react-query, expo-secure-store, expo-notifications, jest-expo + @testing-library/react-native, ESLint via `expo lint` (Biome continues to format).

## Global Constraints

- Monorepo conventions from Plan 1 hold: Node >= 22, ESM, strict TS (`strict`, `noUncheckedIndexedAccess`), root `pnpm lint && pnpm typecheck && pnpm test` green at every commit. The app package adds `expo lint` to that gate (root `lint` script runs both).
- App tests use jest-expo + @testing-library/react-native (`pnpm --filter @tada/mobile test`); server tests stay vitest.
- All API access goes through the typed client in `src/api/` — no raw `fetch` in components. All server state through TanStack Query — no ad-hoc `useEffect` fetching.
- DTO types come from `@tada/shared` only; the app never redeclares server shapes. JSON serialization means timestamps are ISO strings client-side.
- Spec UX rules: columns freeform except Ready = queue; Ready order = priority; Done is human-only; card shows agent/model chip + status glyph; push fires only for completed/failed runs and deep-links to the ticket.
- v1 board interaction is tap-driven (quick actions + move sheet + reorder buttons), not free drag — cross-platform RN drag-and-drop is deferred; the plan's Task 6 documents this deviation.
- Server URL is user-configured (tailnet address); nothing hardcoded. 401 anywhere routes to the connection screen.
- No AI attribution in commits.

---

### Task 1: Server prep — WS query-token auth + shared DTO alignment

**Files:**
- Modify: `apps/server/src/ws.ts` (registerWsRoute signature), `apps/server/src/app.ts` (exempt `/ws`, pass config to registerWsRoute), `packages/shared/src/domain.ts` (rewrite entity interfaces as API DTOs)
- Create: `packages/shared/src/api.ts` (payload/message types), export from `packages/shared/src/index.ts`
- Test: `apps/server/test/ws.test.ts` (new), `apps/server/test/api.test.ts` (extend: DTO drift guard)

**Interfaces:**
- Consumes: existing `BroadcastHub`, `Config`, auth hook in `app.ts`.
- Produces (in `@tada/shared`):
```ts
// api.ts — shapes as they cross the wire (integer ids, ISO-string dates)
export interface ApiWorkspace { id: number; name: string; path: string; defaultAdapter: string; defaultModel: string; concurrency: number; timeoutMs: number; createdAt: string }
export interface ApiWorkspaceListItem extends ApiWorkspace { runningCount: number; needsReviewCount: number }
export interface ApiColumn { id: number; workspaceId: number; kind: ColumnKind; title: string; position: number; createdAt: string }
export interface ApiTicket { id: number; workspaceId: number; columnId: number; title: string; description: string; position: number; queueState: QueueState; adapterOverride: string | null; modelOverride: string | null; createdAt: string }
export interface ApiComment { id: number; ticketId: number; author: 'human' | 'agent'; body: string; createdAt: string }
export interface ApiRun { id: number; ticketId: number; adapter: string; model: string; status: RunStatus; branch: string | null; prUrl: string | null; summary: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null }
export interface ApiBoard { columns: Array<ApiColumn & { tickets: ApiTicket[] }> }
export interface ApiRunEvent { id: number; runId: number; type: 'status' | 'tool_use' | 'text' | 'error'; payload: unknown; createdAt: string }
export interface ApiMemory { agentsMd: string; notes: Array<{ name: string; body: string }> }
export interface ApiRepo { name: string; url: string; defaultBranch: string }
export type WsMessage = { type: 'run_event'; runId: number; event: { type: ApiRunEvent['type']; payload: unknown } } | { type: 'board_changed'; workspaceId: number }
```
- Deletes the stale string-id entity interfaces from `domain.ts` (Workspace/Ticket/Comment/AgentRun/RunEvent — unused by the server, wrong ids). Keep ColumnKind/RunStatus/QueueState/Actor/RunOutcome and the state machine.
- WS auth: `/ws` becomes exempt from the header hook; `registerWsRoute(app, hub, config)` accepts the connection when `query.token === config.bearerToken` (header `Authorization: Bearer` also accepted for native clients); otherwise `socket.close(1008, 'unauthorized')`.

- [ ] **Step 1: Write failing WS tests** (`test/ws.test.ts`)

Using the `ws` package as client (add dev-dep) against `app.listen({port:0})`:
```ts
test('ws connects with query token and receives board_changed', async () => {
  // build app via test helper, hub.boardChanged(wsId) after subscribe
  const sock = new WebSocket(`ws://127.0.0.1:${port}/ws?workspaceId=${wsId}&token=${config.bearerToken}`)
  await once(sock, 'open')
  hub.boardChanged(wsId)
  const [raw] = await once(sock, 'message')
  expect(JSON.parse(String(raw))).toEqual({ type: 'board_changed', workspaceId: wsId })
})
test('ws with wrong token is closed with 1008', async () => { /* expect close event, code 1008 */ })
test('ws with bearer header (no query token) still connects', async () => { /* headers option on ws client */ })
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @tada/server exec vitest run test/ws.test.ts`

- [ ] **Step 3: Implement** — exempt `/ws` in the auth hook path check (same exact-or-slash pattern as `/mcp`); in `registerWsRoute`, validate query token OR auth header before `hub.register`. Add a DTO drift guard to an existing api.test.ts case:
```ts
const board = (await inject('GET', `/workspaces/${wsId}/board`)).json() satisfies ApiBoard
const list = (await inject('GET', '/workspaces')).json() satisfies ApiWorkspaceListItem[]
```
(`satisfies` on real responses makes the server suite fail to compile if DTOs drift.) Note: drizzle timestamp columns are `Date` in-process but ISO strings after JSON — the drift guard exercises the post-JSON shape, which is what the DTOs describe.

- [ ] **Step 4: Run tests, verify PASS** — full `pnpm lint && pnpm typecheck && pnpm test`

- [ ] **Step 5: Commit** — `git commit -m "feat(shared,server): api dto types and websocket query-token auth"`

---

### Task 2: Expo app scaffold + tooling

**Files:**
- Create: `apps/mobile/` via `pnpm create expo-app@latest apps/mobile --template blank-typescript`, then: `apps/mobile/app.json` (name tada, scheme `tada`), `apps/mobile/tsconfig.json` (extend expo/tsconfig.base + strict + noUncheckedIndexedAccess), `apps/mobile/eslint.config.js` (`expo lint` default), `apps/mobile/jest.config.js` (preset jest-expo), `apps/mobile/app/_layout.tsx`, `apps/mobile/app/index.tsx` (placeholder)
- Modify: root `package.json` (lint script gains `pnpm --filter @tada/mobile lint`), `biome.json` (exclude `apps/mobile` from Biome LINTING but keep formatting — or simplest: add `apps/mobile` to Biome ignore entirely and let ESLint+prettier-config-expo own it; pick one, document in the report)

**Interfaces:**
- Produces: `@tada/mobile` package with scripts `start`, `lint` (expo lint), `typecheck` (tsc --noEmit), `test` (jest); expo-router installed and rendering; `@tada/shared` importable (metro config: enable pnpm workspace resolution — `metro.config.js` with `watchFolders` for the repo root, standard Expo monorepo setup per Expo docs).

- [ ] **Step 1: Scaffold** — run create-expo-app; add deps: `expo-router`, `@tanstack/react-query`, `expo-secure-store`, `expo-notifications`, `expo-constants`, `expo-linking`; dev: `jest-expo`, `jest`, `@testing-library/react-native`, `react-test-renderer`. Consult current Expo docs if commands differ: `npx ctx7@latest library "Expo" "expo-router setup monorepo pnpm metro config"` then `docs` (max 3 commands).
- [ ] **Step 2: Wire monorepo** — metro.config.js watchFolders + nodeModulesPaths per Expo monorepo guide; `_layout.tsx` renders `<Stack />` inside a `QueryClientProvider`.
- [ ] **Step 3: Smoke test** (`apps/mobile/test/smoke.test.tsx`):
```tsx
import { render, screen } from '@testing-library/react-native'
import Index from '../app/index'
test('renders placeholder', () => {
  render(<Index />)
  expect(screen.getByText('tada')).toBeOnTheScreen()
})
```
- [ ] **Step 4: Verify** — `pnpm --filter @tada/mobile lint && pnpm --filter @tada/mobile typecheck && pnpm --filter @tada/mobile test` green; root `pnpm lint/typecheck/test` still green (jest and vitest coexist; root `test` runs both via `pnpm -r test`).
- [ ] **Step 5: Commit** — `git commit -m "chore(mobile): scaffold expo app with router, query, jest-expo, expo lint"`

---

### Task 3: Settings store + typed API client

**Files:**
- Create: `apps/mobile/src/settings.ts`, `apps/mobile/src/api/client.ts`, `apps/mobile/src/api/queries.ts`
- Test: `apps/mobile/test/settings.test.ts`, `apps/mobile/test/client.test.ts`

**Interfaces:**
- Produces:
```ts
// settings.ts — server connection settings, SecureStore native / localStorage web
export interface Connection { baseUrl: string; token: string }
export async function loadConnection(): Promise<Connection | null>
export async function saveConnection(c: Connection): Promise<void>
export async function clearConnection(): Promise<void>

// api/client.ts
export class ApiError extends Error { constructor(readonly status: number, readonly body: unknown) }
export class TadaClient {
  constructor(private conn: Connection, private fetchImpl: typeof fetch = fetch)
  // one method per route, typed with @tada/shared DTOs:
  health(): Promise<{ ok: boolean }>
  listWorkspaces(): Promise<ApiWorkspaceListItem[]>
  createWorkspace(name: string): Promise<ApiWorkspace>
  getWorkspace(id: number): Promise<ApiWorkspace & { repos: ApiRepo[] }>
  patchWorkspace(id: number, patch: Partial<Pick<ApiWorkspace, 'defaultAdapter' | 'defaultModel' | 'concurrency' | 'timeoutMs'>>): Promise<ApiWorkspace>
  addRepo(wsId: number, url: string): Promise<void>
  removeRepo(wsId: number, name: string): Promise<void>
  board(wsId: number): Promise<ApiBoard>
  memory(wsId: number): Promise<ApiMemory>
  putMemory(wsId: number, file: string, body: string): Promise<void>
  createTicket(t: { workspaceId: number; title: string; description?: string }): Promise<ApiTicket>
  ticket(id: number): Promise<{ ticket: ApiTicket; comments: ApiComment[]; runs: ApiRun[] }>
  patchTicket(id: number, patch: Partial<Pick<ApiTicket, 'title' | 'description' | 'position' | 'adapterOverride' | 'modelOverride'>>): Promise<ApiTicket>
  moveTicket(id: number, to: { columnId: number; position: number }): Promise<void>
  comment(ticketId: number, body: string): Promise<ApiComment>
  runEvents(runId: number, after?: number): Promise<ApiRunEvent[]>
  transcript(runId: number): Promise<string>
  cancelRun(runId: number): Promise<void>
  registerPushToken(token: string): Promise<void>
  wsUrl(workspaceId: number): string  // ws(s)://…/ws?workspaceId=N&token=…
}

// api/queries.ts — TanStack Query hooks + key factory
export const keys = { workspaces: ['workspaces'] as const, board: (id: number) => ['board', id] as const, ticket: (id: number) => ['ticket', id] as const, memory: (id: number) => ['memory', id] as const, workspace: (id: number) => ['workspace', id] as const }
export function useWorkspaces() / useBoard(wsId) / useTicket(id) / useMemory(wsId) / useWorkspace(wsId)  // useQuery wrappers
export function useMoveTicket(wsId) / useCreateTicket() / useComment(ticketId) / ...  // useMutation wrappers invalidating the right keys
export function useClient(): TadaClient  // from a ConnectionContext provided in _layout
```

- [ ] **Step 1: Failing tests** — settings round-trip (jest-expo mocks SecureStore; web branch via Platform.OS mock); client: injected fake fetch asserts URL/method/Authorization header/body for representative calls (`listWorkspaces`, `moveTicket`, `runEvents` with `?after=`), `ApiError` thrown with status+body on non-2xx, `wsUrl` converts http(s)→ws(s) and embeds token+workspaceId.
- [ ] **Step 2: Verify FAIL** → **Step 3: Implement** (client methods are one-liners over a private `req<T>(method, path, body?)`) → **Step 4: Verify PASS + lint + typecheck**
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): settings store and typed api client with query hooks"`

---

### Task 4: Connection screen + auth routing

**Files:**
- Create: `apps/mobile/app/connect.tsx`, `apps/mobile/src/ConnectionContext.tsx`
- Modify: `apps/mobile/app/_layout.tsx` (provider + redirect logic), `apps/mobile/app/index.tsx` (redirect to /workspaces or /connect)
- Test: `apps/mobile/test/connect.test.tsx`

**Interfaces:**
- Produces: `ConnectionProvider` exposing `{ connection, client, connect(c), disconnect() }`; app-wide rule: no connection → `/connect`; any `ApiError` with status 401 → `disconnect()` → `/connect` (wired via TanStack Query's global error handler in `_layout`).
- Connect screen: base URL + token inputs, "Connect" button → `client.health()` probe → save + navigate; inline error on failure (unreachable/401).

- [ ] **Step 1: Failing test** — render connect screen with a fake client whose `health` resolves/rejects; assert: success saves connection (spy) and navigates; failure shows error text and saves nothing.
- [ ] **Step 2-4:** FAIL → implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): connection screen with health probe and 401 routing"`

---

### Task 5: Workspace list screen

**Files:**
- Create: `apps/mobile/app/workspaces/index.tsx`, `apps/mobile/src/components/WorkspaceCard.tsx`
- Test: `apps/mobile/test/workspaces.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaces()`, `useCreateWorkspace()`.
- Produces: list of `WorkspaceCard` (name + badges: `N running` pulse, `M to review`) navigating to `/workspaces/[id]/board`; header "+" opens a name prompt (inline modal) → createWorkspace → invalidate → navigate to its board. Pull-to-refresh via query refetch. Empty state text: "No workspaces yet — create one to get started."

- [ ] **Step 1: Failing tests** — with QueryClientProvider + mocked client: renders workspace names and badge counts from fixture data; create flow calls client and navigates (expo-router test mock per expo-router testing docs).
- [ ] **Step 2-4:** FAIL → implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): workspace list with status badges and create flow"`

---

### Task 6: Board screen

**Files:**
- Create: `apps/mobile/app/workspaces/[id]/board.tsx`, `apps/mobile/src/components/TicketCard.tsx`, `apps/mobile/src/components/ColumnView.tsx`, `apps/mobile/src/board/positions.ts`
- Test: `apps/mobile/test/positions.test.ts`, `apps/mobile/test/board.test.tsx`

**Interfaces:**
- Consumes: `useBoard(wsId)`, `ApiBoard`, `ColumnKind`.
- Produces:
  - Board = horizontal `FlatList` of `ColumnView`s (one screen-width-ish each, snap paging on phones; all visible on wide/web via responsive width). Each column: title + count header, vertical `FlatList` of `TicketCard`s, "+ Add ticket" footer on the backlog column (title prompt → createTicket).
  - `TicketCard`: title, agent/model chip (`adapterOverride ?? ws.defaultAdapter · modelOverride ?? ws.defaultModel`), status glyph derived from latest run + queueState: queued ⏳ (queueState 'queued'), failed badge (queueState 'held'), running ▶ (any run running — board payload lacks runs, so glyph uses queueState + column kind: in_progress column ⇒ running; in_review ⇒ needs-review dot). Tap → ticket detail. **Interaction deviation (documented):** no free drag in v1; card actions come from Task 7's move sheet.
  - `positions.ts` (pure, unit-tested): `positionBetween(before: number | undefined, after: number | undefined): number` — fractional midpoint (before undefined ⇒ after - 1; after undefined ⇒ before + 1; both undefined ⇒ 1), used by move/reorder.

- [ ] **Step 1: Failing positions tests**
```ts
expect(positionBetween(undefined, undefined)).toBe(1)
expect(positionBetween(2, undefined)).toBe(3)
expect(positionBetween(undefined, 2)).toBe(1)
expect(positionBetween(1, 2)).toBe(1.5)
```
- [ ] **Step 2: Failing board test** — fixture ApiBoard renders 5 columns, tickets in position order, chip text and glyphs correct for a queued/held/in-progress fixture trio.
- [ ] **Step 3-4:** implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): board screen with columns, ticket cards, position math"`

---

### Task 7: Move & dispatch actions

**Files:**
- Create: `apps/mobile/src/components/TicketActions.tsx` (bottom sheet: move to column, send to Ready, reorder up/down, change agent/model)
- Modify: `apps/mobile/src/components/TicketCard.tsx` (long-press opens actions), `board.tsx`
- Test: `apps/mobile/test/ticketActions.test.tsx`

**Interfaces:**
- Consumes: `useMoveTicket(wsId)` (mutation → POST /tickets/:id/move, invalidates board), `usePatchTicket`, `positionBetween`, workspace adapters list — add `client.getWorkspace` data for defaults; agent/model options: static map for v1 `{claude: ['sonnet','opus','haiku']}` sourced from a new `client.adapters()`? NO — YAGNI: server exposes no adapters route; hardcode `ADAPTERS: Record<string, string[]> = { claude: ['sonnet', 'opus', 'haiku'] }` in one file `src/adapters.ts` with a comment pointing at the server's adapter registry, and validate against server 400s gracefully.
- Produces: actions sheet behaviors:
  - "Send to Ready" (visible unless already queued): moveTicket to ready column, position = end of Ready (positionBetween(last, undefined)). This is THE dispatch gesture.
  - "Move to <column>" for each other column (Done shown only from In Review — client-side mirror of human rules via `canMoveCard('human', from, to)` from @tada/shared; server still enforces).
  - Reorder ▲▼ within current column (position math between neighbors).
  - "Agent/model" picker → patchTicket overrides (disabled with hint when a run is active — surface server 409 as toast otherwise).
  - Server 409 (`run in progress`) → toast "Agent is working on this ticket — wait or cancel the run", board refetch.

- [ ] **Step 1: Failing tests** — sheet for a backlog ticket shows Send to Ready + move targets excluding in_progress; "Send to Ready" calls moveTicket with ready columnId and end position; 409 from mocked client shows the toast text; Done option absent for a backlog ticket, present for in_review.
- [ ] **Step 2-4:** FAIL → implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): ticket actions - dispatch, move, reorder, agent override"`

---

### Task 8: Ticket detail screen

**Files:**
- Create: `apps/mobile/app/tickets/[id].tsx`, `apps/mobile/src/components/CommentThread.tsx`, `apps/mobile/src/components/RunRow.tsx`
- Test: `apps/mobile/test/ticketDetail.test.tsx`

**Interfaces:**
- Consumes: `useTicket(id)`, `useComment`, `usePatchTicket`.
- Produces: sections — (1) title/description, editable inline when no active run (409 → toast); (2) chip row: column, agent·model, queueState badge; (3) `CommentThread`: chronological bubbles, `**agent**` left / `**you**` right, markdown links tappable (plain `Linking.openURL` on URLs; full markdown rendering deferred), input + send; (4) Runs: `RunRow` per run (adapter·model, status, relative time, PR link button when `prUrl`) tapping → `/runs/[id]` (Task 9); (5) footer actions reuse `TicketActions`.

- [ ] **Step 1: Failing tests** — fixture ticket with 2 comments + 2 runs renders thread in order and run statuses; sending a comment calls client and clears input; PR button opens `Linking` with prUrl (spy).
- [ ] **Step 2-4:** FAIL → implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): ticket detail with comment thread and run history"`

---

### Task 9: Run activity screen

**Files:**
- Create: `apps/mobile/app/runs/[id].tsx`, `apps/mobile/src/components/EventFeed.tsx`, `apps/mobile/src/api/useRunEvents.ts`
- Test: `apps/mobile/test/useRunEvents.test.tsx`, `apps/mobile/test/eventFeed.test.tsx`

**Interfaces:**
- Consumes: `client.runEvents(runId, after)`, `client.cancelRun`, `client.transcript`.
- Produces:
  - `useRunEvents(runId, { live: boolean })`: accumulates events; when `live` (run status queued/running) polls `runEvents(runId, lastId)` every 2s (TanStack `refetchInterval`), appending; when a WS `run_event` for this run arrives (Task 10 wires it) the hook ingests it directly via an exported `ingest(event)` and skips duplicate ids.
  - `EventFeed`: renders events — status → pill ("running", "failed"…), text → body text, tool_use → monospace `name(inputPreview)` row, error → red row. Auto-scrolls to end while live.
  - Screen: feed + header (status, cancel button while running → confirm dialog → cancelRun) + "View transcript" (fetches raw JSONL, renders monospace, 404 → "No transcript").

- [ ] **Step 1: Failing tests** — hook: fake client returns pages [e1,e2] then [e3]; assert accumulation and `after` param advancing; duplicate ingest ignored. Feed: fixture events render one row each with right styling testIDs; cancel button triggers client.cancelRun after confirm.
- [ ] **Step 2-4:** FAIL → implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): live run activity feed with cancel and transcript"`

---

### Task 10: WebSocket live updates

**Files:**
- Create: `apps/mobile/src/api/useWorkspaceSocket.ts`
- Modify: `board.tsx`, `app/tickets/[id].tsx`, `app/runs/[id].tsx` (subscribe)
- Test: `apps/mobile/test/useWorkspaceSocket.test.tsx`

**Interfaces:**
- Consumes: `client.wsUrl(wsId)`, `WsMessage` from @tada/shared, queryClient.
- Produces: `useWorkspaceSocket(wsId, { onRunEvent? })` — opens one WebSocket (global WebSocket API, works RN + web), parses `WsMessage`; `board_changed` → `invalidateQueries(keys.board(wsId))` + `keys.workspaces`; `run_event` → forwards to `onRunEvent` and invalidates `keys.ticket(...)` is NOT possible from runId alone — keep it simple: forward only; screens that care pass `onRunEvent`. Reconnects with capped backoff (1s→2s→4s→max 10s) while mounted; closes on unmount. No test flakiness: inject a `WebSocketCtor` for tests.

- [ ] **Step 1: Failing tests** — fake WS class: on message `board_changed` the board query is invalidated (spy on queryClient); `run_event` reaches `onRunEvent`; close triggers scheduled reconnect (fake timers); unmount closes and stops reconnecting.
- [ ] **Step 2-4:** FAIL → implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): websocket live updates with reconnect"`

---

### Task 11: Memory screens

**Files:**
- Create: `apps/mobile/app/workspaces/[id]/memory.tsx` (list: AGENTS.md + notes), `apps/mobile/app/workspaces/[id]/memory/[file].tsx` (editor)
- Test: `apps/mobile/test/memory.test.tsx`

**Interfaces:**
- Consumes: `useMemory(wsId)`, `client.putMemory`.
- Produces: list screen (AGENTS.md pinned first, then notes by name) → editor screen: multiline monospace `TextInput`, save button (disabled until dirty), saved toast; new-note flow (name prompt, `.md` appended if missing, basename validation client-side mirroring server guard).

- [ ] **Step 1: Failing tests** — list renders AGENTS.md + note names; editor save calls putMemory with edited body; invalid new-note name (`../x`) shows inline error, no call.
- [ ] **Step 2-4:** FAIL → implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): workspace memory browser and editor"`

---

### Task 12: Workspace settings screen

**Files:**
- Create: `apps/mobile/app/workspaces/[id]/settings.tsx`
- Test: `apps/mobile/test/workspaceSettings.test.tsx`

**Interfaces:**
- Consumes: `useWorkspace(wsId)`, `patchWorkspace`, `addRepo`, `removeRepo`, `ADAPTERS`.
- Produces: sections — Repos (list name+url, remove with confirm, add-by-URL input with basic `git@`/`https://` prefix validation); Defaults (adapter picker from ADAPTERS, model picker scoped to adapter, both → patchWorkspace); Advanced (concurrency stepper 1-4, timeout minutes input → ms). Server 400s (bad adapter/model) surface inline.

- [ ] **Step 1: Failing tests** — renders repos from fixture; add repo calls client with url and refetches; remove confirms then calls; model options change when adapter changes; concurrency patch sends number.
- [ ] **Step 2-4:** FAIL → implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): workspace settings - repos, defaults, limits"`

---

### Task 13: Push notifications + deep links

**Files:**
- Create: `apps/mobile/src/push.ts`
- Modify: `app/_layout.tsx` (register on launch when connected; notification-tap handler), `app.json` (notification config, `scheme: "tada"`)
- Test: `apps/mobile/test/push.test.ts`

**Interfaces:**
- Consumes: `expo-notifications`, `client.registerPushToken`, router.
- Produces: `registerForPush(client): Promise<void>` — permission request (no-op on denial), `getExpoPushTokenAsync`, POST /push-tokens; skips entirely on web (`Platform.OS === 'web'`). Tap handler: server sends `data: { ticketId }` → `router.push('/tickets/' + ticketId)`. Check current expo-notifications API via ctx7 before implementing (max 3 commands).

- [ ] **Step 1: Failing tests** — mocked expo-notifications: granted → token posted; denied → no post, no throw; web → no permission call. Tap listener navigates to the ticket route (router mock).
- [ ] **Step 2-4:** FAIL → implement → PASS + lint + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): push registration and notification deep links"`

---

### Task 14: Web build verification + docs

**Files:**
- Modify: `README.md` (Client section: running the app — `pnpm --filter @tada/mobile start`, connecting over tailnet, web build `npx expo export --platform web`, push caveats on web), `apps/mobile/package.json` (add `"web": "expo start --web"`)

- [ ] **Step 1:** `npx expo export --platform web` completes without errors; `pnpm lint && pnpm typecheck && pnpm test` (whole repo) green.
- [ ] **Step 2:** README client section written (how to run on phone via Expo Go/dev build, web, where settings live, the tap-not-drag board note).
- [ ] **Step 3: Commit** — `git commit -m "docs: client usage and web build"`

---

## Self-review notes

- **Spec coverage:** workspace list w/ badges (T5), board columns + chips + glyphs (T6), dispatch-to-Ready + reorder-priority + human-move rules (T7), ticket detail w/ interleaved thread + runs + PR links (T8), live activity feed + transcript + cancel (T9), WS invalidation + REST fallback via polling (T9/T10), memory browse/edit (T11), settings incl. repos/defaults/concurrency/timeout (T12), push on completion/failure with ticket deep link (T13), web output (T14), Tailscale + bearer auth (T3/T4, server prep T1). Deviation documented: tap-driven board instead of free drag (Global Constraints + T6).
- **Known deferrals:** free drag-and-drop, markdown rendering in comments, multi-select, in-app diff review (spec-deferred), dynamic adapter discovery endpoint (hardcoded ADAPTERS map with server as source of truth for validation).
- **Type consistency:** all DTOs defined once in T1 (`@tada/shared/api.ts`); client methods (T3) and screens reference those exact names; `positionBetween` signature consistent T6/T7.
