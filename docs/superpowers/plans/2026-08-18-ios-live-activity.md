# iOS Live Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a tada run on the iPhone lock screen and in the Dynamic Island for the length of the run — working, stopped on you, done, failed — with the gate actions reachable without unlocking.

**Architecture:** `packages/shared` owns the content-state contract and the pure run→card mapper, so the pusher and the renderer cannot drift. The server gains a direct APNs channel (`node:http2` + an ES256 JWT, no dependency) and a small policy module that keeps **one** Live Activity alive — the run that most wants you — driven by a single `sync()` called wherever the runner already broadcasts a board change. The mobile app declares the activity's UI as a React component compiled to SwiftUI by `expo-widgets`, registers the push-to-start and per-activity tokens, and turns button presses into calls on the existing run routes.

**Tech Stack:** TypeScript (NodeNext ESM on the server/shared, Metro on mobile), Fastify, drizzle/SQLite, vitest (server + shared), jest + @testing-library/react-native (mobile), `expo-widgets@57.0.10`, `@expo/ui/swift-ui`, APNs HTTP/2.

**Spec:** `docs/superpowers/specs/2026-08-18-ios-live-activity-design.md`

## Global Constraints

- **Identifiers.** App bundle id `dev.copley.tada`; widget extension `dev.copley.tada.widgets`; app group `group.dev.copley.tada`; APNs topic `dev.copley.tada.push-type.liveactivity`. The Live Activity name is `TadaRun` and must be identical in `app.json`, `createLiveActivity()`, and the APNs `content-state.name`.
- **`content-state` shape.** `{ "name": "TadaRun", "props": "<JSON string>" }` — `props` is a *stringified* `LiveActivityProps`, a string inside the JSON. An object renders nothing and reports no error.
- **`attributes-type`** is `LiveActivityAttributes` and `attributes` is `{}` — the Swift struct `expo-widgets` declares.
- **Imports.** `apps/server` and `packages/shared` are NodeNext ESM: every relative import carries a `.js` extension. `apps/mobile` does not.
- **Style.** Single quotes, no semicolons, 100 columns, 2-space indent. Biome formats everything except `apps/mobile` (eslint-config-expo there). Match the repo's dense "why" comments on load-bearing code.
- **No new runtime dependency on the server.** APNs is `node:http2` + `node:crypto`.
- **Tests never touch the network and never spend tokens.** Every outbound sender is injected, exactly as `fetchImpl` and `webPush` already are.
- **Colors come from tokens.** No raw hex literal in a component; the widget imports `night` from `apps/mobile/src/design/tokens.ts`. SwiftUI colors are 6-digit hex only — where a token is 8-digit (`#F0EADD14`), use the opaque equivalent given in Task 7.
- **Never throw at a run.** Every notification path swallows its own failures; a lock screen must not be able to fail a run.
- **Migrations.** After touching `apps/server/src/db/schema.ts`, run `pnpm --filter @tada/server exec drizzle-kit generate` and commit the generated SQL. `openDb()` migrates on boot, so an unregenerated change is invisible at runtime.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `packages/shared/src/liveActivity.ts` | `LiveActivityProps`, `ActivityAction`, `ActivityPhase`, `runToActivityProps()`, and `holdPingText()` (moved here from the server so the card and the ping say the same sentence). |
| `packages/shared/test/liveActivity.test.ts` | The state table, exhaustively. |
| `apps/server/src/apns.ts` | APNs transport: JWT, HTTP/2, request building. Injectable sender seam. |
| `apps/server/src/liveActivity.ts` | The focus policy: which run owns the one activity, and what to push. |
| `apps/server/test/apns.test.ts` | Request/JWT shape, no network. |
| `apps/server/test/liveActivity.test.ts` | Policy, token binding, dormancy. |
| `apps/mobile/src/liveActivity/TadaRunActivity.tsx` | The design: all four presentations. |
| `apps/mobile/src/liveActivity/chrome.ts` | Pure phase→(color, label) mapping used by the view. |
| `apps/mobile/src/liveActivity/interactions.ts` | Pure button-press→API-request mapping. |
| `apps/mobile/src/liveActivity/register.ts` | Token registration + interaction listener, at module scope. |
| `apps/mobile/test/liveActivityChrome.test.ts` | Chrome + interactions. |

**Modified**

| File | Change |
|---|---|
| `packages/shared/src/index.ts` | Export the new module. |
| `apps/server/src/notify.ts` | `holdPingText` re-exported from `@tada/shared` instead of defined here. |
| `apps/server/src/config.ts` | Optional APNs fields. |
| `apps/server/src/db/schema.ts` + `apps/server/drizzle/*` | Two tables + generated migration. |
| `apps/server/src/routes/runs.ts` | Two token routes. |
| `apps/server/src/runs/runner.ts` | `liveActivity` in `RunnerDeps`; `sync()` beside every `hub.boardChanged()`. |
| `apps/server/src/runs/scheduler.ts` | Pass the channel through to the runner. |
| `apps/server/src/app.ts` | Accept the channel in deps so routes can reach it. |
| `apps/server/src/index.ts` | Build the sender + channel and wire them. |
| `apps/mobile/app.json` | Bundle ids, `expo-widgets` plugin, `NSSupportsLiveActivities`. |
| `apps/mobile/package.json` | `expo-widgets`, `@expo/ui`. |
| `apps/mobile/app/_layout.tsx` | Import `register.ts` for its side effect. |
| `apps/mobile/src/api/client.ts` | Two token-registration methods. |
| `README.md`, `CLAUDE.md` | Prebuild/dev-build instructions; the new channel in the architecture notes. |

---

### Task 1: The contract in `@tada/shared`

**Files:**
- Create: `packages/shared/src/liveActivity.ts`
- Create: `packages/shared/test/liveActivity.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/src/notify.ts:40-50` (delete `holdPingText`, re-export it)

**Interfaces:**
- Consumes: `Hold`, `RunStatus`, `HeldReason` from `./domain.js`.
- Produces: `ActivityPhase`, `ActivityAction`, `LiveActivityProps`, `ActivitySource`, `runToActivityProps(src: ActivitySource): LiveActivityProps | null`, `holdPingText(hold: Hold): string`, `ACTIVITY_DISMISSAL_MS = 4000`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/liveActivity.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import type { Hold } from '../src/domain.js'
import { runToActivityProps } from '../src/liveActivity.js'

const ticket = { id: 7, title: 'Add CSV export to the reports page' }
const base = {
  id: 4128,
  startedAt: new Date('2026-08-18T03:02:00Z'),
  budgetMs: 1_800_000,
  hold: null as Hold | null,
}
const now = new Date('2026-08-18T03:14:00Z')

test('a running run is working, with no actions', () => {
  const props = runToActivityProps({
    ticket,
    run: { ...base, status: 'running' },
    line: 'writing the export query',
    now,
  })
  expect(props).toEqual({
    runId: 4128,
    ticketId: 7,
    title: 'Add CSV export to the reports page',
    phase: 'working',
    agentLine: 'writing the export query',
    startedAt: base.startedAt.getTime(),
    budgetEndsAt: base.startedAt.getTime() + 1_800_000,
    actions: [],
  })
})

test('a permission hold is your turn, and offers approve and deny', () => {
  const hold: Hold = {
    reason: 'permission',
    tool: 'Bash',
    summary: 'git push origin main',
    ruleId: 3,
    ruleTitle: 'push a branch',
    publishes: true,
  }
  const props = runToActivityProps({ ticket, run: { ...base, status: 'held', hold }, line: null, now })
  expect(props?.phase).toBe('yourTurn')
  expect(props?.agentLine).toBe('wants to: push a branch — git push origin main')
  expect(props?.actions).toEqual([
    { kind: 'approve', label: 'Approve' },
    { kind: 'deny', label: 'Deny' },
  ])
})

test('a question hold offers at most two of its own options', () => {
  const hold: Hold = { reason: 'question', question: 'which store?', options: ['Postgres', 'SQLite', 'Redis'] }
  const props = runToActivityProps({ ticket, run: { ...base, status: 'held', hold }, line: null, now })
  expect(props?.agentLine).toBe('which store?')
  expect(props?.actions).toEqual([
    { kind: 'answer', label: 'Postgres', value: 'Postgres' },
    { kind: 'answer', label: 'SQLite', value: 'SQLite' },
  ])
})

test('a question hold with no options falls back to opening the app', () => {
  const hold: Hold = { reason: 'question', question: 'what now?', options: [] }
  const props = runToActivityProps({ ticket, run: { ...base, status: 'held', hold }, line: null, now })
  expect(props?.actions).toEqual([{ kind: 'open', label: 'Open' }])
})

