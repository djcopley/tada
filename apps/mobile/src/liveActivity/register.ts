import type { LiveActivityProps } from '@tada/shared'
import { runToActivityProps } from '@tada/shared'
import { Platform } from 'react-native'
import { TadaClient } from '../api/client'
import { loadConnection } from '../settings'
import {
  actionRequest,
  bareFailedProps,
  failedProps,
  optimisticProps,
  parseTarget,
} from './interactions'

/**
 * Live Activity wiring, registered at module scope rather than in an effect. A button press is a
 * LiveActivityIntent: iOS runs it in this app's process, background-launching the app if it is
 * not running — and a background launch may never render a component, so an effect-based listener
 * would miss exactly the press that matters most.
 */

// expo-widgets is native-only (it does not build for web, and Jest never loads it — that's why
// this whole file, unlike interactions.ts, is untested) and TadaRunActivity pulls in @expo/ui on
// top of it, so both are required lazily and only on iOS. Same shape as push.ts#loadNotifications.
type WidgetsModule = typeof import('expo-widgets')
type ActivityModule = typeof import('./TadaRunActivity')
type TadaRunActivityFactory = ActivityModule['default']

function loadWidgets(): WidgetsModule | null {
  if (Platform.OS !== 'ios') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately not a static import (see above)
    return require('expo-widgets') as WidgetsModule
  } catch {
    // The native module is absent — Expo Go, a simulator build without the widget extension, or
    // (now that this loads unconditionally at module scope, not gated behind a stored connection)
    // a test environment that reports Platform.OS as 'ios' with no native modules at all.
    return null
  }
}

function loadActivity(): ActivityModule | null {
  if (Platform.OS !== 'ios') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately not a static import (see above)
    return require('./TadaRunActivity') as ActivityModule
  } catch {
    return null
  }
}

/**
 * Builds a client from whatever connection is stored *right now*. Deliberately not resolved once
 * and captured — a listener that closed over a client built at module-load time would leave the
 * very first connect (or a later reconnect to a different server) with no start token registered
 * and, for a button press, a request firing against stale or absent credentials until the app
 * process restarts. Every call site below re-resolves this, so it always sees the current
 * connection even though the listener registration itself happens once, at module scope.
 */
async function withClient<T>(fn: (client: TadaClient) => Promise<T>): Promise<T | undefined> {
  const connection = await loadConnection()
  if (!connection) return undefined
  return fn(new TadaClient(connection))
}

/**
 * Wires the three things a Live Activity button/token needs a live JS session for. Exported (not
 * just run at import time) so the module-scope call below and any future direct caller share one
 * implementation. Every step swallows its own errors — a broken Live Activity must never break
 * app startup, exactly like push.ts's registerForPush.
 *
 * The listener registrations themselves are unconditional (not gated on a connection existing
 * yet) — that's what "registered at module scope" buys: a button press or a push-to-start event
 * that background-launches the app is caught no matter when the user connected relative to this
 * module loading. Each listener resolves the connection fresh via `withClient` when it actually
 * fires, rather than trusting one resolved at registration time.
 */
export function registerLiveActivity(): void {
  const widgets = loadWidgets()
  const activityModule = loadActivity()
  if (!widgets || !activityModule) return
  const TadaRunActivity = activityModule.default

  // 1. The push-to-start token: lets the server start a fresh activity for this device without
  // the app ever running. Idempotent server-side, so re-registering on every launch is fine.
  widgets.addPushToStartTokenListener((event) => {
    void withClient((client) =>
      client.registerLiveActivityStartToken(event.activityPushToStartToken),
    )
  })

  // 2. Any activity already running when the app launches (started by a previous session, or by
  // a push-to-start while this app was dead) needs its update token posted too — that is what
  // lets the server's next sync() actually reach it instead of sitting on stale placeholder props.
  for (const instance of TadaRunActivity.getInstances()) {
    instance
      .getPushToken()
      .then((token) =>
        token ? withClient((client) => client.registerLiveActivityToken(token)) : undefined,
      )
      .catch(() => {})
  }

  // 3 & 4. A button press. The target names its own run id (see TadaRunActivity.tsx's comment —
  // the single Live Activity slot can hold a terminal card for a run that is no longer the
  // server's focused one, so the client must never guess). The handler fetches that run directly,
  // shows an immediate "sending…" state, fires the call, and falls back to a visible failure
  // state rather than leaving the card stuck on that optimistic guess.
  widgets.addUserInteractionListener((event) => {
    void withClient((client) => handleInteraction(client, TadaRunActivity, event.target))
  })
}

async function handleInteraction(
  client: TadaClient,
  TadaRunActivity: TadaRunActivityFactory,
  target: string,
): Promise<void> {
  const parsed = parseTarget(target)
  if (!parsed) return
  const { runId, action } = parsed
  // Looked up before the try below so the failure path (unreachable server included) still has an
  // instance to put the red state on — a torn-down instance is the one case there is truly nothing
  // to update, and that alone is fine to fall out of silently.
  const instance = TadaRunActivity.getInstances()[0]
  if (!instance) return

  // Set once `client.run` returns, so the catch below can build a real `failedProps` from it; a
  // fetch that never lands leaves this null and falls back to `bareFailedProps(runId)` instead.
  let props: LiveActivityProps | null = null
  try {
    // `client.run` — the most likely failure on a lock screen, an unreachable server — must sit
    // inside this same guarded region as the rest of the call. It used to sit above the try, so a
    // failed fetch fell straight to a bare catch with nothing to update: no `failedProps`, no
    // visible change on the card, contradicting "if the call does not land the card says so".
    const run = await client.run(runId)
    props = runToActivityPropsFromRun(run)
    if (!props) return // the run has no card anymore (queued/cancelled) — nothing to act on

    // 'open' needs no call — the tap already brought the app forward — and checking this before
    // the optimistic update below means a plain Open tap never wipes a terminal card's buttons.
    const request = actionRequest(props, action)
    if (!request) return

    await instance.update(optimisticProps(props))
    await client.postAction(request.path, request.body)
  } catch {
    // Anything above — `client.run` unreachable, a malformed event, a 404 on the run, `postAction`
    // failing — must not crash the background launch it is running in, and must still leave the
    // card saying so rather than stuck on an optimistic "sending…" that silently never happened.
    await instance.update(props ? failedProps(props) : bareFailedProps(runId)).catch(() => {})
  }
}

/** `runToActivityProps` from `@tada/shared` takes the same shape the server builds from its DB
 * rows; `ApiRunDetail` (from `client.run(runId)`) already carries `ticketTitle`/`ticketId` for it. */
function runToActivityPropsFromRun(
  run: Awaited<ReturnType<TadaClient['run']>>,
): LiveActivityProps | null {
  return runToActivityProps({
    ticket: { id: run.ticketId, title: run.ticketTitle },
    run: {
      id: run.id,
      status: run.status,
      hold: run.hold,
      startedAt: run.startedAt ? new Date(run.startedAt) : null,
      budgetMs: run.budgetMs,
    },
    line: run.summary,
  })
}

// Module-scope side effect: wires the listeners above (a background launch from a button press may
// never mount ConnectionProvider, so this cannot be a hook). No connection is read here — each
// listener resolves one fresh via `withClient` when it actually fires — so nothing about this call
// depends on whether a connection already exists at the moment the module loads.
registerLiveActivity()
