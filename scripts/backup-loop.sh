#!/bin/sh
# Runs backup-run.sh every night at 01:30 Nairobi time (the `backup` service's command).
# If the last good backup is more than a day old when it starts, it backs up straight away.
set -u
BACKUP_DIR=${BACKUP_DIR:-/backups}
export TZ=Africa/Nairobi
run() { /usr/local/bin/backup-run.sh || echo "[backup] run failed; see $BACKUP_DIR/last-failure.json" >&2; }

if [ ! -f "$BACKUP_DIR/last-success.json" ] || [ -n "$(find "$BACKUP_DIR/last-success.json" -mmin +1440 2>/dev/null)" ]; then run; fi
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) 01:30" +%s 2>/dev/null || date -d "01:30" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  run
done
