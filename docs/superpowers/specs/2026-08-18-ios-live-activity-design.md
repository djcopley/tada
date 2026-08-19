# The iOS Live Activity

**Date:** 2026-08-18
**Status:** approved, not yet implemented
**Design source:** `Live Activity.dc.html` in the Claude Design project
`d39efaed-4d44-4a3b-bf92-eda2fc4c4ac6` (Instrument Ink design system)

## Problem

The point of an overnight agent is that you are asleep while it works. Today the only thing that
reaches a locked phone is one push notification per hold (`notify.ts#ping`), which says a run
stopped on you and then decays into the notification list. There is nothing that *persists* on the
lock screen for the length of a run, nothing that shows the run still working, and no way to
approve a gate without unlocking, launching the app, and finding the run.

An iOS Live Activity is the surface built for exactly this shape: one long-running thing, four
presentations, present on the lock screen and in the Dynamic Island for as long as it matters, and
gone when it stops mattering. The design draws it in the product's own two voices.

## Non-goals

- **Android and web.** Live Activities are an iOS system feature. Nothing on those surfaces
  changes; the existing Expo push and web push channels keep doing their job everywhere.
- **Replacing the ping.** The lock screen card and the push notification carry the same sentence
  from `holdPingText()`, but the ping stays: it is what breaks through, and it is the only channel
  on the surfaces above.
- **Home screen widgets.** `expo-widgets` also builds those. Not in scope.
- **A lock screen transcript.** The well is one line, present tense. The transcript lives in the
  app, and this design does not weaken that rule.

## Constraints discovered while probing the tooling

Three facts settled the shape of everything below.

**1. The activity's UI is React, not Swift.** `expo-widgets@57.0.10` (official, matching this
repo's SDK 57) renders a `'widget'`-directive React component into SwiftUI through `@expo/ui`
primitives, and its `LiveActivityLayout` type has exactly the four presentations the design draws:

| Design | `LiveActivityLayout` key |
|---|---|
| Lock screen card | `banner` |
| Dynamic Island minimal | `minimal` |
| Dynamic Island compact | `compactLeading` + `compactTrailing` |
| Dynamic Island expanded | `expandedLeading` / `expandedTrailing` / `expandedCenter` / `expandedBottom` |

`@expo/ui/swift-ui` supplies `Text`, `HStack`/`VStack`/`ZStack`, `RoundedRectangle`, `Capsule`,
`Circle`, `ProgressView`, `Button`, `Spacer`, `Image`, and the modifiers this design needs —
`font({family,size,weight})`, `foregroundColor`, `background`, `cornerRadius`, `padding`, `frame`,
`shadow`, plus the widget-specific `activityBackgroundTint` and `widgetURL`. The design is
implemented once, in TypeScript, in `apps/mobile`. No hand-written Swift.

**2. Updates come from APNs directly, not from Expo's push service.** Expo's push API has no
Live Activity path. The server must speak APNs itself: HTTP/2 to `api.push.apple.com`, an ES256
JWT signed with a `.p8` key, `apns-push-type: liveactivity`, topic
`dev.copley.tada.push-type.liveactivity`. Node has `node:http2` and `node:crypto`, so this adds no
dependency.

**3. A push token cannot be correlated to a run by the app.** `LiveActivity` instances expose
`id`, `getPushToken()`, `update()` and `end()` — not their props. When iOS starts an activity from
a push and background-launches the app, the app can read the new activity's push token but cannot
tell *which run* it is for. This is the single constraint that shapes the server's bookkeeping:
**at most one Live Activity exists at a time**, and the token the app reports is bound to the
start the server most recently issued. See "One activity at a time" below.

## The contract

`packages/shared/src/liveActivity.ts` holds the content-state shape and the pure mapper that
produces it. It lives in `shared` for the same reason the run state machine does: the server
pushes this object and the widget renders it, and the two drifting is a silent, invisible bug —
the lock screen just shows the wrong thing.

