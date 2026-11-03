#!/usr/bin/env bash
set -euo pipefail
read -rsp 'ORBIT password (at least 16 characters): ' orbit_password
printf '\n'
printf '%s' "$orbit_password" | node --import tsx scripts/provision-user.ts "--email=$1"
unset orbit_password
