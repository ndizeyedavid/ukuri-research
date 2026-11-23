#!/usr/bin/env bash

set -uo pipefail

LB="${1:-}"
WEB01="${2:-}"
WEB02="${3:-}"

if [[ -z "$LB" ]]; then
  echo "usage: bash infra/verify.sh <LB01_IP> [WEB01_IP] [WEB02_IP]" >&2
  exit 1
fi

pass=0; fail=0
check() {
  local label="$1" url="$2" expect="$3"
  local body
  body="$(curl -fsS --max-time 8 "$url" 2>/dev/null)"
  if [[ "$body" == *"$expect"* ]]; then
    printf '  PASS  %-28s %s\n' "$label" "$body"; pass=$((pass + 1))
  else
    printf '  FAIL  %-28s expected "%s", got "%s"\n' "$label" "$expect" "${body:-no response}"; fail=$((fail + 1))
  fi
}

echo "Web servers"
[[ -n "$WEB01" ]] && check "web01 /healthz" "http://$WEB01/healthz" '"server":"web01"'
[[ -n "$WEB02" ]] && check "web02 /healthz" "http://$WEB02/healthz" '"server":"web02"'
[[ -n "$WEB01" ]] && check "web01 search proxy" "http://$WEB01/api/search?q=climate&per_page=1" '"results"'
[[ -n "$WEB02" ]] && check "web02 search proxy" "http://$WEB02/api/search?q=climate&per_page=1" '"results"'

echo
echo "Load balancer"
check "lb01 homepage" "http://$LB/" '<title>'
check "lb01 /api/whoami" "http://$LB/api/whoami" '"server"'

echo
echo "Round robin (10 requests)"
declare -A seen=()
for _ in $(seq 1 10); do
  s="$(curl -fsS --max-time 8 "http://$LB/api/whoami" 2>/dev/null | sed -E 's/.*"server":"([^"]+)".*/\1/')"
  seen["${s:-error}"]=$(( ${seen["${s:-error}"]:-0} + 1 ))
done
for k in "${!seen[@]}"; do printf '  %-8s %s\n' "$k" "${seen[$k]}"; done
if [[ "${#seen[@]}" -ge 2 && -z "${seen[error]:-}" ]]; then
  echo "  PASS  traffic reaches both backends"; pass=$((pass + 1))
else
  echo "  FAIL  expected both web01 and web02"; fail=$((fail + 1))
fi

echo
echo "$pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
