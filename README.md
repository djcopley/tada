# tada

A personal kanban app where the tickets are tasks for **coding agents**. You write a ticket, drop
it in the queue, and an agent on your self-hosted server picks it up, works out of one folder (a
git worktree per repo it touches — or no repo at all; some tasks are purely operational), pushes
and opens the pull request itself, and moves the ticket to done.

Approval sits in the *middle* of the run: a rule table decides which tool calls halt the agent (by
default, opening or merging a PR). A held run keeps its context and its place, frees its slot for
the next ticket, and continues from that step when you approve, deny with a note, answer its
question, or give it more time. Red is reserved for real failure, and nothing ever auto-retries.
Single-user tool.

## What's in this repo

pnpm workspace, Node 22+:

| Part | Path | What it is |
|---|---|---|
| **Server** (`tada-server`) | `apps/server` | Node/TypeScript daemon: REST + WebSocket API, SQLite, a scheduler that dispatches tickets to agent adapters (Claude via the Claude Agent SDK — the only harness that supports mid-run gates — plus the codex and gemini CLIs). Runs as a systemd service on a box you own, reachable over the private or public network you choose. |
| **Client** (`tada-app`) | `apps/mobile` | One Expo / React Native codebase that builds the iOS app, the Android app, and the web app. |
| **Desktop shell** | `apps/desktop` | Electron wrapper around the web build for macOS. |
| Shared types | `packages/shared` | API types and the run/card state machine, used by both. |

To have a working system you need **the server running somewhere** and **at least one client**
(web, iOS, Android, or desktop) connected to it. Set up the server first — every client just
points at it.

---

## 1. Server

The server is the whole backend: it owns the board, runs the agents, and is the only piece that
needs credentials. It's designed to run 24/7 on a small Linux box (a VM, a mini PC, a home
server), but for a quick local try you can run it on your laptop.

### Prerequisites

