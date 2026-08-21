# Deployment

The supported production layout is a single Linux host running the API and web app behind Caddy.
Tailscale is optional: the configured site address can be a public DNS name, a LAN address, or a
Tailscale name when Tailscale is available.

## Prerequisites

Install these on the deployment host:

- Node.js 22 or newer, available system-wide to the `tada` service account
- pnpm
- Caddy
- Git, `curl`, Python 3, `make`, and a C++ compiler
- Agent CLIs such as `claude`, `codex`, or `gemini`, plus `gh`

The release is built on the deployment host because `better-sqlite3` contains a native binary that
must match the host OS, architecture, and Node version.

## First installation

Install workspace dependencies, then run the privileged bootstrap:

```sh
pnpm install --frozen-lockfile
pnpm deploy:install
```

The installer asks for the site address and TLS mode, then uses `sudo` to:

- Create or update the low-privilege `tada` service account.
- Copy legacy XDG data from the account's previous home when the new directories are empty.
- Create persistent data directories under `/var/lib/tada`.
- Install the server and Caddy systemd units.
- Configure Caddy and bind the API to loopback only.
- Install native build prerequisites with `apt` when they are missing and you approve it.

For unattended setup, pass the values explicitly:

```sh
pnpm deploy:install --site https://tada.example.com --tls auto --yes
```

TLS modes:

- `auto`: Caddy obtains a publicly trusted certificate. Use a DNS name that resolves to the host.
- `internal`: Caddy issues a private certificate. Use this for a LAN hostname or IP address.
- `off`: Plain HTTP. PWA installation, service workers, and browser push will not work remotely.

For private TLS, install this CA certificate on each client and trust it:

```sh
sudo cat /var/lib/tada/caddy/data/caddy/pki/authorities/local/root.crt
```

After the first release, authenticate tools as the service account so the systemd process uses the
same credentials:

```sh
sudo -iu tada
claude login
gh auth login
```

## Deploying

From the repository checkout on the deployment host, run:

```sh
pnpm deploy
```

The command exports the Expo web app, creates a production server package, and stages both before
requesting sudo. It then installs `/opt/tada-runtime/releases/<timestamp>-<sha>`, atomically updates
`/opt/tada-runtime/current`, restarts the API, checks `/health`, validates Caddy, and restarts the web
service. A failed health check or web restart restores the previous release automatically.

Persistent files are not stored in a release:

```text
/var/lib/tada/data     SQLite database and repositories
/var/lib/tada/config   bearer token and VAPID identity
/var/lib/tada/state    run journals, worktrees, and transcripts
/var/lib/tada/caddy    certificates and Caddy state
```

Back up all four directories, especially `config/config.json` and the SQLite database.

## Operations

```sh
sudo systemctl status tada-server tada-web
sudo journalctl -u tada-server -f
sudo journalctl -u tada-web -f
sudo cat /var/lib/tada/config/config.json
```

To change the hostname or TLS mode, rerun `pnpm deploy:install` with explicit `--site` and `--tls`
arguments, then run `pnpm deploy`. Existing application data and credentials are preserved.