test('a time hold offers continue and stop', () => {
  const hold: Hold = { reason: 'time', budgetMs: 1_800_000 }
  const props = runToActivityProps({ ticket, run: { ...base, status: 'held', hold }, line: null, now })
  expect(props?.agentLine).toContain('out of time')
  expect(props?.actions).toEqual([
    { kind: 'continue', label: 'Continue' },
    { kind: 'stop', label: 'Stop' },
  ])
})

test('done and failed carry their summary; failed offers re-run', () => {
  const done = runToActivityProps({ ticket, run: { ...base, status: 'done' }, line: 'merged pr #481', now })
  expect(done?.phase).toBe('done')
  expect(done?.actions).toEqual([])

  const failed = runToActivityProps({
    ticket,
    run: { ...base, status: 'failed' },
    line: 'reports.spec.ts:214 — expected 50 rows, got 0',
    now,
  })
  expect(failed?.phase).toBe('failed')
  expect(failed?.actions).toEqual([
    { kind: 'rerun', label: 'Re-run' },
    { kind: 'open', label: 'Open' },
  ])
})

test('queued and cancelled runs own no card', () => {
  expect(runToActivityProps({ ticket, run: { ...base, status: 'queued' }, line: null, now })).toBeNull()
  expect(runToActivityProps({ ticket, run: { ...base, status: 'cancelled' }, line: null, now })).toBeNull()
})

test('a run with no startedAt times from now, and a zero budget shows no bar', () => {
  const props = runToActivityProps({
    ticket,
    run: { ...base, status: 'running', startedAt: null, budgetMs: 0 },
    line: null,
    now,
  })
  expect(props?.startedAt).toBe(now.getTime())
  expect(props?.budgetEndsAt).toBeUndefined()
})

