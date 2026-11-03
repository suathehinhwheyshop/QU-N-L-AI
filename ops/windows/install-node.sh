#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(uname -m)" == x86_64 ]] || { printf '%s\n' 'This bootstrap supports Linux x64 in WSL2.' >&2; exit 1; }
orbit_node_destination="${ORBIT_NODE_INSTALL_DIR:-$HOME/.local/share/orbit-codex/node24}"
if [[ -x "$orbit_node_destination/bin/node" ]] && "$orbit_node_destination/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then exit 0; fi
[[ ! -e "$orbit_node_destination" ]] || { printf '%s\n' 'Existing Node directory preserved; inspect before updating it.' >&2; exit 1; }
orbit_node_tmp="$(mktemp -d)"
trap 'rm -rf -- "$orbit_node_tmp"' EXIT
orbit_node_archive=node-v24.22.2-linux-x64.tar.xz
curl --fail --location --silent --show-error "https://nodejs.org/dist/v24.22.2/$orbit_node_archive" --output "$orbit_node_tmp/$orbit_node_archive"
printf '%s  %s\n' '48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75' "$orbit_node_tmp/$orbit_node_archive" | sha256sum --check --status
mkdir "$orbit_node_tmp/unpacked"
tar -xJf "$orbit_node_tmp/$orbit_node_archive" -C "$orbit_node_tmp/unpacked" --strip-components=1
mkdir -p -- "$(dirname "$orbit_node_destination")"
mv -- "$orbit_node_tmp/unpacked" "$orbit_node_destination"
"$orbit_node_destination/bin/node" --version
