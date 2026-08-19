# tada

A personal kanban app (web + mobile) where tickets are tasks for coding agents. You write a
ticket, drop it in the queue, and an agent on your self-hosted server picks it up, works out of
one folder (a git worktree per repo it touches — or no repo at all; some tasks are purely
operational), pushes and opens the pull request itself, and moves the ticket to done. Approval
sits in the *middle* of the run: a rule table decides which tool calls halt the agent (by default,
opening or merging a PR); a held run keeps its context and its place, frees its slot for the next
ticket, and continues from that step when you approve, deny with a note, answer its question, or
give it more time. Red is reserved for real failure, and nothing ever auto-retries. Single-user tool.

`tada-server` is the Node/TypeScript daemon: a REST + WebSocket API, SQLite database, and a
scheduler that dispatches tickets to agent adapters (Claude via the Claude Agent SDK under your
Max subscription — the only harness that supports gates — plus codex/gemini CLIs). It runs as a
systemd service on a box you own, reachable over your Tailscale tailnet. This repository also
contains the client, `tada-app` (`apps/mobile`) — one Expo codebase for iOS, Android, and web.

## Install

Prerequisites on the server:

- Node 22+ (see `.nvmrc`)
- [pnpm](https://pnpm.io) (`corepack enable` or `npm i -g pnpm`)
- [GitHub CLI](https://cli.github.com) (`gh`) — used to open PRs
- The `claude` CLI, logged into your Max subscription

Steps:

1. Create a dedicated, low-privilege `tada` user for the server (see
   [Security posture](#security-posture) — this is not optional).
2. Clone this repo to `/opt/tada` (or wherever `deploy/tada-server.service` points), owned by
   `tada`.
3. As the `tada` user, install dependencies: `pnpm install`.
4. As the `tada` user, authenticate the tools the server shells out to:
   - `claude login` — one-time login; the Claude adapter drives Claude Code under this session,
     billed to your Max subscription (no API key involved).
   - `gh auth login` — scope the token to just the repos you connect (see
     [Security posture](#security-posture)).
5. Install and enable the systemd unit:

   ```sh
   sudo cp deploy/tada-server.service /etc/systemd/system/tada-server.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now tada-server
   ```

   The unit runs `pnpm --dir /opt/tada start`, which resolves to `tsx src/index.ts` in
   `apps/server` (see `apps/server/package.json`). Adjust `ExecStart`'s path if you clone
   somewhere other than `/opt/tada`.
6. First boot writes a config file with a fresh bearer token and default port — see
   [Configuration & data locations](#configuration--data-locations) and
   [Authentication](#authentication).

## Configuration & data locations

The server follows the XDG base directory spec, with fallbacks and env-var overrides for tests
and local dev:

| Purpose | XDG variable | Default | Override |
|---|---|---|---|
| Database, repo clones, sources manifest | `$XDG_DATA_HOME/tada` | `~/.local/share/tada` | `TADA_DATA_DIR` |
| Server config (`config.json`) | `$XDG_CONFIG_HOME/tada` | `~/.config/tada` | `TADA_CONFIG_DIR` |
| Transcripts, logs, run journals | `$XDG_STATE_HOME/tada` | `~/.local/state/tada` | `TADA_STATE_DIR` |

The data dir looks like:

```
tada.db                # settings, rules, tickets, runs, memory notes, activity
manifest.json          # connected sources: repo clones and attached folders
repos/<repo>/          # canonical clones (each run gets a worktree under the state dir)
```

Under the state dir, each run has `runs/<runId>/` (scratch, folder symlinks, worktrees) and
`transcripts/<runId>.jsonl`. Memory notes live in the database.

`config.json` holds:

| Key | Default | Notes |
|---|---|---|
| `port` | `4242` | TCP port the server listens on |
| `host` | `0.0.0.0` | Bind address; defaults to all interfaces so tailnet clients can connect. The MCP callback URL handed to agent adapters always stays `127.0.0.1` regardless of this setting - agents run on the same box. |
| `bearerToken` | random 32-byte hex | See [Authentication](#authentication) |
| `vapidPublicKey` | generated on first boot | VAPID application server key handed to browsers before they subscribe to Web Push |
| `vapidPrivateKey` | generated on first boot | Signs every push. Keep it secret - the file is written `0600` |
| `vapidSubject` | `mailto:daniel@copley.dev` | Contact a push service uses to reach the operator about a misbehaving application |

The VAPID keypair lives here rather than in the database because it is server identity, not a
preference: regenerating it invalidates **every existing push subscription**, and a browser
holding a subscription made with the old key has to unsubscribe before it can re-subscribe. If
either key goes missing the server regenerates both (a mismatched pair signs nothing), so back up
`config.json` alongside the database.

## Authentication

On first run, if `$XDG_CONFIG_HOME/tada/config.json` doesn't exist, the server generates one with
a random 32-byte hex bearer token and a default port (4242), and writes it to disk. Every request
except `GET /health` and the `/mcp` route (used only by agent runs, which authenticate
differently) must carry:

```
Authorization: Bearer <token from config.json>
```

There are no accounts and no OAuth — this single server-issued token is the entire access control
model. Read `config.json` on the server to get the token for the client app.

## Client (mobile & web)

The client is a cross-platform Expo app (`tada-app`, in `apps/mobile`) available as:

### Running on a mobile device

Use Expo Go to preview development builds, or build a dev build for a faster iteration loop.

1. Start the client dev server from the repo root:
   ```sh
   pnpm --filter @tada/mobile start
   ```

2. Open the generated QR code in Expo Go (iOS/Android) or run `i` for iOS or `a` for Android to
   build a dev client.

3. On the app's connection screen, enter:
   - Server URL: your server's address (e.g., `http://tada.100.x.x.x:4242` over a tailnet, or
     `https://<host>:8443/api` when fronted by the Caddy config in `deploy/` — see
     [Serving the web build](#serving-the-web-build))
   - Bearer token: read from the server's `config.json` file (see [Configuration & data
     locations](#configuration--data-locations))

4. Tap "Connect". The app stores credentials securely using `expo-secure-store` (native secure
   enclave on iOS, Keystore on Android), so you won't need to re-enter them.

#### Native push (Expo)

The native path is code-complete but dormant until the app has an EAS project: without a
`projectId`, `getExpoPushTokenAsync` throws and registration is skipped by design. To finish it:

1. Create an Expo account and run `pnpm --filter @tada/mobile exec eas init`.
2. Commit the resulting `extra.eas.projectId` in `apps/mobile/app.json`.
3. Produce a dev or production build; Expo Go alone will not deliver notifications reliably.

Once a device registers a token the server starts delivering to it with no code change — the Expo
channel is always registered, it simply has no tokens until then.

### Running on web

For development, start the web dev server:

```sh
pnpm --filter @tada/mobile web
```

For a production-ready static build, export to `dist/`:

```sh
pnpm --filter @tada/mobile exec expo export --platform web
```

The export uses `web.output: "static"`, so every route is prerendered to its own `.html` file.
That setting is load-bearing rather than cosmetic: the PWA `<head>` is built by
`apps/mobile/app/+html.tsx`, and expo-router only applies that file for static/server output. A
single-page export silently ignores it, taking its shell from `public/index.html` instead — you
get a build with no manifest link and no app icon.

The web app uses `localStorage` for settings persistence instead of secure storage. Connect via
the same connection screen as mobile.

### Serving the web build

`deploy/Caddyfile` serves `dist/` over HTTPS. Start it **as your own user, not with `sudo`**:

```sh
nix run nixpkgs#caddy -- run --config deploy/Caddyfile
```

Running as your user matters. Caddy's internal CA root lives in that user's data dir
(`~/Library/Application Support/Caddy` on macOS), and that root is the one installed and trusted
on your devices. `sudo caddy` uses a different data dir, mints a fresh root, and every device
starts showing certificate warnings. For the same reason the site listens on 8443 rather than
443: macOS reserves ports below 1024 for root.

The site address defaults to `192.168.1.91` and is overridable without editing the file:

```sh
TADA_HOST=10.0.0.5 nix run nixpkgs#caddy -- run --config deploy/Caddyfile
```

The host has no DNS name, so Caddy issues an IP-SAN certificate from its internal CA. Install
that root (`~/Library/Application Support/Caddy/pki/authorities/local/root.crt`) on each device
and trust it fully. Browsers then treat the origin as a **secure context**, which is what makes
service workers, PWA installation and web push possible at all — a plain-HTTP origin supports
none of them.

Caddy also fronts the API, under **`/api` on the same origin as the app**, proxying to the
server's plain-HTTP port 4242. Point the app's connection screen at **`https://<host>:8443/api`**,
not `http://<host>:4242`.

Fronting the API is required rather than convenient: once the app is served over HTTPS, a browser
refuses to let it call an `http://` origin (mixed content), and blocks the request at the network
layer with no useful error — the client reports "could not reach server", which is
indistinguishable from the server being down.

Putting it on the *same origin* rather than a second port matters just as much, and for a reason
specific to a host with no publicly trusted certificate: **Safari requires the certificate to be
accepted once per origin**, and a different port is a different origin. An API on `:8444` means a
phone that has happily loaded the app still refuses every API call until the user visits the API
port directly in Safari and accepts it there too — which presents as "could not reach server"
while `curl` from the server itself works perfectly. Same origin means one acceptance, no CORS
preflights, and no second port to explain.

`handle_path` strips the `/api` prefix before proxying, so the server keeps seeing the paths it
registers and needs no knowledge of where it is mounted. Websockets ride the same door: the client
derives `wss://` from `https://` and appends `/ws` to the same base URL, and Caddy upgrades the
connection through `reverse_proxy` automatically.

### Installing as a home screen app

On iOS, open the site in **Safari** (Chrome on iOS cannot install PWAs), then **Share → Add to
Home Screen**. It launches without browser chrome, using the app icon and the Instrument Ink
night background.

This is the only way to run tada on an MDM-managed iPhone that forbids installing the native app.

### Enabling notifications

Open Settings in the app and use **Notifications in this browser → Enable**, then **Send test** to
confirm delivery. On iOS this only appears once the app has been added to the Home Screen and
launched from that icon.

If you dismissed the browser's permission prompt, the row says **Blocked** and there is no in-app
retry: Safari only re-asks a freshly installed web app, so delete the Home Screen icon, add it
again, and enable from the fresh install (on desktop, clear the notification permission for the
site in browser settings instead).

Notifications need a **secure context**, so they only work over HTTPS with a certificate the
device trusts. A device that has not installed the Caddy internal CA root will not be offered the
option.

### Settings & storage

| Platform | Storage method | Scope |
|---|---|---|
| iOS/Android | `expo-secure-store` (native secure enclave) | Credentials only (server URL + token) |
| Web | `localStorage` | All settings including credentials |
| All platforms | In-memory React Query cache | Fetched data (board, memory, rules); cleared on app close |

### Features & limitations

- **Board interactions:** drag cards between Backlog, Queued and Done (Running and Stopped are the
  runner's lanes); right-click on web / long-press on mobile for the action set (open, approve /
  deny / view diff for a held card, move to, duplicate, copy link, delete).
- **Push notifications:** native (Expo) and browser (Web Push), and only when a run stops on you
  (permission, question, out of time, failure) plus one optional re-ping. Finished runs are quiet —
  they filed themselves. In a browser, enable them from Settings; on iOS the site must be added to
  the Home Screen first, because Safari grants notification permission only to an installed web
  app. Desktop browsers need no install, but must be running to receive one.
- **Live updates:** board, thread and run events stream over one WebSocket.

## Running tests

```sh
pnpm lint && pnpm typecheck && pnpm test
```

`pnpm test` runs the full unit/integration suite (state machine, scheduler, MCP tools, routes,
FakeAdapter end-to-end flows) with zero LLM tokens consumed.

### Gated Claude integration test

`apps/server/test/claudeAdapter.it.test.ts` drives a real Claude Agent SDK session against a live
`tada` MCP endpoint. It's skipped by default because it **consumes your logged-in account's
Max/API quota** — do not run it in CI. Run it manually, with the `claude` CLI already logged in:

```sh
TADA_IT=1 pnpm --filter @tada/server exec vitest run test/claudeAdapter.it.test.ts
```

## Security posture

Agents run unattended with permissions bypassed, as the server's user. Ticket text is trusted
(you wrote it), but repo/web content makes prompt injection a real if modest risk. v1 mitigations:
dedicated user on a dedicated VM; only the credentials this system needs (fine-grained GitHub
token scoped to the connected repos); nothing else of yours on the box. The rule table is a
safety net for *your* review moment (the PR), not a sandbox — an unmatched tool call is allowed.
Container-per-run is the known future hardening step and slots into the adapter interface without
redesign.
