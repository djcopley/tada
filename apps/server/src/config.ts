import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import webpush from 'web-push'
import { z } from 'zod'
import { configDir } from './paths.js'

/** The VAPID contact push services use to reach the operator about a misbehaving application. */
const DEFAULT_VAPID_SUBJECT = 'mailto:daniel@copley.dev'

// The VAPID fields are optional *on disk* so a config.json written before web push existed still
// parses; loadConfig() fills them in and writes them back. They are non-optional on Config,
// because by the time anyone holds one they are guaranteed present.
const configFileSchema = z.object({
  port: z.number().int().default(4242),
  // Bound to all interfaces by default so tailnet clients (the whole point of running this on a
  // box reachable over Tailscale) can connect. The MCP callback URL handed to adapters stays
  // loopback-only regardless of this setting - see src/index.ts.
  host: z.string().min(1).default('0.0.0.0'),
  bearerToken: z.string().min(32),
  vapidPublicKey: z.string().min(1).optional(),
  vapidPrivateKey: z.string().min(1).optional(),
  vapidSubject: z.string().min(1).optional(),
})

export interface Config {
  port: number
  host: string
  bearerToken: string
  vapidPublicKey: string
  vapidPrivateKey: string
  vapidSubject: string
}

/**
 * Reads config.json, creating it on first boot and backfilling anything missing.
 *
 * The VAPID keypair is generated once and then never touched. It is server identity, like the
 * bearer token — not a preference — and it deliberately does not live in SQLite: regenerating it
 * silently invalidates every push subscription, and a client holding a subscription made with the
 * old key cannot re-subscribe with a new one without unsubscribing first.
 */
export function loadConfig(): Config {
  const dir = configDir()
  const path = join(dir, 'config.json')

  const parsed = existsSync(path)
    ? configFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    : configFileSchema.parse({ bearerToken: randomBytes(32).toString('hex') })

  // A VAPID keypair is exactly that — a pair. If either half is missing BOTH are replaced from
  // one freshly generated pair: keeping a surviving half and generating its partner produces a
  // mismatched pair whose every send fails signature verification at the push service, which
  // looks like "notifications just stopped" with nothing wrong in the logs.
  const needsKeys = !parsed.vapidPublicKey || !parsed.vapidPrivateKey
  const keys = needsKeys
    ? webpush.generateVAPIDKeys()
    : { publicKey: parsed.vapidPublicKey ?? '', privateKey: parsed.vapidPrivateKey ?? '' }

  const config: Config = {
    port: parsed.port,
    host: parsed.host,
    bearerToken: parsed.bearerToken,
    vapidPublicKey: keys.publicKey,
    vapidPrivateKey: keys.privateKey,
    vapidSubject: parsed.vapidSubject ?? DEFAULT_VAPID_SUBJECT,
  }

  // Write back whenever the file is absent or was missing fields, so keys are stable from here on.
  // Mode 0600: this file holds the bearer token and the VAPID private key, and the default 0644
  // would leave both readable by every account on the box.
  if (!existsSync(path) || needsKeys || !parsed.vapidSubject) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 })
    // writeFileSync's mode only applies when it creates the file, so an already-existing 0644
    // config (written before this, or before the VAPID keys existed) needs an explicit chmod.
    chmodSync(path, 0o600)
  }

  return config
}
