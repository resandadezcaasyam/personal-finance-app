#!/usr/bin/env bash
# Repeatable offline verification (Linux). Proves the app works with NO network at all:
#   1) static scan of the source for external URLs,
#   2) production build,
#   3) the ENTIRE end-to-end suite inside a network namespace that has only the loopback interface
#      (no internet, no DNS). Every e2e test additionally fails on any non-localhost request.
# Requires `unshare` with user namespaces. On Windows/macOS: run `npm run check:offline`, disable your network adapter
# (or unplug) and run `npm run test:e2e`; the per-test request log gives the same guarantee.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== 1/3 static scan"; npm run --silent check:offline
echo "== 2/3 build";       npm run --silent build >/dev/null
echo "== 3/3 e2e with loopback only"
unshare -rn python3 scripts/netns-lo-up.py env E2E_SKIP_BUILD=1 PW_NO_SANDBOX=1 npx playwright test --reporter=line
echo "OFFLINE VERIFICATION PASSED"
