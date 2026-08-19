# Web push and the PWA shell

**Date:** 2026-08-17
**Status:** approved, not yet implemented

## Problem

The iPhone this tool is used from is MDM-managed and cannot install the React Native app. The
only usable client there is the web build, added to the home screen as a PWA. Two things are
missing on that surface:

1. **No notifications.** `apps/mobile/src/push.ts` returns early on `Platform.OS === 'web'`, and
   `apps/server/src/notify.ts` speaks only Expo's push API. A run that stops on a gate at 2am
   pings nothing.
2. **No home screen icon.** `app.json` configures only `web.favicon`. There is no manifest and no
   `apple-touch-icon`, so iOS falls back to a screenshot of the page.

The Expo/native path is separately incomplete: the code is finished, but `getExpoPushTokenAsync`
needs an EAS `projectId` that has never been configured, so it no-ops on every device.

## Constraint discovered by probe

Web push has hard platform requirements, and this deployment is unusual: the server is a Mac on a
LAN, reached at a **bare IP over HTTPS with a Caddy internal-CA certificate** manually trusted on
the phone. There is no DNS and no publicly-trusted certificate.

A throwaway probe (served from `deploy/push-probe/`, since deleted) settled it on-device. On
iOS 18.7, installed to the home screen:

```
isSecureContext: true
installed to home screen: true
serviceWorker register: OK, scope https://192.168.1.91:8444/
permission: granted
SUBSCRIBE OK
endpoint: https://web.push.apple.com/QPuO2MIj-pK4Oy9ZWgJ1U...
```

**Web push works on a bare-IP origin backed by a manually-trusted internal CA.** iOS treats such
a connection as authenticated, so the origin is secure-context eligible, and Apple's push
registration applies no stricter certificate test. This is the load-bearing fact behind the whole
design; without it, none of the below is possible and the honest answer would have been "the web
app cannot notify you in the background."

Two things the probe also established, worth recording because they shape the UI:

- Permission must be requested **from a user gesture inside an installed PWA**. Safari refuses in
  a normal browser tab. Startup registration — what `push.ts` does on native — cannot work.
- A push subscription is **sticky per origin** and bound to the `applicationServerKey` it was
  created with. Subscribing again with a different key throws `InvalidStateError`. This is why
  the VAPID keys must outlive the database.

## Non-goals

- Offline support. The app is useless without the server; a cache layer would add staleness bugs
  and no capability.
- Replacing Expo push with web push on native. `expo-notifications` does not implement VAPID web
  push; this would mean a bespoke native transport for no gain.
- Notification categories, actions, or per-ticket subscription. One ping when a run stops on you
  is the existing product behaviour and is not being changed.
- Any change to when pings fire. This work adds a transport, not a policy.

## Design

### 1. VAPID keys live in `config.json`

`loadConfig()` gains the same absent-then-generate-then-write treatment it already applies to
`bearerToken`:

| Key | Default |
|---|---|
| `vapidPublicKey` | generated via `webpush.generateVAPIDKeys()` on first boot |
| `vapidPrivateKey` | as above |
| `vapidSubject` | `mailto:daniel@copley.dev` |

These are server *identity*, like the bearer token — not user preference — so they do not belong
in the `settings` table. More importantly they must survive a database reset: regenerating them
invalidates every existing subscription, and per the probe finding above, a client holding a
subscription made with the old key cannot simply re-subscribe with the new one without first
unsubscribing. Keeping them in `config.json` keeps that failure off the table.

### 2. `notify.ts` fans out over channels

`ping()` keeps its exact signature and its contract: respects `pingChannel === 'off'`, never
throws, truncates bodies to 150 chars. Internally it becomes a fan-out:

```ts
interface NotifyChannel {
  name: 'expo' | 'web'
  send(msg: PingMessage): Promise<void>
}
```

The Expo channel is today's code moved behind that interface. The web channel is new. Channels
are dispatched independently so one failing cannot suppress the other — the existing
"a notification failure must not affect run state" rule now also means "must not affect the other
channel."

Both channels ride under the existing `pingChannel: 'push' | 'off'` setting. No enum change and
no migration for it: "push" means "however this device gets pinged."

This is what makes supporting both transports cheap. The Expo channel stays dormant with zero
registered tokens and lights up when EAS setup is finished, with no further code change.

### 3. Subscription storage and routes

```ts
export const webPushSubscriptions = sqliteTable('web_push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: createdAt(),
})
```