```ts
export type ActivityPhase = 'working' | 'yourTurn' | 'done' | 'failed'

export interface ActivityAction {
  /** Which route the app calls when this button is pressed. */
  kind: 'approve' | 'deny' | 'answer' | 'continue' | 'stop' | 'rerun' | 'open'
  label: string
  /** For `answer`: the option text to send. */
  value?: string
}

export interface LiveActivityProps {
  runId: number
  ticketId: number
  /** The ticket title — the product's voice, sentence case, Instrument Sans. */
  title: string
  phase: ActivityPhase
  /** The agent's voice: one line, lowercase, present tense, IBM Plex Mono. */
  agentLine: string
  /** Epoch ms the run started. The compact timer counts from here locally — no push per second. */
  startedAt: number
  /** Epoch ms the budget expires, when the run has one. Drives the bar. Absent = no bar. */
  budgetEndsAt?: number
  /** At most two. Rendered in order. */
  actions: ActivityAction[]
}

export function runToActivityProps(input: {
  ticket: {id: number; title: string}
  // `startedAt` is nullable on the row (a queued run has none); the mapper falls back to now, so
  // the timer never renders from the epoch.
  run: {id: number; status: RunStatus; hold: Hold | null; startedAt: Date | null; budgetMs: number}
  summary: string | null
}): LiveActivityProps
```

The mapper is the whole state table, in one testable function:

| `run.status` / `hold.reason` | `phase` | `agentLine` | `actions` |
|---|---|---|---|
| `running` | `working` | latest activity line, or `working` | — |
| `held` / `permission` | `yourTurn` | `wants to: <ruleTitle> — <summary>` | Approve · Deny |
| `held` / `question` | `yourTurn` | the question | up to two of `hold.options`, else Open |
| `held` / `time` | `yourTurn` | `out of time` | Continue · Stop |
| `done` | `done` | the run summary | — |
| `failed` | `failed` | the failure reason | Re-run · Open |
| `cancelled`, `queued` | — | — | no activity; an existing one ends |

`agentLine` for a hold is `holdPingText(hold)` — the exact sentence the push notification already
sends. One event, one voice, two surfaces.

## The four presentations

Colors are the Instrument Ink tokens, transcribed to hex constants in
`apps/mobile/src/liveActivity/tokens.ts` (the widget bundle cannot import the RN token module if
that module pulls in anything native; if it is plain data, import it directly and delete the
copy). Orange is live — working *and* your turn. Sage is done. Red is failure only. No other
color exists.

**Minimal** — a single dot in the phase color. At 37pt only color carries meaning, so there is no
glyph and no count.

**Compact** — leading dot, trailing mono. Working shows elapsed time via `Text timerInterval`,
which ticks in the system's process: the clock costs no pushes, which is what makes the design's
"four pushes per run, at most" rule true. The other phases name themselves in two words
(`your turn`, `done`, `failed`).

**Expanded** — `expandedCenter` carries the run label, the ticket title, and the agent's well;
`expandedBottom` carries the actions when there are any. The island keeps the system's black, so
the well is drawn one step darker with a hairline edge rather than a shadow, exactly as the
mockup notes.

**Banner (lock screen)** — the raised card: `activityBackgroundTint(surface-raised)`, the
`tada✱ · run <id>` label in mono caps, the ticket title in Instrument Sans 16/600, the agent's
recessed well, then either the budget bar (working) or the action row (your turn / failed). The
whole card carries `widgetURL('tada://runs/<id>')`, so a tap anywhere that is not a button opens
the run screen — the same destination a push notification tap already reaches.

Two deliberate departures from the mockup, both because the mockup describes a product tada is
not:

- **There is no "Accept run" / "Send back".** A tada run files itself as done; there is nothing to
  accept. The buttons are what a held run actually offers — approve, deny, the question's own
  options, continue — and on failure, re-run.
- **"step 3 of 5" becomes the time budget.** tada does not know step counts. It does know
  `budgetMs`, so the bar shows budget consumed, and runs without a budget show no bar rather than
  a made-up one.

### What is on the card, and what needs the app

