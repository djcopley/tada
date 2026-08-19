import { Platform } from 'react-native'
import { TadaClient } from '../api/client'
import { loadConnection } from '../settings'
import { actionRequest, focusedActivityProps, optimisticProps, parseTarget, failedProps } from './interactions'

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
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately not a static import (see above)
  return require('expo-widgets') as WidgetsModule
}

function loadActivity(): ActivityModule | null {
  if (Platform.OS !== 'ios') return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately not a static import (see above)
  return require('./TadaRunActivity') as ActivityModule
}

/**
 * Wires the three things a Live Activity button/token needs a live JS session for. Exported (not
 * just run at import time) so the module-scope call below and any future direct caller share one
 * implementation. Every step swallows its own errors — a broken Live Activity must never break
 * app startup, exactly like push.ts's registerForPush.
 */
export function registerLiveActivity(client: TadaClient): void {
  const widgets = loadWidgets()
  const activityModule = loadActivity()
  if (!widgets || !activityModule) return
  const TadaRunActivity = activityModule.default

  // 1. The push-to-start token: lets the server start a fresh activity for this device without
  // the app ever running. Idempotent server-side, so re-registering on every launch is fine.
  widgets.addPushToStartTokenListener((event) => {
    client.registerLiveActivityStartToken(event.activityPushToStartToken).catch(() => {})
  })

  // 2. Any activity already running when the app launches (started by a previous session, or by
  // a push-to-start while this app was dead) needs its update token posted too — that is what
  // lets the server's next sync() actually reach it instead of sitting on stale placeholder props.
  for (const instance of TadaRunActivity.getInstances()) {
    instance
      .getPushToken()
      .then((token) => (token ? client.registerLiveActivityToken(token) : undefined))
      .catch(() => {})
  }

  // 3 & 4. A button press. ActivityKit hands back only the target string — no run id — so the
  // handler re-derives which run the single Live Activity is following (focusedActivityProps),
  // shows an immediate "sending…" state, fires the call, and falls back to a visible failure
  // state rather than leaving the card stuck on that optimistic guess.
  widgets.addUserInteractionListener((event) => {
    void handleInteraction(client, TadaRunActivity, event.target)
  })
}

async function handleInteraction(
  client: TadaClient,
  TadaRunActivity: TadaRunActivityFactory,
  target: string,
): Promise<void> {
  try {
    const action = parseTarget(target)
    if (!action) return
    const instance = TadaRunActivity.getInstances()[0]
    if (!instance) return

    const board = await client.board()
    const props = focusedActivityProps(Object.values(board).flat())
    if (!props) return // nothing is live to act on — nothing to update either

    await instance.update(optimisticProps(props))

    const request = actionRequest(props, action)
    if (!request) return // 'open' needs no call — the tap already brought the app forward

    try {
      await client.postAction(request.path, request.body)
    } catch {
      // The gate held on you is worse off admitting it needs the app than sitting on an
      // optimistic "sending…" that silently never happened.
      await instance.update(failedProps(props)).catch(() => {})
    }
  } catch {
    // Anything above this point (a torn-down instance, a malformed event) must not crash the
    // background launch it is running in.
  }
}

// Module-scope side effect: reads the stored connection (a background launch from a button press
// may never mount ConnectionProvider) and wires the listeners above. Every failure is swallowed —
// no stored connection, an unreachable server, expo-widgets missing on this platform — so a
// broken Live Activity never breaks app startup.
if (Platform.OS === 'ios') {
  loadConnection()
    .then((connection) => {
      if (connection) registerLiveActivity(new TadaClient(connection))
    })
    .catch(() => {})
}
