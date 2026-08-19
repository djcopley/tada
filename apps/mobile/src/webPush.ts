import { Platform } from 'react-native'
import type { TadaClient } from './api/client'

/**
 * Everything the opt-in UI needs to know about the browser, gathered in one place so the decision
 * itself stays a pure function and can be tested without a DOM.
 */
export interface PushEnv {
  hasPushManager: boolean
  isIos: boolean
  isStandalone: boolean
  permission: 'default' | 'granted' | 'denied'
  /**
   * Whether this browser still holds a live PushSubscription. Undefined means "not looked yet" —
   * readPushEnv() cannot answer it synchronously (getSubscription() is async), so the value only
   * ever arrives from reconcileWebPushSubscription(). `false` is the important case: permission
   * is granted but nothing is subscribed, so the server can reach nobody.
   */
  hasSubscription?: boolean
}

export type PushUiState =
  | 'unsupported'
  | 'needs-install'
  | 'can-enable'
  | 'enabled'
  | 'lapsed'
  | 'blocked'

/**
 * The install requirement is iOS-only. Safari grants push exclusively to a home-screen-installed
 * web app, while desktop browsers subscribe straight from a tab — so gating on "is installed"
 * alone would permanently disable the button on desktop, where navigator.standalone is undefined.
 *
 * Capability is feature-detected; the platform check decides only whether to demand installation,
 * which is a policy difference no feature test can express.
 */
export function pushUiState(env: PushEnv): PushUiState {
  if (!env.hasPushManager) return 'unsupported'
  if (env.permission === 'denied') return 'blocked'
  // A granted permission is NOT proof of a live subscription: a server-side reset, a 410 prune or
  // the browser rotating the endpoint all leave permission granted with nothing subscribed. That
  // state must offer Enable again, otherwise the card claims to be on while every ping goes
  // nowhere — the failure is completely silent from the user's side.
  if (env.permission === 'granted') return env.hasSubscription === false ? 'lapsed' : 'enabled'
  if (env.isIos && !env.isStandalone) return 'needs-install'
  return 'can-enable'
}

export function readPushEnv(): PushEnv {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { hasPushManager: false, isIos: false, isStandalone: false, permission: 'default' }
  }
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return {
    hasPushManager: 'PushManager' in window && 'serviceWorker' in nav,
    isIos: /iPad|iPhone|iPod/.test(nav.userAgent),
    isStandalone:
      nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches,
    permission: typeof Notification === 'undefined' ? 'default' : Notification.permission,
  }
}

/** Base64url (what the server stores) to the Uint8Array pushManager.subscribe() demands. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = window.atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/**
 * Registers the service worker, asks for permission and posts the subscription to the server.
 * Returns whether push is now on. Must be called from a user gesture: iOS refuses otherwise.
 *
 * A subscription is sticky per origin and bound to the key that created it, so an existing one
 * made with a different application server key is unsubscribed first — otherwise subscribe()
 * throws InvalidStateError and the user sees a failure with no way to recover from the UI.
 */
export async function enableWebPush(client: TadaClient): Promise<boolean> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready

  const { publicKey } = await client.webPushPublicKey()
  const applicationServerKey = urlBase64ToUint8Array(publicKey)

  const existing = await registration.pushManager.getSubscription()
  if (existing) {
    const staleEndpoint = existing.endpoint
    await existing.unsubscribe()
    // Tell the server too, or the now-dead row lingers until a send 410s it. Best-effort: the
    // local unsubscribe already happened, and a failure here must not abort the opt-in.
    await client.deleteWebPushSubscription(staleEndpoint).catch(() => {})
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    // lib.dom's PushSubscriptionOptionsInit wants a BufferSource typed over ArrayBuffer, but
    // Uint8Array.from() is typed generically over ArrayBufferLike (it may back onto a
    // SharedArrayBuffer) — the array we just built is always a plain ArrayBuffer, so this is a
    // type-system gap, not a real mismatch.
    applicationServerKey: applicationServerKey as BufferSource,
  })
  // toJSON()'s declared return type widens endpoint/keys to optional strings; the browser always
  // populates both for a subscription created with userVisibleOnly + an applicationServerKey, and
  // the server's route contract (Task 5) requires them, so a narrow cast is safer here than
  // loosening registerWebPushSubscription's parameter type for every other caller.
  await client.registerWebPushSubscription(
    subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } },
  )
  return true
}

/**
 * Re-posts this browser's existing subscription to the server, and reports whether one exists.
 *
 * This is the only recovery from a silently dead channel. The browser keeps reporting `granted`
 * forever, so nothing else in the UI would ever notice that the server's row went away (SQLite
 * reset, a 410 prune, an endpoint rotation) — and POST /web-push/subscriptions is idempotent, so
 * re-sending it on every mount costs one request and fixes all three.
 *
 * Never throws: it runs from an effect, and a rejected promise there is an unhandled rejection
 * with no UI to show it. Returns true on failure as well — a transient network error is not
 * evidence the subscription is gone, and downgrading the card on it would push the user through
 * a pointless re-opt-in.
 */
export async function reconcileWebPushSubscription(client: TadaClient): Promise<boolean> {
  try {
    // getRegistration(), not `serviceWorker.ready`: ready never resolves when no worker has been
    // registered for the scope, which would leave this promise pending for the life of the page.
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) return false
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return false
    await client.registerWebPushSubscription(
      subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } },
    )
    return true
  } catch {
    return true
  }
}
