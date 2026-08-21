#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage: pnpm deploy:install [--site ADDRESS] [--tls auto|internal|off] [--yes]

One-time Linux host setup for tada. This creates the tada service account,
persistent directories, and systemd units. It does not deploy a release.

Examples:
  pnpm deploy:install --site https://tada.example.com --tls auto
  pnpm deploy:install --site https://192.168.1.20:8443 --tls internal
  pnpm deploy:install --site http://192.168.1.20:8080 --tls off
USAGE
}

SITE_ADDRESS=""
TLS_MODE=""
ASSUME_YES=false

while (($#)); do
  case "$1" in
    --site)
      SITE_ADDRESS="${2:?--site requires a value}"
      shift 2
      ;;
    --tls)
      TLS_MODE="${2:?--tls requires a value}"
      shift 2
      ;;
    --yes)
      ASSUME_YES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  NODE_BIN="$(command -v node || true)"
  CADDY_BIN="$(command -v caddy || true)"
  sudo_args=(
    "TADA_INSTALL_NODE_BIN=$NODE_BIN"
    "TADA_INSTALL_CADDY_BIN=$CADDY_BIN"
    bash "$0"
  )
  [[ -n $SITE_ADDRESS ]] && sudo_args+=(--site "$SITE_ADDRESS")
  [[ -n $TLS_MODE ]] && sudo_args+=(--tls "$TLS_MODE")
  [[ $ASSUME_YES == true ]] && sudo_args+=(--yes)
  exec sudo "${sudo_args[@]}"
fi

NODE_BIN="${TADA_INSTALL_NODE_BIN:-$(command -v node || true)}"
CADDY_BIN="${TADA_INSTALL_CADDY_BIN:-$(command -v caddy || true)}"

if [[ -z $NODE_BIN || -z $CADDY_BIN ]]; then
  echo "Node.js 22+ and Caddy must be installed before running this installer." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
if ((NODE_MAJOR < 22)); then
  echo "Node.js 22+ is required; found $("$NODE_BIN" --version)." >&2
  exit 1
fi

if [[ -z $SITE_ADDRESS ]]; then
  DEFAULT_HOST="$(hostname -f 2>/dev/null || hostname)"
  DEFAULT_SITE="https://${DEFAULT_HOST}:8443"
  if [[ -t 0 ]]; then
    read -r -p "Site address [$DEFAULT_SITE]: " SITE_ADDRESS
  fi
  SITE_ADDRESS="${SITE_ADDRESS:-$DEFAULT_SITE}"
fi

