#!/usr/bin/env bash
# Runs one backup now (the `backup` service also does this every night at 01:30).
#   scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose run --rm backup /usr/local/bin/backup-run.sh