describe('agentLine never runs to two lines', () => {
  test('a long line is truncated with an ellipsis', () => {
    const props = runToActivityProps({
      ticket,
      run: { ...base, status: 'running' },
      line: 'x'.repeat(200),
      now,
    })
    expect(props?.agentLine.length).toBeLessThanOrEqual(120)
    expect(props?.agentLine.endsWith('…')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @tada/shared exec vitest run test/liveActivity.test.ts`
Expected: FAIL — cannot resolve `../src/liveActivity.js`.

- [ ] **Step 3: Write the module**

Create `packages/shared/src/liveActivity.ts`:

```ts
import type { Hold, RunStatus } from './domain.js'

/** How long the finished card stays on the lock screen before iOS removes it. */
export const ACTIVITY_DISMISSAL_MS = 4000

/** The agent's well is one line. Longer than this and it wraps, which the design forbids. */
const AGENT_LINE_MAX = 120

export type ActivityPhase = 'working' | 'yourTurn' | 'done' | 'failed'

/** A button on the card. `kind` is what the app calls; the widget only draws `label`. */
export interface ActivityAction {
  kind: 'approve' | 'deny' | 'answer' | 'continue' | 'stop' | 'rerun' | 'open'
  label: string
  /** For `answer`: the option text sent back to the agent. */
  value?: string
}

/**
 * The Live Activity's content state. This object is JSON-stringified into the APNs payload and
 * handed straight to the widget, so it is the one contract between the two — keep it small, and
 * keep everything the card renders in it. Dates are epoch ms because the payload is JSON.
 */
export interface LiveActivityProps {
  runId: number
  ticketId: number
  /** The ticket title — your voice: sentence case, Instrument Sans. */
  title: string
  phase: ActivityPhase
  /** The agent's voice: one line, lowercase, present tense. */
  agentLine: string
  /** The compact presentation counts up from here locally, so the clock costs no pushes. */
  startedAt: number
  /** When the time budget runs out. Absent for a run without one — the bar is then not drawn. */
  budgetEndsAt?: number
  /** At most two, drawn in order. */
  actions: ActivityAction[]
}

export interface ActivitySource {
  ticket: { id: number; title: string }
  run: {
    id: number
    status: RunStatus
    hold: Hold | null
    /** Nullable on the row: a queued run has not started. */
    startedAt: Date | null
    budgetMs: number
  }
  /** The agent's most recent line — run summary, latest activity message, or null. */
  line: string | null
  /** Injected so tests are deterministic. */
  now?: Date
}

/** One sentence naming what stopped a run. Shared because the ping and the card must not differ. */
export function holdPingText(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `wants to: ${hold.ruleTitle} — ${hold.summary}`
    case 'question':
      return hold.question
    case 'time':
      return 'out of time — continue, or stop it'
  }
}

function clamp(line: string): string {
  return line.length <= AGENT_LINE_MAX ? line : `${line.slice(0, AGENT_LINE_MAX - 1).trimEnd()}…`
}

function heldActions(hold: Hold): ActivityAction[] {
  switch (hold.reason) {
    case 'permission':
      // "Always allow" is deliberately absent: it rewrites the rule table permanently, and a
      // half-asleep tap on a lock screen is the worst place in the product to make that change.
      return [
        { kind: 'approve', label: 'Approve' },
        { kind: 'deny', label: 'Deny' },
      ]
    case 'question': {
      const options = hold.options.slice(0, 2)
      if (options.length === 0) return [{ kind: 'open', label: 'Open' }]
      return options.map((option) => ({ kind: 'answer' as const, label: option, value: option }))
    }
    case 'time':
      return [
        { kind: 'continue', label: 'Continue' },
        { kind: 'stop', label: 'Stop' },
      ]
  }
}

/**
 * The whole state table, as one pure function. Returns null for a run that owns no card —
 * `queued` has not started and `cancelled` is a run you stopped on purpose, and neither is worth
 * the lock screen.
 */
export function runToActivityProps(src: ActivitySource): LiveActivityProps | null {
  const { ticket, run } = src
  const now = src.now ?? new Date()
  if (run.status === 'queued' || run.status === 'cancelled') return null

  const startedAt = (run.startedAt ?? now).getTime()
  const hold = run.status === 'held' ? run.hold : null

  const phase: ActivityPhase =
    run.status === 'held' ? 'yourTurn' : run.status === 'running' ? 'working' : run.status

  const agentLine = hold ? holdPingText(hold) : (src.line ?? 'working')

  const actions: ActivityAction[] = hold
    ? heldActions(hold)
    : run.status === 'failed'
      ? [
          { kind: 'rerun', label: 'Re-run' },
          { kind: 'open', label: 'Open' },
        ]
      : []

  return {
    runId: run.id,
    ticketId: ticket.id,
    title: ticket.title,
    phase,
    agentLine: clamp(agentLine),
    startedAt,
    // A zero budget means "no budget" in settings, and a bar with no end is a lie.
    ...(run.budgetMs > 0 ? { budgetEndsAt: startedAt + run.budgetMs } : {}),
    actions,
  }
}
```

Note: `held` is the only status that maps to a different word (`yourTurn`); `done` and `failed` pass through, which is why the ternary can fall through to `run.status`.

- [ ] **Step 4: Export it and run the test**

Add to `packages/shared/src/index.ts`:

```ts
export * from './liveActivity.js'
```

Run: `pnpm --filter @tada/shared exec vitest run test/liveActivity.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Move `holdPingText` off the server**

In `apps/server/src/notify.ts`, delete the `holdPingText` function body and replace it with a re-export so every existing import (`runner.ts`, `test/notify.test.ts`) keeps working unchanged:

```ts
// Lives in @tada/shared because the Live Activity card renders the same sentence the ping sends;
// two copies of it drift, and the drift is invisible until you are reading a lock screen at 3am.
export { holdPingText } from '@tada/shared'
```

Remove the now-unused `Hold` type import if nothing else in the file uses it.

- [ ] **Step 6: Verify nothing regressed**

Run: `pnpm --filter @tada/server exec vitest run test/notify.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/liveActivity.ts packages/shared/src/index.ts \
        packages/shared/test/liveActivity.test.ts apps/server/src/notify.ts
git commit -m "feat(shared): the Live Activity content-state contract"
```

---

### Task 2: The APNs client

**Files:**
- Create: `apps/server/src/apns.ts`
- Create: `apps/server/test/apns.test.ts`
- Modify: `apps/server/src/config.ts`

**Interfaces:**
- Consumes: `LiveActivityProps`, `ACTIVITY_DISMISSAL_MS` from `@tada/shared`; `Config` from `./config.js`.
- Produces: `ApnsCredentials`, `ApnsMessage`, `ApnsSender`, `apnsRequest(msg, creds): {path, headers, body}`, `apnsJwt(creds, now): string`, `createApnsSender(config): ApnsSender | undefined`, `apnsCredentials(config): ApnsCredentials | undefined`, `ACTIVITY_NAME`, `ATTRIBUTES_TYPE`.

- [ ] **Step 1: Add the config fields first (the test needs them)**

In `apps/server/src/config.ts`, add to `configFileSchema` and to `Config`:

```ts
  // APNs, for the iOS Live Activity. All five are optional: absent means the channel is dormant,
  // exactly like an unconfigured web push sender. The key is referenced by path rather than
  // inlined so the .p8 never ends up in a file that gets pasted into a terminal.
  apnsKeyPath: z.string().min(1).optional(),
  apnsKeyId: z.string().min(1).optional(),
  apnsTeamId: z.string().min(1).optional(),
  apnsBundleId: z.string().min(1).optional(),
  apnsEnv: z.enum(['sandbox', 'production']).default('sandbox'),
```

```ts
export interface Config {
  // …existing fields…
  apnsKeyPath?: string
  apnsKeyId?: string
  apnsTeamId?: string
  apnsBundleId?: string
  /** A dev build's activity tokens are only valid against the sandbox host. */
  apnsEnv: 'sandbox' | 'production'
}
```

Carry all five through the object literal that builds `config` in `loadConfig()` (`apnsKeyPath: parsed.apnsKeyPath`, and so on). Do **not** add them to the `needsKeys`/write-back condition — they are operator-supplied, not generated.

- [ ] **Step 2: Write the failing test**

Create `apps/server/test/apns.test.ts`:

```ts
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import type { LiveActivityProps } from '@tada/shared'
import { describe, expect, test } from 'vitest'
import { type ApnsCredentials, apnsJwt, apnsRequest } from '../src/apns.js'

const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const creds: ApnsCredentials = {
  key: privateKey,
  keyId: 'ABC1234567',
  teamId: 'TEAM123456',
  bundleId: 'dev.copley.tada',
  env: 'sandbox',
}

const props: LiveActivityProps = {
  runId: 4128,
  ticketId: 7,
  title: 'Add CSV export to the reports page',
  phase: 'yourTurn',
  agentLine: 'wants to: push a branch — git push origin main',
  startedAt: 1_755_500_000_000,
  actions: [{ kind: 'approve', label: 'Approve' }],
}

const now = new Date('2026-08-18T03:14:00Z')

test('an update carries the stringified props under the expo-widgets content state', () => {
  const req = apnsRequest({ token: 'ff00', event: 'update', props, priority: 10, now }, creds)
  const body = JSON.parse(req.body)

  expect(req.path).toBe('/3/device/ff00')
  expect(req.headers['apns-push-type']).toBe('liveactivity')
  expect(req.headers['apns-topic']).toBe('dev.copley.tada.push-type.liveactivity')
  expect(req.headers['apns-priority']).toBe('10')
  expect(body.aps.event).toBe('update')
  expect(body.aps.timestamp).toBe(Math.floor(now.getTime() / 1000))
  expect(body.aps['content-state'].name).toBe('TadaRun')
  // The one that breaks silently: props is a STRING, not an object.
  expect(typeof body.aps['content-state'].props).toBe('string')
  expect(JSON.parse(body.aps['content-state'].props)).toEqual(props)
})

test('a start asks for the push token back and declares the attributes type', () => {
  const req = apnsRequest(
    { token: 'ff00', event: 'start', props, priority: 5, inputPushToken: true, now },
    creds,
  )
  const body = JSON.parse(req.body)
  expect(body.aps['input-push-token']).toBe(1)
  expect(body.aps['attributes-type']).toBe('LiveActivityAttributes')
  expect(body.aps.attributes).toEqual({})
  expect(req.headers['apns-priority']).toBe('5')
})

test('an end carries a dismissal date and no alert', () => {
  const req = apnsRequest(
    { token: 'ff00', event: 'end', props, priority: 5, dismissalDate: new Date(now.getTime() + 4000), now },
    creds,
  )
  const body = JSON.parse(req.body)
  expect(body.aps.event).toBe('end')
  expect(body.aps['dismissal-date']).toBe(Math.floor((now.getTime() + 4000) / 1000))
  expect(body.aps.alert).toBeUndefined()
})

test('an alert rides along only when one is given', () => {
  const req = apnsRequest(
    { token: 'ff00', event: 'update', props, priority: 10, alert: { title: 'tada', body: 'stopped on you' }, now },
    creds,
  )
  expect(JSON.parse(req.body).aps.alert).toEqual({ title: 'tada', body: 'stopped on you' })
})

describe('the authentication token', () => {
  test('is an ES256 JWT Apple can verify, naming the key and the team', () => {
    const jwt = apnsJwt(creds, now)
    const [rawHeader, rawClaims, rawSig] = jwt.split('.')
    const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString())
    const claims = JSON.parse(Buffer.from(rawClaims, 'base64url').toString())

    expect(header).toEqual({ alg: 'ES256', kid: 'ABC1234567' })
    expect(claims).toEqual({ iss: 'TEAM123456', iat: Math.floor(now.getTime() / 1000) })

    // JOSE signatures are fixed-width r‖s (64 bytes for P-256), not the DER form createSign emits.
    const sig = Buffer.from(rawSig, 'base64url')
    expect(sig.length).toBe(64)

    const verifier = createVerify('SHA256')
    verifier.update(`${rawHeader}.${rawClaims}`)
    expect(
      verifier.verify(
        { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' },
        sig,
      ),
    ).toBe(true)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @tada/server exec vitest run test/apns.test.ts`
Expected: FAIL — cannot resolve `../src/apns.js`.

- [ ] **Step 4: Write the module**

Create `apps/server/src/apns.ts`:

```ts
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { type ClientHttp2Session, connect, constants } from 'node:http2'
import type { LiveActivityProps } from '@tada/shared'
import type { Config } from './config.js'

/** Must match `createLiveActivity('TadaRun', …)` and the widget entry in app.json. */
export const ACTIVITY_NAME = 'TadaRun'
/** The ActivityAttributes struct expo-widgets declares. Apple matches on the name. */
export const ATTRIBUTES_TYPE = 'LiveActivityAttributes'

/** Apple rejects a token older than an hour and refuses a new one more than every 20 minutes. */
const JWT_TTL_MS = 50 * 60 * 1000

export interface ApnsCredentials {
  /** PEM contents of the .p8 — not the path. */
  key: string
  keyId: string
  teamId: string
  bundleId: string
  env: 'sandbox' | 'production'
}

export interface ApnsMessage {
  /** Hex activity push token. */
  token: string
  event: 'start' | 'update' | 'end'
  props: LiveActivityProps
  /** 10 alerts the person; 5 is a quiet update that must not wake anyone. */
  priority: 5 | 10
  alert?: { title: string; body: string }
  /** `end` only. */
  dismissalDate?: Date
  /** `start` only: makes iOS background-launch the app so it can report the activity's token. */
  inputPushToken?: boolean
  /** Injected in tests. */
  now?: Date
}

export type ApnsSender = (msg: ApnsMessage) => Promise<void>

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/**
 * ES256 JWT for the APNs provider API. `createSign` emits DER; JOSE wants fixed-width r‖s, which
 * `dsaEncoding: 'ieee-p1363'` produces — get this wrong and every push comes back 403
 * InvalidProviderToken with nothing else to go on.
 */
export function apnsJwt(creds: ApnsCredentials, now: Date = new Date()): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: creds.keyId }))
  const claims = base64url(
    JSON.stringify({ iss: creds.teamId, iat: Math.floor(now.getTime() / 1000) }),
  )
  const signer = createSign('SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign({ key: creds.key, dsaEncoding: 'ieee-p1363' })
  return `${header}.${claims}.${base64url(signature)}`
}

export function apnsRequest(
  msg: ApnsMessage,
  creds: ApnsCredentials,
): { path: string; headers: Record<string, string>; body: string } {
  const now = msg.now ?? new Date()
  const aps: Record<string, unknown> = {
    timestamp: Math.floor(now.getTime() / 1000),
    event: msg.event,
    // props is a *string* inside the JSON — that is the shape expo-widgets' ContentState decodes.
    // An object here renders an empty card and reports no error anywhere.
    'content-state': { name: ACTIVITY_NAME, props: JSON.stringify(msg.props) },
  }
  if (msg.event === 'start') {
    aps['attributes-type'] = ATTRIBUTES_TYPE
    aps.attributes = {}
    if (msg.inputPushToken) aps['input-push-token'] = 1
  }
  if (msg.alert) aps.alert = msg.alert
  if (msg.dismissalDate) aps['dismissal-date'] = Math.floor(msg.dismissalDate.getTime() / 1000)

  return {
    path: `/3/device/${msg.token}`,
    headers: {
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${msg.token}`,
      authorization: `bearer ${apnsJwt(creds, now)}`,
      'apns-push-type': 'liveactivity',
      'apns-topic': `${creds.bundleId}.push-type.liveactivity`,
      'apns-priority': String(msg.priority),
      'apns-expiration': '0',
    },
    body: JSON.stringify({ aps }),
  }
}

/** A dead activity token. The only safe reason to forget one, exactly as with web push. */
export function isApnsGone(status: number, reason: string | undefined): boolean {
  return status === 410 || reason === 'BadDeviceToken' || reason === 'ExpiredToken'
}

export function apnsCredentials(config: Config): ApnsCredentials | undefined {
  const { apnsKeyPath, apnsKeyId, apnsTeamId, apnsBundleId } = config
  if (!apnsKeyPath || !apnsKeyId || !apnsTeamId || !apnsBundleId) return undefined
  try {
    return {
      key: readFileSync(apnsKeyPath, 'utf8'),
      keyId: apnsKeyId,
      teamId: apnsTeamId,
      bundleId: apnsBundleId,
      env: config.apnsEnv,
    }
  } catch (err) {
    console.error('APNs key could not be read; the Live Activity channel stays dormant:', err)
    return undefined
  }
}

/**
 * The real transport. Returns undefined when APNs is not configured, which is how the whole
 * channel stays dormant — same shape as `createWebPushSender` guarding on VAPID keys.
 *
 * One HTTP/2 session is kept and reused: Apple charges a TLS handshake per connection and will
 * GOAWAY an idle one, so the session is dropped on error and rebuilt on the next send.
 */
export function createApnsSender(config: Config): ApnsSender | undefined {
  const creds = apnsCredentials(config)
  if (!creds) return undefined

  const host =
    creds.env === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com'
  let session: ClientHttp2Session | undefined
  let jwt: { value: string; at: number } | undefined

  const getSession = (): ClientHttp2Session => {
    if (session && !session.closed && !session.destroyed) return session
    session = connect(host)
    session.on('error', () => {
      session?.destroy()
      session = undefined
    })
    return session
  }

  return async (msg) =>
    new Promise<void>((resolve) => {
      try {
        const now = msg.now ?? new Date()
        if (!jwt || now.getTime() - jwt.at > JWT_TTL_MS) {
          jwt = { value: apnsJwt(creds, now), at: now.getTime() }
        }
        const req = apnsRequest(msg, creds)
        const stream = getSession().request({ ...req.headers, authorization: `bearer ${jwt.value}` })

        let status = 0
        let payload = ''
        stream.on('response', (headers) => {
          status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0)
        })
        stream.setEncoding('utf8')
        stream.on('data', (chunk: string) => {
          payload += chunk
        })
        stream.on('end', () => {
          if (status !== 200) {
            const reason = (() => {
              try {
                return JSON.parse(payload).reason as string | undefined
              } catch {
                return undefined
              }
            })()
            // Never log the token: it is a capability to push to that device.
            console.error(`apns send failed: HTTP ${status} ${reason ?? ''}`.trim())
          }
          resolve()
        })
        stream.on('error', (err) => {
          console.error('apns send failed:', err)
          session?.destroy()
          session = undefined
          resolve()
        })
        stream.end(req.body)
      } catch (err) {
        console.error('apns send failed:', err)
        resolve()
      }
    })
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @tada/server exec vitest run test/apns.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/apns.ts apps/server/src/config.ts apps/server/test/apns.test.ts
git commit -m "feat(server): APNs provider client for Live Activity pushes"
```

---

### Task 3: Token storage and routes

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/<generated>.sql` (via drizzle-kit)
- Modify: `apps/server/src/routes/runs.ts` (beside `POST /push-tokens`, around line 299)
- Create: `apps/server/test/liveActivityRoutes.test.ts`

**Interfaces:**
- Produces: tables `liveActivityStartTokens` (`id`, `token` unique, `createdAt`) and `liveActivitySessions` (`id`, `runId`, `pushToken` nullable, `lastProps` nullable, `startedAt`, `endedAt` nullable); routes `POST /live-activity/start-token`, `POST /live-activity/tokens`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/liveActivityRoutes.test.ts`:

```ts
import { expect, test } from 'vitest'
import { liveActivitySessions, liveActivityStartTokens } from '../src/db/schema.js'
import { makeTestApp } from './helpers/testApp.js'

test('a push-to-start token is stored once, however many times it is sent', async () => {
  const { db, json } = await makeTestApp()

  const first = await json({ method: 'POST', url: '/live-activity/start-token', payload: { token: 'aa11' } })
  expect(first.status).toBe(201)
  await json({ method: 'POST', url: '/live-activity/start-token', payload: { token: 'aa11' } })

  expect(db.drizzle.select().from(liveActivityStartTokens).all()).toHaveLength(1)
})

test('a start token is rejected when it is missing', async () => {
  const { json } = await makeTestApp()
  const res = await json({ method: 'POST', url: '/live-activity/start-token', payload: {} })
  expect(res.status).toBe(400)
})

test('an activity token binds to the newest session that has none', async () => {
  const { db, json } = await makeTestApp()
  db.drizzle
    .insert(liveActivitySessions)
    .values([
      { runId: 1, pushToken: 'old', startedAt: new Date(1), endedAt: new Date(2) },
      { runId: 2, pushToken: null, startedAt: new Date(3), endedAt: null },
    ])
    .run()

  const res = await json({ method: 'POST', url: '/live-activity/tokens', payload: { token: 'bb22' } })
  expect(res.status).toBe(201)

  const rows = db.drizzle.select().from(liveActivitySessions).all()
  expect(rows.find((r) => r.runId === 2)?.pushToken).toBe('bb22')
  expect(rows.find((r) => r.runId === 1)?.pushToken).toBe('old')
})

test('an activity token with nothing to bind to is accepted and dropped', async () => {
  const { json } = await makeTestApp()
  const res = await json({ method: 'POST', url: '/live-activity/tokens', payload: { token: 'cc33' } })
  expect(res.status).toBe(201)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @tada/server exec vitest run test/liveActivityRoutes.test.ts`
Expected: FAIL — `liveActivityStartTokens` is not exported from schema.

- [ ] **Step 3: Add the tables**

In `apps/server/src/db/schema.ts`, after `webPushSubscriptions`:

```ts
/**
 * Push-to-start tokens (iOS 17.2+). One per device, and it outlives every run: it is what lets
 * the server put a card on a locked phone whose app has never been opened tonight.
 */
export const liveActivityStartTokens = sqliteTable('live_activity_start_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  createdAt: createdAt(),
})

/**
 * One row per Live Activity the server has started. `pushToken` is null until the app reports it —
 * iOS hands the token to the app, not to us, and gives no way to say which run it belongs to,
 * which is why only one session is ever open at a time (see src/liveActivity.ts).
 *
 * `lastProps` is the JSON last pushed, kept so an event that changes nothing on the card sends
 * nothing to Apple.
 */
export const liveActivitySessions = sqliteTable('live_activity_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull(),
  pushToken: text('push_token'),
  lastProps: text('last_props'),
  startedAt: integer('started_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
})
```

- [ ] **Step 4: Generate and commit the migration**

Run: `pnpm --filter @tada/server exec drizzle-kit generate`
Expected: a new file under `apps/server/drizzle/` creating both tables.

- [ ] **Step 5: Add the routes**

In `apps/server/src/routes/runs.ts`, after `POST /push-tokens`:

```ts
  // The device's push-to-start token. Idempotent: the app re-registers on every launch.
  app.post('/live-activity/start-token', async (req, reply) => {
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    db.drizzle
      .insert(liveActivityStartTokens)
      .values({ token: parsed.data.token })
      .onConflictDoNothing()
      .run()
    return reply.code(201).send({ ok: true })
  })

  // A specific activity's update token, read by the app from ActivityKit. It carries no run id —
  // iOS does not provide one — so it binds to the newest session still waiting for a token.
  app.post('/live-activity/tokens', async (req, reply) => {
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    bindActivityToken(db, parsed.data.token)
    deps.liveActivity?.sync()
    return reply.code(201).send({ ok: true })
  })
```

Import `liveActivityStartTokens` from `../db/schema.js` and `bindActivityToken` from `../liveActivity.js`. `deps.liveActivity` is added in Task 5 — for now, write the route without the `deps.liveActivity?.sync()` line and add it in Task 5, so this task compiles on its own.

- [ ] **Step 6: Write `bindActivityToken` (minimum for this task)**

Create `apps/server/src/liveActivity.ts` with only the binder for now; the policy arrives in Task 4:

```ts
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { TadaDb } from './db/index.js'
import { liveActivitySessions } from './db/schema.js'

/**
 * Binds a token the app just read off ActivityKit to the session it must belong to: the newest
 * one still open and still tokenless. This is the whole reason only one activity exists at a
 * time — iOS returns a token with no way to say which activity, and therefore which run, it is
 * for. A token with nothing to bind to is dropped: the activity it belongs to is already over.
 */
export function bindActivityToken(db: TadaDb, token: string): void {
  const target = db.drizzle
    .select()
    .from(liveActivitySessions)
    .where(and(isNull(liveActivitySessions.endedAt), isNull(liveActivitySessions.pushToken)))
    .orderBy(desc(liveActivitySessions.startedAt))
    .get()
  if (!target) return
  db.drizzle
    .update(liveActivitySessions)
    .set({ pushToken: token })
    .where(eq(liveActivitySessions.id, target.id))
    .run()
}
```

- [ ] **Step 7: Run the test**

Run: `pnpm --filter @tada/server exec vitest run test/liveActivityRoutes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle apps/server/src/routes/runs.ts \
        apps/server/src/liveActivity.ts apps/server/test/liveActivityRoutes.test.ts
git commit -m "feat(server): live activity token storage and registration routes"
```

---

### Task 4: The focus policy

**Files:**
- Modify: `apps/server/src/liveActivity.ts`
- Create: `apps/server/test/liveActivity.test.ts`

**Interfaces:**
- Consumes: `ApnsSender`, `ApnsMessage` from `./apns.js`; `runToActivityProps`, `ACTIVITY_DISMISSAL_MS` from `@tada/shared`; `bindActivityToken` from Task 3.
- Produces: `LiveActivityChannel { sync(): void }`, `createLiveActivityChannel(deps: {db: TadaDb; send: ApnsSender}): LiveActivityChannel`, `focusRunId(db): number | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/liveActivity.test.ts`:

```ts
import type { Hold, RunStatus } from '@tada/shared'
import { expect, test } from 'vitest'
import type { ApnsMessage } from '../src/apns.js'
import type { TadaDb } from '../src/db/index.js'
import { agentRuns, liveActivitySessions, liveActivityStartTokens, tickets } from '../src/db/schema.js'
import { createLiveActivityChannel } from '../src/liveActivity.js'
import { makeTestApp } from './helpers/testApp.js'

/** A ticket and a run in a given state, straight into the tables — no scheduler involved. */
function seedRun(
  db: TadaDb,
  state: { status: RunStatus; hold?: Hold | null; startedAt?: Date; title?: string },
): number {
  const ticket = db.drizzle
    .insert(tickets)
    // `position` is notNull with no default — fractional ordering, so any number will do here.
    .values({ title: state.title ?? 'Add CSV export to the reports page', column: 'running', position: 1 })
    .returning()
    .get()
  const run = db.drizzle
    .insert(agentRuns)
    .values({
      ticketId: ticket.id,
      adapter: 'fake',
      model: 'fake',
      status: state.status,
      hold: state.hold ?? null,
      heldReason: state.hold?.reason ?? null,
      budgetMs: 1_800_000,
      runToken: `token-${ticket.id}`,
      startedAt: state.startedAt ?? new Date(),
    })
    .returning()
    .get()
  return run.id
}

const permissionHold: Hold = {
  reason: 'permission',
  tool: 'Bash',
  summary: 'git push origin main',
  ruleId: 1,
  ruleTitle: 'push a branch',
  publishes: true,
}

test('the first live run gets the card, and the start asks for its token back', async () => {
  const t = await makeTestApp()
  t.db.drizzle.insert(liveActivityStartTokens).values({ token: 'start-1' }).run()
  const sent: ApnsMessage[] = []
  const channel = createLiveActivityChannel({ db: t.db, send: async (m) => void sent.push(m) })

  seedRun(t.db, { status: 'running' })
  channel.sync()

  expect(sent).toHaveLength(1)
  expect(sent[0]?.event).toBe('start')
  expect(sent[0]?.token).toBe('start-1')
  expect(sent[0]?.inputPushToken).toBe(true)
  expect(sent[0]?.props.phase).toBe('working')
  expect(t.db.drizzle.select().from(liveActivitySessions).all()).toHaveLength(1)
})

test('nothing is pushed while the session has no activity token yet', async () => {
  // start goes to the start token; updates need the per-activity token, which the app reports later
})

test('a held run takes the card from a merely working one', async () => {
  // seed run A running (session open, token bound), then run B held; sync
  // expect: an `end` for A's activity, then a `start` for B
})

test('an event that changes nothing on the card sends nothing', async () => {
  // sync twice with no state change; expect one push, not two
})

test('a run that stops on you is pushed at priority 10 with an alert; working is 5 and silent', async () => {})

test('a finished run gets a terminal card, then an end four seconds out', async () => {
  // expect: update with phase 'done', then end with dismissalDate ≈ now + ACTIVITY_DISMISSAL_MS
  // and the session row closed
})

test('with no APNs sender configured the channel is undefined and nothing is stored', async () => {
  // createLiveActivityChannel is only built when a sender exists; assert index.ts's guard shape
  // by calling createApnsSender with an empty config and expecting undefined
})
```

Fill each stub in as you go — the point of listing them here is that all seven behaviours are required; do not delete one because it is awkward to seed.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @tada/server exec vitest run test/liveActivity.test.ts`
Expected: FAIL — `createLiveActivityChannel` is not exported.

- [ ] **Step 3: Write the policy**

Append to `apps/server/src/liveActivity.ts`:

```ts
export interface LiveActivityChannel {
  /**
   * Recompute which run owns the lock screen and push whatever actually changed. Every run
   * lifecycle event calls this and nothing else — one entry point means the card cannot get out
   * of step with the board, whatever order events arrive in.
   */
  sync(): void
}

/**
 * The focused run: the one run that owns the single Live Activity. A run that wants you outranks
 * a run that is merely working; between equals, the most recent wins. Everything else is
 * non-focused and simply has no card — it still pings, and it still sits on the board.
 */
export function focusRunId(db: TadaDb): number | null {
  const live = db.drizzle
    .select()
    .from(agentRuns)
    .where(inArray(agentRuns.status, ['running', 'held']))
    .all()
  if (live.length === 0) return null
  const rank = (r: (typeof live)[number]) => (r.status === 'held' ? 1 : 0)
  const best = live.reduce((a, b) => {
    if (rank(b) !== rank(a)) return rank(b) > rank(a) ? b : a
    return (b.startedAt?.getTime() ?? 0) > (a.startedAt?.getTime() ?? 0) ? b : a
  })
  return best.id
}
```

Then `createLiveActivityChannel`, whose `sync()` runs this sequence:

1. Read the open session (`endedAt is null`) and `focusRunId(db)`.
2. **The open session is not the focused run** (or there is no focus): close it. Load its run and ticket; if the run is terminal, push `update` with the terminal props, then push `end` with `dismissalDate = now + ACTIVITY_DISMISSAL_MS`; otherwise push `end` with no dismissal delay. Set `endedAt`. Both pushes need the session's `pushToken` — with no token there is nothing to push, so just close the row.
3. **There is a focused run and no open session**: build props with `runToActivityProps`, insert a session row (`pushToken: null`, `lastProps` = the JSON), and push `start` with `inputPushToken: true` to **every** row in `liveActivityStartTokens`. With no start tokens, insert nothing and return — a card cannot be started, and inserting a session would strand the next reported token against a run that has no activity.
4. **The open session is the focused run**: build props; if `JSON.stringify(props) === session.lastProps`, return. Otherwise store `lastProps` and, when `pushToken` is present, push `update`.

Priority and alert come from the phase, in one helper:

```ts
/**
 * `yourTurn` and `failed` are the only two states allowed to alert. A run that is merely working
 * updates at priority 5 and stays silent — the entire point of an overnight agent is that it does
 * not wake you.
 */
function delivery(props: LiveActivityProps, title: string): Pick<ApnsMessage, 'priority' | 'alert'> {
  if (props.phase === 'yourTurn') {
    return { priority: 10, alert: { title: `"${title}" is stopped on you`, body: props.agentLine } }
  }
  if (props.phase === 'failed') {
    return { priority: 10, alert: { title: `"${title}" failed`, body: props.agentLine } }
  }
  return { priority: 5 }
}
```

Every push is `void send(msg).catch(() => {})` — `sync()` returns immediately and never throws, because it is called from the runner's hot path.

The agent's line for a non-held run comes from the run's `summary` when it has one, else the newest `activity` row for that run, else null; write that as a small `latestLine(db, runId, run)` helper next to `focusRunId`.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @tada/server exec vitest run test/liveActivity.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the whole server suite**

Run: `pnpm --filter @tada/server exec vitest run`
Expected: PASS — nothing else touches these tables yet.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/liveActivity.ts apps/server/test/liveActivity.test.ts
git commit -m "feat(server): one live activity, focused on the run that most wants you"
```

---

### Task 5: Wire the channel into the run lifecycle

**Files:**
- Modify: `apps/server/src/runs/runner.ts:52-69` (deps) and every `hub.boardChanged()` site
- Modify: `apps/server/src/runs/scheduler.ts` (pass through)
- Modify: `apps/server/src/app.ts` (deps)
- Modify: `apps/server/src/routes/runs.ts` (the `sync()` line deferred from Task 3)
- Modify: `apps/server/src/index.ts` (construction)
- Create: `apps/server/test/liveActivityLifecycle.test.ts`

**Interfaces:**
- Consumes: `LiveActivityChannel` from `../liveActivity.js`, `createApnsSender` from `../apns.js`.
- Produces: `RunnerDeps.liveActivity?: LiveActivityChannel`; `AppDeps.liveActivity?: LiveActivityChannel`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/liveActivityLifecycle.test.ts`, driving a real run with `TADA_FAKE_ADAPTER`-style scripting (copy the setup from `test/runner.test.ts`) and a channel stub that counts calls:

```ts
test('the card syncs when a run starts, when it holds, when it resumes, and when it ends', async () => {
  let syncs = 0
  const liveActivity = { sync: () => void syncs++ }
  // …stand up a fake-adapter run that gates once, approve it, let it finish…
  expect(syncs).toBeGreaterThanOrEqual(4)
})

test('a channel that throws cannot fail a run', async () => {
  const liveActivity = { sync: () => { throw new Error('apns is down') } }
  // …run the same script; the run must still reach `done`…
})
```

The second test is the important one: it pins the "a lock screen must never fail a run" rule.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @tada/server exec vitest run test/liveActivityLifecycle.test.ts`
Expected: FAIL — `liveActivity` is not a `RunnerDeps` field.

- [ ] **Step 3: Add the dep and the call sites**

In `apps/server/src/runs/runner.ts`, add to `RunnerDeps`:

```ts
  /** Drives the iOS Live Activity. Absent in tests and when APNs is not configured. */
  liveActivity?: LiveActivityChannel
```

Then, immediately after **every** `hub.boardChanged()` inside `runner.ts`, add:

```ts
    syncActivity()
```

with one local helper defined next to the other closures:

```ts
  // The lock screen follows the board exactly, so it is refreshed wherever the board is. Wrapped
  // because a notification surface must never be able to fail a run — see markFailed's contract.
  const syncActivity = (): void => {
    try {
      deps.liveActivity?.sync()
    } catch (err) {
      console.error('live activity sync failed:', err)
    }
  }
```

The sites are: after the run is marked running, `enterHold`, each hold resolution path, `markFailed`, `markCancelled`, and the done path.

- [ ] **Step 4: Thread it through**

`scheduler.ts`: add `liveActivity?: LiveActivityChannel` to its options and pass it into the `RunnerDeps` it builds.
`app.ts`: add `liveActivity?: LiveActivityChannel` to the app deps and pass it to `registerRunRoutes` so the token route added in Task 3 can call `deps.liveActivity?.sync()` — add that line now.
`index.ts`:

```ts
  const apns = createApnsSender(config)
  // Dormant without APNs credentials, exactly like the web push sender without VAPID keys.
  const liveActivity = apns ? createLiveActivityChannel({ db, send: apns }) : undefined
```

and pass `liveActivity` into both the `Scheduler` options and `buildApp`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @tada/server exec vitest run`
Expected: PASS, including the two new lifecycle tests.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src apps/server/test/liveActivityLifecycle.test.ts
git commit -m "feat(server): drive the live activity from the run lifecycle"
```

---

### Task 6: The native target

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/app.json`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Produces: a prebuildable iOS project with a `TadaRun` Live Activity target. Nothing importable yet.

- [ ] **Step 1: Install the packages**

Run: `pnpm --filter @tada/mobile exec expo install expo-widgets @expo/ui`
Expected: `expo-widgets@~57.0.10` and `@expo/ui@~57.0.11` in `apps/mobile/package.json`.

- [ ] **Step 2: Confirm the directive spelling before writing any widget code**

Read `node_modules/expo-widgets/build/Widgets.d.ts` and the package's `bundle/` directory, and search the installed `expo` babel preset for the widget directive. The docs say the layout function is "marked with the `'widget'` directive"; whatever the installed version actually parses is what Task 7 must use. Write the exact string into this plan's Task 7 step 3 before starting it.

- [ ] **Step 3: Configure the app**

In `apps/mobile/app.json`, set the identifiers and add the plugin:

```json
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "dev.copley.tada",
      "appleTeamId": "<your team id>"
    },
```

```json
      [
        "expo-widgets",
        {
          "bundleIdentifier": "dev.copley.tada.widgets",
          "groupIdentifier": "group.dev.copley.tada",
          "enablePushNotifications": true,
          "widgets": [{ "name": "TadaRun", "displayName": "tada run" }]
        }
      ]
```

`enablePushNotifications: true` is what makes the plugin set `NSSupportsLiveActivities` and makes `Activity.request` use `pushType: .token` — without it the server can never update a card.

- [ ] **Step 4: Keep the repo CNG**

Add to `.gitignore` if not already present:

```
/apps/mobile/ios/
/apps/mobile/android/
```

- [ ] **Step 5: Prove it prebuilds**

Run: `cd apps/mobile && npx expo prebuild -p ios --clean`
Expected: succeeds, and `ios/` contains a `TadaRun`/`ExpoWidgetsTarget` extension target alongside the app. Confirm `ios/tada/Info.plist` has `NSSupportsLiveActivities`.

- [ ] **Step 6: Document the new build story**

In `README.md`, under the mobile section, add that iOS now needs a dev build:

```md
The iOS app carries a Live Activity extension, so it no longer runs in Expo Go:

    pnpm --filter @tada/mobile exec expo prebuild -p ios
    pnpm --filter @tada/mobile exec expo run:ios

`ios/` is generated and not committed. Android and web are unaffected — `pnpm --filter @tada/mobile start` still works there.
```

Also record the APNs settings the server needs in `config.json`: `apnsKeyPath`, `apnsKeyId`, `apnsTeamId`, `apnsBundleId` (`dev.copley.tada`), `apnsEnv` (`sandbox` for a dev build, `production` for TestFlight).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.json pnpm-lock.yaml .gitignore README.md
git commit -m "build(mobile): add the iOS Live Activity target"
```

---

### Task 7: The design

**Files:**
- Create: `apps/mobile/src/liveActivity/chrome.ts`
- Create: `apps/mobile/src/liveActivity/TadaRunActivity.tsx`
- Create: `apps/mobile/test/liveActivityChrome.test.ts`

**Interfaces:**
- Consumes: `LiveActivityProps`, `ActivityAction` from `@tada/shared`; `night` from `../design/tokens`.
- Produces: `phaseChrome(phase): {dot: string; text: string; label: string}`, `WIDGET_INK` (the opaque color set), and the default-exported `TadaRunActivity` factory from `createLiveActivity('TadaRun', …)`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/liveActivityChrome.test.ts`:

```ts
import { night } from '../src/design/tokens'
import { phaseChrome, WIDGET_INK } from '../src/liveActivity/chrome'

test('orange is live for both working and your turn', () => {
  expect(phaseChrome('working').dot).toBe(night.live)
  expect(phaseChrome('yourTurn').dot).toBe(night.live)
})

test('sage is done and red is failure, and nothing else has a color', () => {
  expect(phaseChrome('done').dot).toBe(night.ok)
  expect(phaseChrome('failed').dot).toBe(night.fail)
})

test('each phase names itself in the compact presentation', () => {
  expect(phaseChrome('yourTurn').label).toBe('your turn')
  expect(phaseChrome('done').label).toBe('done')
  expect(phaseChrome('failed').label).toBe('failed')
  // working has no label: the compact trailing draws a live timer instead.
  expect(phaseChrome('working').label).toBe('')
})

test('every widget color is opaque — SwiftUI takes 6-digit hex only', () => {
  for (const [name, value] of Object.entries(WIDGET_INK)) {
    expect(`${name}=${value}`).toMatch(/=#[0-9A-Fa-f]{6}$/)
  }
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @tada/mobile exec jest test/liveActivityChrome.test.ts`
Expected: FAIL — cannot resolve `../src/liveActivity/chrome`.

- [ ] **Step 3: Write the chrome module**

Create `apps/mobile/src/liveActivity/chrome.ts`:

```ts
import type { ActivityPhase } from '@tada/shared'
import { night } from '../design/tokens'

/**
 * The widget's palette. Every value is opaque: the SwiftUI bridge parses 6-digit hex, and the
 * night palette's hairlines are 8-digit (`#F0EADD14`), which would silently render as nothing.
 * These are those tokens composited onto their own surface, once, by hand.
 */
export const WIDGET_INK = {
  ground: night.ground,
  raised: night.raised,
  recessed: night.recessed,
  text: night.text,
  textMuted: night.textMuted,
  /** night.textFaintSolid — the mono labels. */
  textFaint: night.textFaintSolid,
  agentSurface: night.agentSurface,
  /** night.agentSurfaceEdge (#F0EADD0F) over agentSurface. */
  agentSurfaceEdge: '#1A1614',
  agentText: night.agentText,
  agentPrompt: night.agentPrompt,
  /** night.borderSubtle (#F0EADD14) over raised. */
  borderSubtle: '#2A241E',
  controlBg: night.controlBg,
  primaryBg: night.primaryBg,
  primaryText: night.primaryText,
  live: night.live,
  liveText: night.liveText,
  ok: night.ok,
  okText: night.okText,
  fail: night.fail,
  failText: night.failText,
} as const

/** The dot, the mono text color, and the two-word name each phase gives itself. */
export function phaseChrome(phase: ActivityPhase): { dot: string; text: string; label: string } {
  switch (phase) {
    // Orange is live — working *and* stopped on you. The label is empty for working because the
    // compact trailing draws a running timer there instead.
    case 'working':
      return { dot: WIDGET_INK.live, text: WIDGET_INK.liveText, label: '' }
    case 'yourTurn':
      return { dot: WIDGET_INK.live, text: WIDGET_INK.liveText, label: 'your turn' }
    case 'done':
      return { dot: WIDGET_INK.ok, text: WIDGET_INK.okText, label: 'done' }
    case 'failed':
      return { dot: WIDGET_INK.fail, text: WIDGET_INK.failText, label: 'failed' }
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @tada/mobile exec jest test/liveActivityChrome.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the activity**

Create `apps/mobile/src/liveActivity/TadaRunActivity.tsx`. Use the directive confirmed in Task 6 step 2 (written here as `'widget'`).

```tsx
import type { ActivityAction, LiveActivityProps } from '@tada/shared'
import { Button, Circle, HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import {
  background,
  cornerRadius,
  font,
  foregroundColor,
  frame,
  lineLimit,
  padding,
} from '@expo/ui/swift-ui/modifiers'
import { activityBackgroundTint, widgetURL } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity } from 'expo-widgets'
import { phaseChrome, WIDGET_INK } from './chrome'

const MONO = 'IBMPlexMono-Regular'
const SANS = 'InstrumentSans-Regular'

/** The agent's well: lowercase mono on recessed ink, one line, never two. */
function AgentWell({ line }: { line: string }) {
  return (
    <HStack
      spacing={8}
      modifiers={[
        background(WIDGET_INK.agentSurface),
        cornerRadius(8),
        padding({ top: 9, bottom: 9, leading: 12, trailing: 12 }),
      ]}
    >
      <Text modifiers={[font({ family: MONO, size: 12 }), foregroundColor(WIDGET_INK.agentPrompt)]}>
        ▸
      </Text>
      <Text
        modifiers={[
          font({ family: MONO, size: 12 }),
          foregroundColor(WIDGET_INK.agentText),
          lineLimit(1),
        ]}
      >
        {line}
      </Text>
    </HStack>
  )
}

/** Two actions maximum — that is the whole budget for a lock screen. */
function Actions({ actions }: { actions: ActivityAction[] }) {
  if (actions.length === 0) return null
  return (
    <HStack spacing={8}>
      {actions.map((action, index) => (
        <Button
          key={`${action.kind}:${action.value ?? action.label}`}
          // `target` is what comes back through addUserInteractionListener; interactions.ts
          // parses it, so the format is a contract between those two files.
          testID={`${action.kind}:${action.value ?? ''}`}
          modifiers={[
            background(index === 0 ? WIDGET_INK.primaryBg : WIDGET_INK.controlBg),
            cornerRadius(5),
            frame({ maxWidth: Number.POSITIVE_INFINITY, height: 40 }),
          ]}
        >
          <Text
            modifiers={[
              font({ family: SANS, size: 14, weight: index === 0 ? 'semibold' : 'medium' }),
              foregroundColor(index === 0 ? WIDGET_INK.primaryText : WIDGET_INK.text),
            ]}
          >
            {action.label}
          </Text>
        </Button>
      ))}
    </HStack>
  )
}

export const TadaRunActivity = createLiveActivity<LiveActivityProps>('TadaRun', (props) => {
  'widget'
  const chrome = phaseChrome(props.phase)
  const started = new Date(props.startedAt)

  const header = (
    <HStack>
      <Text modifiers={[font({ family: MONO, size: 11 }), foregroundColor(WIDGET_INK.textFaint)]}>
        {`tada✱ · run ${props.runId}`}
      </Text>
      <Spacer />
      {props.phase === 'working' ? (
        <Text
          timerInterval={{ lower: started, upper: new Date(props.budgetEndsAt ?? Date.now()) }}
          countsDown={false}
          modifiers={[font({ family: MONO, size: 11 }), foregroundColor(chrome.text)]}
        />
      ) : (
        <Text modifiers={[font({ family: MONO, size: 11 }), foregroundColor(chrome.text)]}>
          {chrome.label}
        </Text>
      )}
    </HStack>
  )

  const body = (
    <VStack spacing={11} alignment="leading">
      {header}
      <Text
        modifiers={[
          font({ family: SANS, size: 16, weight: 'semibold' }),
          foregroundColor(WIDGET_INK.text),
          lineLimit(2),
        ]}
      >
        {props.title}
      </Text>
      <AgentWell line={props.agentLine} />
      {props.phase === 'working' && props.budgetEndsAt ? (
        <ProgressView
          // The budget consumed — the one honest progress tada has. A run without a budget
          // draws no bar at all rather than a made-up one.
          modifiers={[foregroundColor(WIDGET_INK.live)]}
          value={Math.min(1, (Date.now() - props.startedAt) / (props.budgetEndsAt - props.startedAt))}
        />
      ) : null}
      <Actions actions={props.actions} />
    </VStack>
  )

  return {
    banner: (
      <VStack
        modifiers={[
          activityBackgroundTint(WIDGET_INK.raised),
          widgetURL(`tada://runs/${props.runId}`),
          padding({ top: 14, bottom: 13, leading: 15, trailing: 15 }),
        ]}
      >
        {body}
      </VStack>
    ),
    minimal: <Circle modifiers={[background(chrome.dot), frame({ width: 11, height: 11 })]} />,
    compactLeading: <Circle modifiers={[background(chrome.dot), frame({ width: 9, height: 9 })]} />,
    compactTrailing:
      props.phase === 'working' ? (
        <Text
          timerInterval={{ lower: started, upper: new Date(props.budgetEndsAt ?? Date.now()) }}
          countsDown={false}
          modifiers={[font({ family: MONO, size: 12 }), foregroundColor(chrome.text)]}
        />
      ) : (
        <Text modifiers={[font({ family: MONO, size: 12 }), foregroundColor(chrome.text)]}>
          {chrome.label}
        </Text>
      ),
    expandedCenter: (
      <VStack spacing={11} alignment="leading" modifiers={[widgetURL(`tada://runs/${props.runId}`)]}>
        {header}
        <Text
          modifiers={[
            font({ family: SANS, size: 15, weight: 'semibold' }),
            foregroundColor(WIDGET_INK.text),
            lineLimit(2),
          ]}
        >
          {props.title}
        </Text>
        <AgentWell line={props.agentLine} />
      </VStack>
    ),
    expandedBottom: <Actions actions={props.actions} />,
  }
})
```

Two things to verify against the installed typings while writing this, and adjust rather than fight: `ProgressView`'s value prop name, and whether `Button` exposes an `onPress` returning props (the `decorator.ts` in `expo-widgets/bundle` shows how presses are matched to targets). If `testID` is not what surfaces as the interaction `target`, use whatever prop `decorateInteractiveTargets` reads — and update `interactions.ts` in Task 8 to parse that same string.

If the two embedded font families do not resolve in the extension, drop `family` and use `font({ design: 'monospaced', size })` for the agent's voice and plain `font({ size })` for yours — record which you shipped in a comment at the top of the file.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @tada/mobile exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/liveActivity apps/mobile/test/liveActivityChrome.test.ts
git commit -m "feat(mobile): draw the run's live activity"
```