if [[ -z $TLS_MODE ]]; then
  if [[ $SITE_ADDRESS == http://* ]]; then
    TLS_MODE=off
  elif [[ -t 0 ]]; then
    read -r -p "TLS mode (auto/internal) [internal]: " TLS_MODE
    TLS_MODE="${TLS_MODE:-internal}"
  else
    TLS_MODE=internal
  fi
fi

if [[ $SITE_ADDRESS =~ [[:space:]] ]]; then
  echo "Site address must not contain whitespace." >&2
  exit 2
fi

TLS_SERVER_NAME="$("$NODE_BIN" -e 'console.log(new URL(process.argv[1]).hostname)' "$SITE_ADDRESS")"

case "$TLS_MODE" in
  auto)
    TLS_DIRECTIVE="# automatic TLS"
    ;;
  internal)
    TLS_DIRECTIVE="tls internal"
    ;;
  off)
    if [[ $SITE_ADDRESS != http://* ]]; then
      echo "--tls off requires an http:// site address." >&2
      exit 1
    fi
    TLS_DIRECTIVE="# TLS disabled"
    ;;
  *)
    echo "TLS mode must be auto, internal, or off." >&2
    exit 2
    ;;
esac

missing_build_tools=()
for tool in make g++ python3; do
  command -v "$tool" >/dev/null || missing_build_tools+=("$tool")
done

if ((${#missing_build_tools[@]})); then
  if command -v apt-get >/dev/null; then
    install_tools=$ASSUME_YES
    if [[ $install_tools == false && -t 0 ]]; then
      read -r -p "Install native Node build prerequisites with apt? [Y/n]: " answer
      [[ ${answer:-y} =~ ^[Yy]$ ]] && install_tools=true
    fi
    if [[ $install_tools == true ]]; then
      apt-get update
      apt-get install -y build-essential python3
    else
      echo "Missing build tools: ${missing_build_tools[*]}" >&2
      exit 1
    fi
  else
    echo "Install these native Node build prerequisites first: ${missing_build_tools[*]}" >&2
    exit 1
  fi
fi

OLD_TADA_HOME=""
if id tada >/dev/null 2>&1; then
  if ! runuser -u tada -- "$NODE_BIN" --version >/dev/null || \
    ! runuser -u tada -- "$CADDY_BIN" version >/dev/null; then
    echo "The tada user cannot execute Node or Caddy. Install both system-wide and retry." >&2
    exit 1
  fi
  OLD_TADA_HOME="$(getent passwd tada | cut -d: -f6)"
  if [[ $OLD_TADA_HOME != /var/lib/tada ]]; then
    systemctl stop tada-server.service tada-web.service 2>/dev/null || true
    usermod --home /var/lib/tada --shell /bin/bash tada
  fi
else
  useradd --system --create-home --home-dir /var/lib/tada --shell /bin/bash tada
fi

install -d -o tada -g tada -m 0750 /var/lib/tada
install -d -o root -g tada -m 0755 /opt/tada-runtime /opt/tada-runtime/releases
install -d -o root -g tada -m 0755 /etc/tada
install -d -o tada -g tada -m 0750 \
  /var/lib/tada/data \
  /var/lib/tada/config \
  /var/lib/tada/state \
  /var/lib/tada/caddy/data \
  /var/lib/tada/caddy/config

migrate_legacy_dir() {
  local source_dir="$1"
  local target_dir="$2"
  if [[ -d $source_dir && -z $(find "$target_dir" -mindepth 1 -print -quit) ]]; then
    echo "Migrating $source_dir to $target_dir"
    cp -a "$source_dir/." "$target_dir/"
    chown -R tada:tada "$target_dir"
  fi
}

if [[ -n $OLD_TADA_HOME && $OLD_TADA_HOME != /var/lib/tada ]]; then
  migrate_legacy_dir "$OLD_TADA_HOME/.local/share/tada" /var/lib/tada/data
  migrate_legacy_dir "$OLD_TADA_HOME/.config/tada" /var/lib/tada/config
  migrate_legacy_dir "$OLD_TADA_HOME/.local/state/tada" /var/lib/tada/state
fi

if ! runuser -u tada -- "$NODE_BIN" --version >/dev/null; then
  echo "The tada user cannot execute Node at $NODE_BIN. Install Node system-wide and retry." >&2
  exit 1
fi

sed "s|__NODE_BIN__|$NODE_BIN|g" "$SCRIPT_DIR/tada-server.service" \
  > /etc/systemd/system/tada-server.service
sed "s|__CADDY_BIN__|$CADDY_BIN|g" "$SCRIPT_DIR/tada-web.service" \
  > /etc/systemd/system/tada-web.service
sed \
  -e "s|__TADA_TLS_DIRECTIVE__|$TLS_DIRECTIVE|g" \
  -e "s|__TADA_TLS_SERVER_NAME__|$TLS_SERVER_NAME|g" \
  "$SCRIPT_DIR/Caddyfile" \
  > /etc/tada/Caddyfile

cat > /etc/tada/server.env <<'SERVER_ENV'
TADA_DATA_DIR=/var/lib/tada/data
TADA_CONFIG_DIR=/var/lib/tada/config
TADA_STATE_DIR=/var/lib/tada/state
TADA_SERVER_HOST=127.0.0.1
TADA_SERVER_PORT=4242
SERVER_ENV

cat > /etc/tada/deploy.env <<DEPLOY_ENV
TADA_SITE_ADDRESS=$SITE_ADDRESS
TADA_SERVER_PORT=4242
TADA_CADDY_BIN=$CADDY_BIN
DEPLOY_ENV

chmod 0644 /etc/tada/Caddyfile /etc/tada/server.env /etc/tada/deploy.env
runuser -u tada -- env \
  HOME=/var/lib/tada \
  XDG_DATA_HOME=/var/lib/tada/caddy/data \
  XDG_CONFIG_HOME=/var/lib/tada/caddy/config \
  "TADA_SITE_ADDRESS=$SITE_ADDRESS" \
  TADA_SERVER_PORT=4242 \
  "$CADDY_BIN" validate --config /etc/tada/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable tada-server.service tada-web.service

cat <<SUMMARY

Host setup complete.

Deploy the first release:
  pnpm deploy

Then authenticate agent tools as the service account:
  sudo -iu tada
  claude login
  gh auth login

Site: $SITE_ADDRESS
TLS:  $TLS_MODE
SUMMARY
