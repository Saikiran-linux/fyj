#!/bin/bash
set -e

# Harness verification for the fyj ops-console. Type-checks the Worker API and
# the web UI, and sanity-builds the Drizzle migration. It does NOT (and cannot)
# run anything against a live DB — there is no provisioned Neon/Cloudflare yet
# (see docs/INFRA-SETUP.md). These are the standing gates between sessions.

echo "=== fyj ops-console — harness init ==="

# ── Worker API (root project) ─────────────────────────────────────────
if [ ! -d node_modules ]; then
  echo "=== installing Worker deps (npm) ==="
  npm install
fi

echo "=== Worker: typecheck ==="
npm run typecheck

echo "=== Worker: db:generate (Drizzle migration sanity, no DB needed) ==="
npm run db:generate

# ── Web UI (separate npm project) ─────────────────────────────────────
if [ ! -d web/node_modules ]; then
  echo "=== installing web deps (npm) ==="
  (cd web && npm install)
fi

echo "=== web: typecheck ==="
(cd web && npm run typecheck)

echo ""
echo "=== Verification complete (type-checks + migration only) ==="
echo "NOT verified here (needs infra, see docs/INFRA-SETUP.md):"
echo "  - db:migrate / db:policies against Neon"
echo "  - Worker fetch/auth/RLS end-to-end (the f-133 smoke test)"
echo "  - next build of web/ (run 'cd web && npm run build' for the full UI gate)"
echo ""
echo "Next steps:"
echo "  1. Read feature_list.json (current active: f-134, gated on f-infra)"
echo "  2. Pick ONE unfinished feature"
echo "  3. Implement only that feature; re-run ./init.sh before claiming done"
