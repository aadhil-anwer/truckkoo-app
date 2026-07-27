#!/usr/bin/env bash
# Open the local dev-server ports (Metro / Expo / web preview) in ufw.
#
# Usage:
#   sudo ./scripts/open-dev-ports.sh              # tcp only, any source (default)
#   sudo ./scripts/open-dev-ports.sh --udp        # also add udp rules
#   sudo ./scripts/open-dev-ports.sh --lan        # restrict inbound to private LANs
#   sudo ./scripts/open-dev-ports.sh --ports 8080,8081,8082,19000
#   sudo ./scripts/open-dev-ports.sh --delete     # remove the rules again

set -euo pipefail

PORTS=(8080 8081 8082)
PROTOS=(tcp)
LAN_ONLY=0
DELETE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --udp)    PROTOS=(tcp udp); shift ;;
    --lan)    LAN_ONLY=1; shift ;;
    --delete) DELETE=1; shift ;;
    --ports)
      [[ $# -ge 2 ]] || { echo "--ports needs a comma-separated list" >&2; exit 2; }
      IFS=, read -r -a PORTS <<< "$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "This script needs root. Re-run with: sudo $0 $*" >&2
  exit 1
fi

command -v ufw >/dev/null || { echo "ufw is not installed." >&2; exit 1; }

for p in "${PORTS[@]}"; do
  [[ "$p" =~ ^[0-9]+$ ]] && (( p >= 1 && p <= 65535 )) \
    || { echo "invalid port: $p" >&2; exit 2; }
done

# Private ranges used when --lan is passed.
LAN_NETS=(10.0.0.0/8 172.16.0.0/12 192.168.0.0/16)

verb() { (( DELETE )) && printf 'delete '; }

for proto in "${PROTOS[@]}"; do
  for p in "${PORTS[@]}"; do
    if (( LAN_ONLY )); then
      for net in "${LAN_NETS[@]}"; do
        # shellcheck disable=SC2046
        ufw $(verb)allow in from "$net" to any port "$p" proto "$proto"
      done
    else
      # shellcheck disable=SC2046
      ufw $(verb)allow in "$p"/"$proto"
    fi
    # Outgoing is normally allowed by policy already; explicit rule is harmless.
    # shellcheck disable=SC2046
    ufw $(verb)allow out "$p"/"$proto"
  done
done

# `ufw allow` on an inactive firewall only stages rules; reload would fail.
if [[ "$(ufw status)" == *"Status: active"* ]]; then
  ufw reload
else
  echo
  echo "Note: ufw is inactive — rules are staged but not enforced."
  echo "      Enable it with: sudo ufw enable"
fi

echo
ufw status verbose
