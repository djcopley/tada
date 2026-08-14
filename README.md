# tada

A personal kanban app (web + mobile) where tickets are tasks for coding agents. You organize
tickets on boards, drag them to a Ready queue, and agents on your self-hosted server pick them
up, do the work against a workspace of git repos (or no repos at all — some tasks are purely
operational), report back on the ticket, and notify your phone. Single-user tool.

`tada-server` is the Node/TypeScript daemon: a REST + WebSocket API, SQLite database, workspace
manager, and scheduler that dispatches tickets to agent adapters (Claude via the Claude Agent SDK
under your Max subscription, plus a pluggable adapter interface for other CLIs). It runs as a
systemd service on a box you own — reachable over your Tailscale tailnet — and every agent run
gets its own git worktree so canonical repo clones stay pristine. This repository contains the
server; the Expo client (`tada-app`, iOS/Android/web) is a separate, future plan.

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
   - `gh auth login` — scope the token to just the repos your workspaces use (see
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
| Workspaces (repo clones, memory) | `$XDG_DATA_HOME/tada` | `~/.local/share/tada` | `TADA_DATA_DIR` |
| Server config (`config.json`) | `$XDG_CONFIG_HOME/tada` | `~/.config/tada` | `TADA_CONFIG_DIR` |
| Transcripts, logs, run journals | `$XDG_STATE_HOME/tada` | `~/.local/state/tada` | `TADA_STATE_DIR` |

Under the data dir, each workspace looks like:

```
workspaces/<ws>/
  manifest.json          # repos, settings, default agent/model
  repos/<repo>/          # canonical clones
  memory/
    AGENTS.md            # workspace charter: conventions, goals, gotchas
    notes/*.md           # durable learnings agents accumulate
```

The SQLite database lives at `$XDG_DATA_HOME/tada/tada.db`.

`config.json` holds:

| Key | Default | Notes |
|---|---|---|
| `port` | `4242` | TCP port the server listens on |
| `host` | `0.0.0.0` | Bind address; defaults to all interfaces so tailnet clients can connect. The MCP callback URL handed to agent adapters always stays `127.0.0.1` regardless of this setting - agents run on the same box. |
| `bearerToken` | random 32-byte hex | See [Authentication](#authentication) |

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
   - Server URL: your Tailscale tailnet address for the `tada` server (e.g., `http://tada.100.x.x.x:4242`)
   - Bearer token: read from the server's `config.json` file (see [Configuration & data
     locations](#configuration--data-locations))

4. Tap "Connect". The app stores credentials securely using `expo-secure-store` (native secure
   enclave on iOS, Keystore on Android), so you won't need to re-enter them.

### Running on web

For development, start the web dev server:

```sh
pnpm --filter @tada/mobile web
```

For a production-ready static build, export to `dist/`:

```sh
cd apps/mobile && npx expo export --platform web
```

The web app uses `localStorage` for settings persistence instead of secure storage. Connect via
the same connection screen as mobile.

### Settings & storage

| Platform | Storage method | Scope |
|---|---|---|
| iOS/Android | `expo-secure-store` (native secure enclave) | Credentials only (server URL + token) |
| Web | `localStorage` | All settings including credentials |
| All platforms | In-memory React Query cache | Fetched data (workspace list, board state); cleared on app close |

### Features & limitations

- **Board interactions:** tap a ticket to open details; long-press to see available actions (move to
  Ready, reorder priority, mark complete). v1 uses tap-driven actions, not free drag-and-drop.
- **Push notifications:** native only. Web builds skip registration; completion/failure events are
  visible in the app's activity feed regardless.
- **Live updates:** board changes and ticket runs stream via WebSocket when connected. Falls back to
  polling if the connection drops.

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
token scoped to workspace repos, per-workspace SSH key); nothing else of yours on the box.
Container-per-run is the known future hardening step and slots into the adapter interface without
redesign.