---

### Task 8: Registration and buttons

**Files:**
- Create: `apps/mobile/src/liveActivity/interactions.ts`
- Create: `apps/mobile/src/liveActivity/register.ts`
- Modify: `apps/mobile/src/api/client.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/test/liveActivityChrome.test.ts` (add the interactions block)

**Interfaces:**
- Consumes: `TadaClient` from `../api/client`; `TadaRunActivity` from `./TadaRunActivity`.
- Produces: `parseTarget(target: string): ActivityAction | null`, `actionRequest(props, action): {path: string; body: Record<string, unknown>}`, `registerLiveActivity(client: TadaClient): void`, `client.registerLiveActivityStartToken(token)`, `client.registerLiveActivityToken(token)`.

- [ ] **Step 1: Write the failing test**

Append to `apps/mobile/test/liveActivityChrome.test.ts`:

```ts
import { actionRequest, parseTarget } from '../src/liveActivity/interactions'

const props = {
  runId: 4128, ticketId: 7, title: 't', phase: 'yourTurn' as const,
  agentLine: 'l', startedAt: 0, actions: [],
}

test('a button target round-trips to the action it was drawn from', () => {
  expect(parseTarget('approve:')).toEqual({ kind: 'approve', label: 'Approve' })
  expect(parseTarget('answer:Postgres')).toEqual({ kind: 'answer', label: 'Postgres', value: 'Postgres' })
  expect(parseTarget('nonsense')).toBeNull()
})

test('each action names the route it calls', () => {
  expect(actionRequest(props, { kind: 'approve', label: 'Approve' })).toEqual({
    path: '/runs/4128/approve',
    body: { alwaysAllow: false },
  })
  expect(actionRequest(props, { kind: 'deny', label: 'Deny' })).toEqual({
    path: '/runs/4128/deny',
    body: { note: 'denied from the lock screen' },
  })
  expect(actionRequest(props, { kind: 'answer', label: 'Postgres', value: 'Postgres' })).toEqual({
    path: '/runs/4128/answer',
    body: { answer: 'Postgres' },
  })
  expect(actionRequest(props, { kind: 'stop', label: 'Stop' })).toEqual({
    path: '/runs/4128/cancel',
    body: {},
  })
  // Re-run is filed against the ticket, not the run — which is why ticketId rides in the props.
  expect(actionRequest(props, { kind: 'rerun', label: 'Re-run' })).toEqual({
    path: '/tickets/7/rerun',
    body: {},
  })
  expect(actionRequest(props, { kind: 'open', label: 'Open' })).toBeNull()
})
```

