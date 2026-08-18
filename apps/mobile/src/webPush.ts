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
}

export type PushUiState = 'unsupported' | 'needs-install' | 'can-enable' | 'enabled' | 'blocked'

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
  if (env.permission === 'granted') return 'enabled'
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
  if (existing) await existing.unsubscribe()

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