A separate table from `push_tokens`, not a `kind`-discriminated union: an Expo token is one
string, a web subscription is three fields, and merging them leaves half the columns permanently
null. The unique `endpoint` makes re-subscribing idempotent.

Routes, on the existing bearer auth alongside `POST /push-tokens`:

| Route | Purpose |
|---|---|
| `GET /web-push/public-key` | client needs it before `pushManager.subscribe()` |
| `POST /web-push/subscriptions` | body is `PushSubscription.toJSON()`; `onConflictDoNothing` |
| `DELETE /web-push/subscriptions` | by endpoint, for explicit opt-out |

**Pruning is part of the send path**, not a separate sweep: a `410 Gone` or `404` from Apple
deletes the row inline. Without it a reinstalled PWA leaves dead rows forever and every ping pays
for sends that cannot succeed.

Requires `pnpm --filter @tada/server exec drizzle-kit generate` and committing the migration —
`openDb()` migrates on boot, so an unregenerated schema change is invisible at runtime.

### 4. Service worker and PWA shell

New files in `apps/mobile`:

- **`public/sw.js`** — hand-written, roughly 30 lines. A `push` handler that calls
  `showNotification`, and a `notificationclick` handler that focuses an existing client or opens
  `/tickets/<id>`. Deliberately not Workbox: there is no caching story to manage.
- **`public/manifest.json`** — `display: standalone`, `start_url` and `scope` of `"/"` (relative,
  so the install is not bound to any particular host), `theme_color` and `background_color`
  `#1B1613` from the Instrument Ink night palette, icons at 180/192/512 generated from
  `assets/icon.png`.
- **`app/+html.tsx`** — the documented Expo hook for `<head>` content on web. Carries
  `<link rel="manifest">`, `apple-touch-icon`, `apple-mobile-web-app-capable`, `theme-color`, the
  service-worker registration script, and `ScrollViewStyleReset` (required; omitting it breaks
  `ScrollView` behaviour on web).

`app.json` gains an explicit **`web.output: "static"`**. It is currently unset and therefore
depends on an SDK default, so pinning it keeps the export shape stable — but the value is not a
free choice. expo-router applies `+html.tsx` **only** for static/server output; with
`output: "single"` the file is silently ignored and the shell comes from `public/index.html`
instead. This was verified by building both ways: the single-page export emitted the stock
template with no manifest link and no `apple-touch-icon`, while the static export emitted all of
them across all 15 route files.

Static output prerenders each route to its own `.html`, so the Caddy fallback becomes
`try_files {path} {path}.html /index.html`.

**Known platform limitation, deliberately not worked around in mainline.** iOS Safari refuses to
fetch `apple-touch-icon` over a certificate that is not publicly trusted, and silently
substitutes a generated letter tile — see https://developer.apple.com/forums/thread/92304,
reported against iOS 11, never fixed, reproduced here on iOS 18.7. Plain HTTP works and a
publicly trusted certificate works; a privately trusted root does not. The suppression is
specific to the icon fetch: the manifest is still read (the "Open as Web App" toggle appears) and
push still works.

Mainline therefore keeps the ordinary `<link href="/icon-180.png">` and is correct for any
deployment with a real certificate. The fix for a private-CA deployment is to inline the PNG as a
`data:` URI, which needs no network request and so gives Safari nothing to refuse; `+html.tsx`
runs in Node during `expo export` and can read the bytes at build time. That change lives on the
`workaround/self-signed-cert-icon` bookmark rather than in mainline, because it is compensation
for one environment's certificate rather than something the app needs.

The web favicon is generated from `assets/icon.png` rather than reusing `assets/favicon.png`,
which has an alpha channel — iOS composites transparency onto white, which framed the share-sheet
icon in white bars.

Everything in this section is independent of push and fixes the home-screen icon on its own. It
lands first.

### 5. Client opt-in is a button, not startup

New `src/webPush.ts`, mirroring `push.ts`'s structure and its swallow-every-failure discipline,
with the state logic in a plain module so it is testable without rendering.

Per the probe finding, permission cannot be requested at startup. The opt-in is a control in the
existing `PingsCard` on the Settings screen.

**The install requirement is iOS-only.** Desktop browsers — Chrome, Edge, Firefox on any OS, and
Safari 16+ on macOS — subscribe from an ordinary tab with no install step. Gating the button on
`navigator.standalone` alone would permanently disable it on desktop, since that property is
`undefined` there. The gate is therefore "iOS **and** not installed", not "not installed":