Check the exact request bodies `/approve`, `/deny`, `/answer` and `/continue` accept in `apps/server/src/routes/runs.ts:182-298` and match them here — these assertions must mirror the real schemas, not a guess.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @tada/mobile exec jest test/liveActivityChrome.test.ts`
Expected: FAIL — cannot resolve `../src/liveActivity/interactions`.

- [ ] **Step 3: Write `interactions.ts`**

Pure functions only — no imports from `expo-widgets`, so jest can load it. `parseTarget` splits on the first `:`; `actionRequest` maps `kind` to path and body, returning `null` for `open` (which needs no call — the app is already being brought forward).

- [ ] **Step 4: Add the client methods**

In `apps/mobile/src/api/client.ts`, beside `registerPushToken`:

```ts
  registerLiveActivityStartToken(token: string) { /* POST /live-activity/start-token */ },
  registerLiveActivityToken(token: string) { /* POST /live-activity/tokens */ },
```

Match the existing method style exactly.

- [ ] **Step 5: Write `register.ts`**

```ts
/**
 * Live Activity wiring, registered at module scope rather than in an effect. A button press is a
 * LiveActivityIntent: iOS runs it in this app's process, background-launching the app if it is
 * not running — and a background launch may never render a component, so an effect-based listener
 * would miss exactly the press that matters most.
 */
