#!/usr/bin/env bash
# Install the OMP WebUI daemon as a per-user systemd service (Linux only).
set -euo pipefail

readonly SERVICE_NAME="omp-webui.service"
readonly UNIT_DIR="${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user"
readonly UNIT_PATH="${UNIT_DIR}/${SERVICE_NAME}"
PROJECT_ROOT=""
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PROJECT_ROOT
readonly BUN_BIN="${OMP_WEBUI_BUN_BIN:-bun}"

usage() {
  cat <<'EOF'
Usage: scripts/install-service.sh [--print|install|uninstall]

  --print    Print the systemd --user unit (default)
  install    Write the unit, reload systemd, and enable/start the service
  uninstall  Stop/disable the service and remove its unit

Set OMP_WEBUI_BUN_BIN to use a Bun executable other than `bun`.
macOS and Windows require a manually managed service; this installer is Linux-only.
EOF
}

require_linux_systemd() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    printf '%s\n' "OMP WebUI service installer is Linux-only. Use a manually managed service on macOS or Windows." >&2
    exit 1
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    printf '%s\n' "systemctl is required to manage the OMP WebUI user service." >&2
    exit 1
  fi
}

render_unit() {
  cat <<EOF
[Unit]
Description=OMP WebUI daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${BUN_BIN} packages/daemon/src/index.ts --web-dist packages/web/dist
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF
}

action="${1:---print}"
if [[ "$#" -gt 1 ]]; then
  usage >&2
  exit 2
fi

case "$action" in
  --print)
    require_linux_systemd
    render_unit
    ;;
  install)
    require_linux_systemd
    mkdir -p "$UNIT_DIR"
    render_unit >"$UNIT_PATH"
    systemctl --user daemon-reload
    systemctl --user enable --now "$SERVICE_NAME"
    printf 'Installed and started %s\n' "$SERVICE_NAME"
    ;;
  uninstall)
    require_linux_systemd
    systemctl --user disable --now "$SERVICE_NAME" || true
    rm -f "$UNIT_PATH"
    systemctl --user daemon-reload
    printf 'Removed %s\n' "$SERVICE_NAME"
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