| State | Buttons |
|---|---|
| working | none — a tap opens the run |
| held / permission | Approve · Deny |
| held / question | the hold's own options, up to two; none → Open |
| held / time | Continue · Stop |
| done | none — the card ends after four seconds |
| failed | Re-run · Open |

Three actions the in-app `HoldActions` offers are deliberately **not** on the card. **Deny with a
note** needs a keyboard and **View diff** needs a screen, so a lock-screen Deny sends a bare deny.
**Always allow** is the pointed one: it rewrites the rule table permanently, and a half-asleep tap
at 3am is the worst place in the product to make a permanent change. It stays behind the app,
where the receipt and the rule it wrote are visible.

### Gates recur

Approving from the lock screen does not finish a run — it resumes it, and the rule table can stop
it again minutes later. The card's real life is `working → your turn → working → your turn → … →
done`, as many times as the rules say, which makes three things load-bearing:

- The activity is **per run, not per gate**. One card for the whole run, changing state, rather
  than a stack of notifications — this is the main reason the surface is worth building.
- `runResumed` pushes the card straight back to `working` and the well returns to the agent's
  line. That is the difference between this and a ping: the ping says something happened, the card
  says what is happening now.
- The mockup's "four pushes per run, at most" is therefore not literally true — it is start,
  finish, and one per gate. The quietness comes from `apns-priority` instead: working updates go
  at 5 and do not alert, `your turn` and `failed` go at 10 and do. A run that is merely working
  still never wakes you.

The star does not animate: `TadaStar` is a web animation with no SwiftUI equivalent. `done` shows
the sage ✱ glyph and the summary line, and the activity ends four seconds later
(`dismissalPolicy: after(now + 4s)`) — which is the celebration budget the design asks for, held
by ending rather than by animating.

**Fonts.** IBM Plex Mono and Instrument Sans must be embedded in the *extension* target for
`font({family})` to resolve there; `expo-font` only installs them into the main app. First
attempt: extend the config plugin to copy the `.ttf`s into the widget target and list them in its
`UIAppFonts`. If that fights the plugin, fall back to `font({design: 'monospaced'})` and the
system sans — the two-voice contrast survives, since it is carried by the well and the surfaces as
much as by the faces.

## Data flow

```
app (any launch)            server                                  iOS
─────────────────────────────────────────────────────────────────────────────
pushToStartToken   ──POST /live-activity/start-token──▶  stored
                            run starts ──APNs event:start──────────▶ activity appears
                            (input-push-token: 1)                    app background-launched
getInstances()[0]
  .getPushToken()  ──POST /live-activity/tokens───────▶  bound to that run
                            hold / resume ──APNs event:update──────▶ card changes
                            done / failed ──APNs event:end─────────▶ card ends (+4s)
