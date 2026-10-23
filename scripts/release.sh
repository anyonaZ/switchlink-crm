#!/usr/bin/env bash
# Builds and starts a release on the server, stamping the git commit into the
# image so More → About and /api/health show exactly what's running.
#   scripts/release.sh
set -euo pipefail
cd "$(dirname "$0")/.."
GIT_COMMIT=$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)
export GIT_COMMIT
echo "Releasing $(node -p "require('./package.json').version") ($GIT_COMMIT)"
docker compose build --pull
docker compose up -d
docker compose ps
