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

export interface ApnsResult {
  /** true when the response says the token is dead (410, BadDeviceToken, ExpiredToken) — the
   * caller's cue to delete whatever row holds it, mirroring notify.ts#sendWeb's 404/410 handling. */
  gone: boolean
}

export type ApnsSender = (msg: ApnsMessage) => Promise<ApnsResult>

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
    new Promise<ApnsResult>((resolve) => {
      try {
        const now = msg.now ?? new Date()
        if (!jwt || now.getTime() - jwt.at > JWT_TTL_MS) {
          jwt = { value: apnsJwt(creds, now), at: now.getTime() }
        }
        const req = apnsRequest(msg, creds)
        // req.headers already carries :method/:path (computed HTTP2_HEADER_* keys) plus the
        // plain-string APNs headers; authorization is overridden here with the cached JWT so
        // apnsRequest's own token (freshly signed per call) isn't wasted on every send.
        const headers: Record<string, string> = {
          ...req.headers,
          authorization: `bearer ${jwt.value}`,
        }
        const stream = getSession().request(headers)

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
          if (status === 200) {
            resolve({ gone: false })
            return
          }
          const reason = (() => {
            try {
              return JSON.parse(payload).reason as string | undefined
            } catch {
              return undefined
            }
          })()
          // Never log the token: it is a capability to push to that device.
          console.error(`apns send failed: HTTP ${status} ${reason ?? ''}`.trim())
          resolve({ gone: isApnsGone(status, reason) })
        })
        stream.on('error', (err) => {
          console.error('apns send failed:', err)
          session?.destroy()
          session = undefined
          resolve({ gone: false })
        })
        stream.end(req.body)
      } catch (err) {
        console.error('apns send failed:', err)
        resolve({ gone: false })
      }
    })
}
