#!/usr/bin/env bash
set -euo pipefail
orbit_action="$1"
orbit_repository="$2"
shift 2
cd -- "$orbit_repository"
if [[ "$orbit_repository" != /home/* ]] || ! uname -r | tr '[:upper:]' '[:lower:]' | grep -q 'microsoft-standard'; then
  printf '%s\n' 'Use a WSL2 Linux checkout under /home and enable Docker Desktop WSL integration.' >&2
  exit 1
fi
orbit_node_directory="${ORBIT_NODE_INSTALL_DIR:-$HOME/.local/share/orbit/node24}/bin"
if [[ -x "$orbit_node_directory/node" ]]; then export PATH="$orbit_node_directory:$PATH"; fi
if [[ "$orbit_action" == install ]] && { ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; }; then
  bash ops/windows/install-node.sh
  export PATH="$orbit_node_directory:$PATH"
fi
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then
  printf '%s\n' 'Node.js 24 is required inside WSL2. See docs/LOCAL_SETUP_WINDOWS.md.' >&2
  exit 1
fi
exec node ops/local.mjs "$orbit_action" "$@"