```

**Push-to-start is the load-bearing choice.** Without it the activity would only exist for runs
that began while the app was open, which is precisely the case that does not matter. The app
registers `Activity.pushToStartToken` through `addPushToStartTokenListener` on every launch;
`input-push-token: 1` in the start payload is what makes iOS background-launch the app so the
per-activity update token can be read and reported.

**Reading the token back.** `expo-widgets` observes push token updates only for activities the app
itself started, so on every launch (foreground or background) the app calls
`factory.getInstances()`, reads `getPushToken()` on each, and POSTs any it has. Posting a token the
server already knows is a no-op.

### One activity at a time

The **focused** run is whichever run owns the single activity; every other live run is
non-focused and simply has no lock-screen card. It still pings, and it still sits on the board —
focus is a display decision, not a run state, and nothing about the runs themselves differs.

The rank is: **a held run outranks a working run; between two of equal rank, the most recent
wins.** The server keeps one row of truth: the current session (`runId`, `pushToken`, `endedAt`).
The policy, in `liveActivity.ts`:

- A run starts and there is no current session → start an activity for it.
- A run holds and the current session is a *different* run that is not held → end that activity
  and start one for the held run. A run that wants you outranks a run that is merely working.
- Any event about the current run → update.
- The current run reaches a terminal state → update to the terminal card, end with a four-second
  dismissal, then start an activity for the next live run if there is one.
- A token arrives from the app → bind it to the newest session that has none.

With `settings.concurrency > 1` the runs that do not own the activity get no lock-screen card.
That is a real limitation and it is deliberate: the alternative is a lock screen with four cards
on it, and the correlation problem above makes multiple simultaneous activities unreliable rather
than merely noisy.

The sharp edge of the handoff, stated plainly: if run A is held on a gate and run B then holds
too, B takes the card and **A's card disappears while A is still waiting on you**. A falls back to
the push notification it already gets today. With `concurrency: 1` — which an overnight queue
usually is — none of this ever fires.

## The APNs client

`apps/server/src/apns.ts`, structured like `webPush.ts` — a small module with an injectable seam
so tests never touch the network.

- **Auth.** ES256 JWT over header `{alg: 'ES256', kid: <keyId>}` and claims
  `{iss: <teamId>, iat: <now>}`, signed with the `.p8` via `createSign('SHA256')` and converted to
  the JOSE fixed-width r‖s form. Apple rejects tokens older than an hour and refuses more than one
  per twenty minutes, so the JWT is generated once and cached for fifty minutes.
- **Transport.** One `http2.connect` session per host, reused, re-established on `GOAWAY` or
  error. Headers: `:method POST`, `:path /3/device/<hex token>`, `apns-push-type: liveactivity`,
  `apns-topic: <bundleId>.push-type.liveactivity`, `apns-priority` 10 for `yourTurn` and `failed`,
  5 for everything else, `apns-expiration` 0.
- **Payload.** `expo-widgets`' `ContentState` is `{name, props}` where `props` is the
  *JSON-stringified* `LiveActivityProps` — a string inside the JSON, not an object. Getting this
  wrong renders nothing and reports no error, so it gets its own test.

```jsonc
{"aps": {
  "timestamp": 1755500000,
  "event": "start",                          // or "update" / "end"
  "content-state": {"name": "TadaRun", "props": "{\"runId\":4128,...}"},
  "attributes-type": "LiveActivityAttributes",  // the Swift struct expo-widgets declares
  "attributes": {},
  "input-push-token": 1,                     // start only
  "alert": {"title": "…", "body": "…"},      // yourTurn and failed only
  "dismissal-date": 1755500004               // end only
}}
```

- **Errors.** `410` or a `BadDeviceToken` reason deletes the token row — the only garbage
  collection a push token gets, matching how `webPush.ts` treats a dead subscription. Everything
  else logs the status and moves on. Never throws: a lock screen failing must not touch run state.
- **Environment.** A debug/dev build's tokens are only valid against
  `api.sandbox.push.apple.com`; TestFlight and release builds against `api.push.apple.com`. This
  is a config field, defaulting to `sandbox`, because the phone this runs on carries a dev build.

## Configuration and identifiers

`copley.dev` reversed is the app's identity:

| Thing | Value |
|---|---|
| App bundle id | `dev.copley.tada` (today `com.anonymous.tada`) |
| Widget extension | `dev.copley.tada.widgets` |
| App group | `group.dev.copley.tada` |
| APNs topic | `dev.copley.tada.push-type.liveactivity` |

`app.json` gains the `expo-widgets` plugin with `enablePushNotifications: true` and one widget
entry named `TadaRun`, plus `ios.appleTeamId`.

Server config (`config.json`, alongside the VAPID keys — same file, same 0600 mode) gains
`apnsKeyPath`, `apnsKeyId`, `apnsTeamId`, `apnsBundleId`, `apnsEnv`. All optional: **absent means
the channel is dormant**, exactly as an unconfigured `webPush` sender is today. The key is
referenced by path rather than inlined so the `.p8` is never copied into a file that gets pasted
into a terminal.

Schema (`apps/server/src/db/schema.ts`, one generated migration):

```ts
live_activity_start_tokens  // id, token unique, createdAt
live_activity_sessions      // id, runId, pushToken (nullable until reported), startedAt, endedAt
```

Two tables rather than one for the reason `push_tokens` and `web_push_subscriptions` are separate:
a push-to-start token belongs to a device and outlives every run, an activity token belongs to one
activity and dies with it.

Routes (`apps/server/src/routes/runs.ts`, beside the existing token routes):
`POST /live-activity/start-token`, `POST /live-activity/tokens`.

## Wiring into the run lifecycle

`ping` is not the right hook: it fires only when a run stops on you, and the activity needs to
know about starting, resuming, and finishing too. Instead a `LiveActivityChannel` is passed
through `RunnerDeps` and to the routes that resolve holds, the same way `fetchImpl` and `webPush`
are — which is what keeps `pnpm test` off the network.

| Call site | Method |
|---|---|
| `runner.ts#executeRun`, after the run is marked running | `runStarted` |
| `runner.ts#enterHold` | `runHeld` |
| hold resolution (approve / deny / answer / continue) | `runResumed` |
| `markFailed`, `markCancelled`, the done path | `runFinished` |

