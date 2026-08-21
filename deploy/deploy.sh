#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_ROOT="${TADA_INSTALL_ROOT:-/opt/tada-runtime}"
CURRENT_LINK="$INSTALL_ROOT/current"
RELEASES_DIR="$INSTALL_ROOT/releases"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tada-release.XXXXXX")"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

for command_name in git pnpm sudo curl; do
  if ! command -v "$command_name" >/dev/null; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

if [[ ! -f /etc/systemd/system/tada-server.service || ! -f /etc/tada/Caddyfile ]]; then
  echo "Host setup is incomplete. Run 'pnpm deploy:install' first." >&2
  exit 1
fi

cd "$ROOT_DIR"
GIT_SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || printf '%s' unknown)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$GIT_SHA"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"

if [[ -n $(git status --short) ]]; then
  echo "Warning: deploying a worktree with uncommitted changes." >&2
fi

echo "Building web release..."
pnpm build:web
mkdir -p "$STAGE_DIR/web"
cp -a apps/mobile/dist/. "$STAGE_DIR/web/"

PNPM_MAJOR="$(pnpm --version | cut -d. -f1)"
PNPM_STORE_DIR="$(pnpm store path)"
DEPLOY_FLAGS=()
if ((PNPM_MAJOR >= 10)); then
  DEPLOY_FLAGS+=(--legacy)
fi

echo "Building server release..."
PACKAGE_WORKSPACE="$STAGE_DIR/workspace"
mkdir -p "$PACKAGE_WORKSPACE/apps" "$PACKAGE_WORKSPACE/packages"
printf '{"private":true}\n' > "$PACKAGE_WORKSPACE/package.json"
cp pnpm-lock.yaml pnpm-workspace.yaml "$PACKAGE_WORKSPACE/"
cp -a apps/server "$PACKAGE_WORKSPACE/apps/server"
cp -a packages/shared "$PACKAGE_WORKSPACE/packages/shared"

cd "$PACKAGE_WORKSPACE"
pnpm --store-dir "$PNPM_STORE_DIR" --filter @tada/server deploy "${DEPLOY_FLAGS[@]}" --prod "$STAGE_DIR/server"
cd "$ROOT_DIR"
rm -rf "$PACKAGE_WORKSPACE"
printf '%s\n' "$RELEASE_ID" > "$STAGE_DIR/RELEASE"

echo "Requesting root access to activate $RELEASE_ID..."
sudo -v
sudo install -d -o root -g tada -m 0755 "$RELEASE_DIR"
sudo cp -a "$STAGE_DIR/." "$RELEASE_DIR/"
sudo chown -R root:tada "$RELEASE_DIR"
sudo chmod -R a=rX,u+w "$RELEASE_DIR"

PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
sudo ln -sfn "$RELEASE_DIR" "$CURRENT_LINK.next"
sudo mv -Tf "$CURRENT_LINK.next" "$CURRENT_LINK"

rollback() {
  if [[ -n $PREVIOUS_RELEASE && -d $PREVIOUS_RELEASE ]]; then
    echo "Deployment failed; restoring $PREVIOUS_RELEASE." >&2
    sudo ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK.next"
    sudo mv -Tf "$CURRENT_LINK.next" "$CURRENT_LINK"
    sudo systemctl restart tada-server.service
    sudo systemctl restart tada-web.service
  else
    echo "Deployment failed; removing the inactive first release." >&2
    sudo rm -f "$CURRENT_LINK"
    sudo systemctl stop tada-server.service tada-web.service || true
  fi
}

sudo systemctl restart tada-server.service

SERVER_PORT="$(sed -n 's/^TADA_SERVER_PORT=//p' /etc/tada/server.env | tail -1)"
SERVER_PORT="${SERVER_PORT:-4242}"
healthy=false
for _ in {1..30}; do
  if curl --fail --silent --show-error "http://127.0.0.1:$SERVER_PORT/health" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ $healthy != true ]]; then
  sudo journalctl -u tada-server.service --no-pager -n 40 >&2 || true
  rollback
  exit 1
fi

SITE_ADDRESS="$(sed -n 's/^TADA_SITE_ADDRESS=//p' /etc/tada/deploy.env | tail -1)"
CADDY_BIN="$(sed -n 's/^TADA_CADDY_BIN=//p' /etc/tada/deploy.env | tail -1)"
CADDY_BIN="${CADDY_BIN:-$(command -v caddy)}"
if ! sudo -u tada env \
  "TADA_SITE_ADDRESS=$SITE_ADDRESS" \
  "TADA_SERVER_PORT=$SERVER_PORT" \
  "$CADDY_BIN" validate --config /etc/tada/Caddyfile --adapter caddyfile; then
  rollback
  exit 1
fi

if ! sudo systemctl restart tada-web.service; then
  rollback
  exit 1
fi

echo "Deployed $RELEASE_ID"
echo "Bearer token: sudo cat /var/lib/tada/config/config.json"