- Node 22+ (see `.nvmrc`)
- [pnpm](https://pnpm.io) (`corepack enable` or `npm i -g pnpm`)
- [GitHub CLI](https://cli.github.com) (`gh`) — agents use it to open PRs
- The `claude` CLI, logged into your Claude Max subscription

### Quick local run (try it out)

```sh
git clone <this repo> tada && cd tada
pnpm install
pnpm start          # runs apps/server via tsx, listens on 0.0.0.0:4242
```

First boot creates `~/.config/tada/config.json` with a random bearer token — you'll need that
token to connect a client (see [Authentication](#authentication)).

### Production install (systemd)

Agents run unattended as the server's user, so run it as a dedicated low-privilege account — this
is not optional; read [Security posture](#security-posture) first.

The recommended production setup uses atomic releases, a dedicated `tada` service account,
systemd, and Caddy. Tailscale is optional. On the Linux deployment host:

```sh
pnpm install --frozen-lockfile
pnpm deploy:install
pnpm deploy
```

The installer asks for the site address and TLS mode, requests root only for host setup, and
leaves the application running as the low-privilege `tada` user. Later `pnpm deploy` runs builds
as your normal user and requests sudo only when activating the release and restarting services.

Before the first deploy, authenticate the tools the server shells out to **as the `tada` user**:

- `claude login` — one-time login; the Claude adapter drives Claude Code under this session,
  billed to your Max subscription (no API key involved).
- `gh auth login` — scope the token to just the repos you connect (see
  [Security posture](#security-posture)).

Verify with `curl http://localhost:4242/health`, then grab the bearer token from
`~tada/.config/tada/config.json` for your clients.

See [`docs/deployment.md`](docs/deployment.md) for prerequisites, TLS choices, rollback behavior,
and operations.

### Configuration & data locations

The server follows the XDG base directory spec, with env-var overrides for tests and local dev:

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
`transcripts/<runId>.jsonl`.

`config.json` holds:

| Key | Default | Notes |
|---|---|---|
| `port` | `4242` | TCP port the server listens on |
| `host` | `0.0.0.0` | Bind address; defaults to all interfaces so tailnet clients can connect. The MCP callback URL handed to agent adapters always stays `127.0.0.1` regardless — agents run on the same box. |
| `bearerToken` | random 32-byte hex | See [Authentication](#authentication) |
| `vapidPublicKey` | generated on first boot | VAPID application server key handed to browsers before they subscribe to Web Push |
| `vapidPrivateKey` | generated on first boot | Signs every push. Keep it secret - the file is written `0600` |
| `vapidSubject` | `mailto:daniel@copley.dev` | Contact a push service uses to reach the operator about a misbehaving application |

The VAPID keypair lives here rather than in the database because it is server identity, not a
preference: regenerating it invalidates **every existing push subscription**, and a browser
holding a subscription made with the old key has to unsubscribe before it can re-subscribe. If
either key goes missing the server regenerates both (a mismatched pair signs nothing), so back up
`config.json` alongside the database.

### Authentication

On first run, if `config.json` doesn't exist, the server generates one with a random 32-byte hex
bearer token and writes it to disk. Every request except `GET /health` and the `/mcp` route (used
only by agent runs, which authenticate per-run) must carry:

```
Authorization: Bearer <token from config.json>
```

There are no accounts and no OAuth — this single server-issued token is the entire access control
model. Read `config.json` on the server to get the token for the client app.

---

## 2. Web app

The web client is the Expo codebase exported for the browser — same screens as mobile, plus
desktop niceties like right-click context menus on the board. Served over HTTPS it's also an
installable PWA with Web Push (see [Serving the web build](#serving-the-web-build)).

### Development

```sh
pnpm install
pnpm --filter @tada/mobile web       # starts the Expo web dev server, opens in your browser
```

### Production (static build)

```sh
pnpm --filter @tada/mobile exec expo export --platform web    # writes a static site to apps/mobile/dist/
```

The export uses `web.output: "static"`, so every route is prerendered to its own `.html` file.
That setting is load-bearing rather than cosmetic: the PWA `<head>` is built by
`apps/mobile/app/+html.tsx`, and expo-router only applies that file for static/server output. A
single-page export silently ignores it, taking its shell from `public/index.html` instead — you
get a build with no manifest link and no app icon.

### Serving the web build

Use the supported host installer and release command:

```sh
pnpm deploy:install
pnpm deploy
```

Caddy serves the static export and proxies the API under `/api` on the same origin. The installer
supports public HTTPS, private-CA HTTPS for LAN addresses, and plain HTTP; it does not require
Tailscale. See [`docs/deployment.md`](docs/deployment.md).

### Connecting

On first load the app shows a connection screen. Enter:

- **Server URL** — `https://<host>:8443/api` when fronted by the Caddy config above, or a plain
  `http://<tailnet-address>:4242` if you skip HTTPS (no PWA/push in that case)
- **Bearer token** — from the server's `config.json`

On web, credentials are stored in `localStorage` (unlike native, which uses the secure enclave) —
another reason to keep the whole thing on your tailnet.

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

---

## 3. iOS

Two ways to run it, both from the same codebase:

### Expo Go (fastest — no build, no Mac tooling)

1. Install [Expo Go](https://expo.dev/go) from the App Store.
2. Start the dev server on a machine on the same network:
   ```sh
   pnpm install
   pnpm --filter @tada/mobile start
   ```
3. Scan the QR code with the iPhone camera; the app opens in Expo Go.
4. On the connection screen, enter the server URL and bearer token (see
   [Connecting](#connecting)).

### Native dev build

Needed for reliable push notifications (Expo Go won't deliver them). You need a Mac with Xcode:

```sh
pnpm install
pnpm --filter @tada/mobile ios              # builds and launches in the iOS Simulator
pnpm --filter @tada/mobile ios -- --device  # builds onto a plugged-in iPhone
```

Installing on a physical device requires an Apple developer signing team selected in Xcode (a free
personal team works; the bundle id is `com.anonymous.tada` in `app.json` — change it to something
under your team). Once installed, the app runs standalone: connect it to your server over
Tailscale and it works away from your dev machine.

### Native push (Expo)

The native push path is code-complete but dormant until the app has an EAS project: without a
`projectId`, `getExpoPushTokenAsync` throws and registration is skipped by design. To finish it:

1. Create an Expo account and run `pnpm --filter @tada/mobile exec eas init`.
2. Commit the resulting `extra.eas.projectId` in `apps/mobile/app.json`.
3. Produce a dev or production build; Expo Go alone will not deliver notifications reliably.

Once a device registers a token the server starts delivering to it with no code change — the Expo
channel is always registered, it simply has no tokens until then.

---

## 4. Android

Same two paths as iOS:

### Expo Go

1. Install [Expo Go](https://expo.dev/go) from the Play Store.
2. `pnpm --filter @tada/mobile start`, then scan the QR code from Expo Go.
3. Enter server URL + bearer token on the connection screen.

### Native dev build

Requires Android Studio / the Android SDK:

```sh
pnpm --filter @tada/mobile android    # builds and launches on a connected device or emulator
```

Push setup is the same EAS story as [iOS native push](#native-push-expo). Credentials on both iOS
and Android are stored with `expo-secure-store` (secure enclave / Keystore), so you enter them
once.

---

## 5. Desktop (macOS)

`apps/desktop` (`@tada/desktop`) wraps the same web build in an Electron shell. macOS is the
supported and exercised target (`electron-builder.yml` only declares a `mac` build); Linux and
Windows are out of scope for now and untested. It is a client like the phone app or a browser tab
— it connects to a running `@tada/server` over the network and has no server logic of its own.

### Development

```sh
pnpm --filter @tada/desktop dev
```

This starts the Expo web dev server and, once it's up, launches an Electron window pointed at
`http://localhost:8081`; editing a mobile screen hot-reloads inside the window. Stop with Ctrl+C.

### Packaging a local build

```sh
pnpm --filter @tada/desktop build
```

This exports the mobile app for web, compiles the Electron main/preload, and runs
electron-builder to produce `apps/desktop/release/mac-arm64/tada.app` (path varies by
architecture). The build carries no Developer ID and is not notarized — it's meant to run on the
machine that built it, and macOS will warn about an unidentified developer if the `.app` is copied
elsewhere. The last build step does re-sign the bundle *ad-hoc* with its real identifier
(`dev.tada.desktop`), which has nothing to do with Gatekeeper and everything to do with
notifications: macOS ties notification permission to the code-signature identity, and without it
every notification fails silently. If notifications stop arriving after a packaging change, check
`codesign -dv` on the bundle first.

---

## Using it

- **Board:** drag cards between Backlog, Queued, and Done (Running and Stopped are the runner's
  lanes). Right-click on web / long-press on mobile for the action set (open, approve / deny /
  view diff for a held card, move to, duplicate, copy link, delete).
- **Gates:** when a rule matches (by default: opening or merging a PR), the run halts and the
  card turns to "stopped on you" — approve, always-allow (rewrites the rule), deny with a note,
  answer its question, or grant more time. The run resumes exactly where it held.
- **Push notifications:** native (Expo) and browser (Web Push), and only when a run stops on you
  (permission, question, out of time, failure) plus one optional re-ping. Finished runs are quiet —
  they filed themselves. In a browser, enable them from Settings; on iOS the site must be added to
  the Home Screen first, because Safari grants notification permission only to an installed web
  app. Desktop browsers need no install, but must be running to receive one.
- **Live updates:** board, thread, and run events stream over one WebSocket to every connected
  client.

### Settings & storage

| Platform | Storage method | Scope |
|---|---|---|
| iOS/Android | `expo-secure-store` (native secure enclave) | Credentials only (server URL + token) |
| Web | `localStorage` | All settings including credentials |
| All platforms | In-memory React Query cache | Fetched data (board, memory, rules); cleared on app close |

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