Every method is fire-and-forget and swallows its own failures, like `ping`. A lock screen must
never be able to fail a run.

## Buttons

The action buttons are `LiveActivityIntent`s (`expo-widgets`' `LiveActivityButtonView`). iOS runs
them in the *app's* process, background-launching it if needed; `expo-widgets` forwards the press
to JS as a user-interaction event carrying the button's `target`. `apps/mobile/src/liveActivity/`
registers that listener at **module scope**, imported by the root layout, so it is live as early
in a background launch as it can be — not inside a React effect that a background launch may never
run.

On a press the app calls the existing route with the stored credentials —
`POST /runs/:id/approve`, `/deny`, `/answer`, `/continue`, `/cancel` for the hold actions, and
`POST /tickets/:id/rerun` for Re-run, which is why `ticketId` rides in the props alongside
`runId`.

This is the fragile part of the design and it is treated as such. The activity updates
optimistically the moment the button is pressed, and **if the call does not land the card says
so**: it flips to a red `couldn't reach tada — open the app` line rather than sitting on an
optimistic state that never happened. A gate that silently fails to be approved is worse than a
gate that admits it needs the app.

## Testing

`pnpm test` stays token-free and network-free.

- **shared (vitest).** `runToActivityProps` table-tested across every `RunStatus` × `HeldReason`,
  including that `cancelled` and `queued` produce no activity, that `actions` never exceeds two,
  and that a question hold with zero options still offers Open.
- **server (vitest).** A fake APNs sender injected where the real one goes: the exact header set
  and payload shape per event (including `props` being a *string*), priority by phase, the
  one-activity-at-a-time policy (start → hold on another run switches → terminal ends and hands
  off), token binding to the newest unbound session, `410` deleting the token, and — importantly —
  that an unconfigured channel sends nothing and throws nothing.
- **mobile (jest).** The interaction→route module, as a plain function from a user-interaction
  event to an API call plus the optimistic props, including the failure path that produces the
  red "couldn't reach tada" state. The SwiftUI JSX itself cannot render under jest and is not
  tested there.

**Manual, on a device, once:** a dev build on a real iPhone — the Dynamic Island does not exist in
the simulator. Queue a ticket with the phone locked and confirm the card appears; let it hit a
gate and confirm the card changes and the island shows `your turn`; approve from the lock screen
and confirm the run resumes; let one fail and confirm red; confirm the card leaves four seconds
after done.

## What this costs

- An Apple Developer account, an APNs `.p8` key (key id + team id), and the bundle identifiers
  above.
- **iOS Expo Go stops working for this app.** A native target means a dev build
  (`npx expo prebuild -p ios` then `expo run:ios`). Android and web are unaffected. `ios/` is
  generated, not committed — the repo stays CNG, and `README.md` gains the two commands.
- The activity is iOS 16.2+ for push updates and iOS 17+ for the buttons; below that the app
  simply never registers a token and nothing appears.
