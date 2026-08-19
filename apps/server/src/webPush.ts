import webpush from 'web-push'
import type { Config } from './config.js'

/** The shape a browser's PushSubscription.toJSON() produces, which is what the client sends us. */
export interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * Sends one encrypted payload to one subscription. Injected rather than imported so tests can
 * drive delivery, failure and expiry without crypto or a network.
 */
export type WebPushSender = (sub: WebPushSubscription, payload: string) => Promise<void>

/**
 * A push service answers 404 or 410 when a subscription is permanently dead — the PWA was
 * uninstalled, or the browser rotated it. That is the only signal we ever get, so it is also the
 * only safe reason to delete a row. Every other failure (500, 429, DNS) is transient and the
 * subscription must survive it.
 */
export function isGoneStatus(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const status = (err as { statusCode?: unknown }).statusCode
  return status === 404 || status === 410
}

export function createWebPushSender(config: Config): WebPushSender {
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey)
  return async (sub, payload) => {
    await webpush.sendNotification(sub, payload)
  }
}