```

It must:

1. `addPushToStartTokenListener` → `client.registerLiveActivityStartToken(event.activityPushToStartToken)`.
2. On every launch, `TadaRunActivity.getInstances()` → `getPushToken()` → `client.registerLiveActivityToken(token)` for each non-null. Re-posting a known token is a no-op server-side.
3. `addUserInteractionListener` → `parseTarget(event.target)` → optimistic `instance.update({...props, phase: 'working', agentLine: 'sending…', actions: []})` → `actionRequest` → the API call.
4. **On failure**, `instance.update({...props, phase: 'failed', agentLine: "couldn't reach tada — open the app", actions: [{kind: 'open', label: 'Open'}]})`. A gate that silently fails to be approved is worse than one that admits it needs the app.
5. Guard everything with `Platform.OS === 'ios'` and swallow every error, the way `push.ts` does — a broken Live Activity must never break app startup.

Because the app can be background-launched without a foreground session, `register.ts` reads credentials through the same `src/settings.ts` store `push.ts` uses rather than assuming a live `ConnectionContext`.

- [ ] **Step 6: Mount it**

In `apps/mobile/app/_layout.tsx`, import the module for its side effect near the other root-level imports, with a comment saying why it is not a hook.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @tada/mobile exec jest && pnpm typecheck && pnpm lint`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src apps/mobile/test apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): register live activity tokens and act on its buttons"
```

---

### Task 9: Verify on a device, and write down what it does

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Full local verification**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all three clean. Record the output; do not claim the feature works off a green unit suite alone.

- [ ] **Step 2: Configure APNs on the server**

Put the `.p8` somewhere readable only by the server account, and add `apnsKeyPath`, `apnsKeyId`, `apnsTeamId`, `apnsBundleId: 'dev.copley.tada'`, `apnsEnv: 'sandbox'` to `config.json`. Restart the server and confirm the log shows no APNs errors at boot.

- [ ] **Step 3: Device run-through**

Install a dev build on a real iPhone (the Dynamic Island does not exist in the simulator), then, with the phone **locked**:

1. Queue a ticket → a card appears with the ticket title and `working`, and the island shows a dot and a running clock.
2. Let it hit a gate → the card changes to `your turn` with Approve/Deny, and it alerts.
3. Approve from the lock screen → the run resumes and the card returns to `working` without the app being opened.
4. Long-press the island → the expanded presentation matches the design.
5. Let a run fail → red, with Re-run.
6. Let a run finish → sage `done`, gone about four seconds later.
7. Airplane mode, then press Approve → the card says `couldn't reach tada — open the app`.