| Condition | UI |
|---|---|
| iOS, not standalone | "Add to Home Screen to enable notifications", disabled, with the how |
| iOS, standalone, permission `default` | "Enable notifications", enabled |
| desktop browser, permission `default` | "Enable notifications", enabled — no install needed |
| permission `granted` | "Notifications on" + a "Send test ping" button |
| `PushManager` absent | "This browser cannot receive notifications", disabled |

Feature-detect `PushManager` rather than sniffing the user agent for capability; the platform
check is used *only* to decide whether to demand installation, which is a policy difference no
feature test can express.

A denied permission is terminal on iOS until the icon is deleted and re-added; the UI says so
rather than offering a button that cannot work. On desktop it is recoverable through site
settings.

Two desktop caveats worth stating in the README rather than engineering around:

- **The browser must be running** to receive a push. It can be in the background or fully
  minimised, but a quit browser gets nothing. The phone is the always-on surface; desktop is a
  convenience.
- **Each desktop must trust the Caddy internal CA root.** The server Mac already has it in its
  System keychain, so it works there with no setup; any other machine needs the root installed
  first or the origin is not a secure context and `subscribe()` cannot run.

`push.ts` is untouched and still returns early on web. The two transports never overlap on one
platform.

### 6. Finishing the Expo channel

Code-complete already; what remains is account and build setup, documented in the README rather
than automated: create the Expo account, `eas init` to get a `projectId`, add it to
`app.json` under `extra.eas.projectId`, and produce a build. Once a device registers a token the
Expo channel starts delivering with no code change.

### 7. Deployment

`deploy/Caddyfile` is kept and its temporary `push-probe` site block removed, along with
`deploy/push-probe/`. The site address becomes `{$TADA_HOST:192.168.1.91}:8443` so the host is
overridable by environment without editing the file.

The existing comments explaining why Caddy runs as the user (internal CA root lives in that
user's data dir, and re-minting it would break the phone's trust) and why ports are 8443 rather
than 443 (macOS reserves <1024 for root) are load-bearing and stay.

**The API needs a TLS front door too.** Serving the app over HTTPS makes the old
`http://<host>:4242` connection URL illegal: browsers block an HTTPS page from calling a plain
HTTP origin as mixed content, at the network layer, with no distinguishable error. The client
surfaces it as "could not reach server", which looks identical to the server being down. Caddy
therefore proxies `https://<host>:8444` to `127.0.0.1:4242`, and the app connects there.
Websockets need no extra handling: `client.ts#wsUrl` derives `wss://` from `https://`, and
`reverse_proxy` upgrades automatically (verified: 101 over HTTP/1.1).

Caddy's admin endpoint stays enabled (loopback-only default) so config changes can be applied
with `caddy reload` instead of a restart.

README gains: the Caddy serving story including the API proxy and the connection URL, the
"Add to Home Screen, then enable notifications in Settings" flow, and the EAS steps. The current
README claims push is "native only" — that becomes wrong and must be updated.

## Testing

Server, via vitest, zero tokens and zero network:

- `ping()` takes an injected web-push sender the way it already takes `fetchImpl`.
- Both channels fire when both have registrations.
- `pingChannel: 'off'` sends nothing on either channel.
- One channel throwing does not suppress the other.
- A 410 response deletes that subscription row; a 500 does not.
- `POST /web-push/subscriptions` is idempotent on endpoint.

Mobile, via jest: the standalone/permission state matrix in `webPush.ts` resolves to the right UI
state, tested as a plain module.

**End-to-end delivery cannot be tested from the development machine** — it needs the physical
phone. The "Send test ping" button exists so that verification is one tap rather than queueing a
real ticket.

## Risks

- **Origin is the identity.** Subscriptions are bound to `https://192.168.1.91:8443`. The
  deployment IP is static, so this is accepted; if it ever changes, the home screen icon breaks
  visibly and stored subscriptions become inert rows to be cleared.
- **Certificate trust is manual.** The internal CA root is installed on the phone by hand. If
  MDM removes it, the origin stops being secure-context and push stops. Nothing in application
  code can detect or mitigate this.
- **Apple push is opaque.** Delivery failures surface only as HTTP status codes; there is no
  read receipt. Pruning on 410 is the only feedback loop available.