- [ ] **Step 4: Document it**

In `CLAUDE.md`, add a short subsection under the mobile architecture notes: the activity's UI lives in `src/liveActivity/`, the contract is `@tada/shared`'s `liveActivity.ts`, the server drives it from `src/liveActivity.ts` via `sync()` beside every board change, only one activity exists at a time and it follows the run that most wants you, and `register.ts` is at module scope on purpose. Under the server notes, add APNs as a third notification channel that is dormant without credentials.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: how the iOS live activity is wired"
```

---

## Self-Review

**Spec coverage:** contract → Task 1; four presentations and the departures → Task 7; recurring gates (`sync()` at every board change) → Task 5; focus policy and handoff → Task 4; APNs client and payload shape → Task 2; push-to-start and token read-back → Tasks 3 and 8; buttons and their honest failure → Tasks 7 and 8; config, identifiers, prebuild, and the Expo Go cost → Task 6; testing strategy → the test steps in Tasks 1–5, 7, 8; manual device verification → Task 9. No spec section is unimplemented.

**Known soft spots, deliberately left to the implementer:** the `'widget'` directive spelling, the exact `ProgressView` value prop, and how a `Button`'s interaction `target` string is produced are all pinned to *reading the installed package* (Task 6 step 2, Task 7 step 5) rather than guessed here — they are version-specific and cheap to confirm, and guessing them in a plan would be worse than naming where to look.
