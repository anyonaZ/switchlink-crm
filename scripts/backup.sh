#!/usr/bin/env bash
# Nightly backup: database dump + uploaded files, kept 30 days.
# Install on the server with:  crontab -e  →  30 1 * * * /opt/switchlink-crm/scripts/backup.sh
# Copy ./backups to a second disk or another machine too: one server is one point of failure.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date +%Y-%m-%d_%H%M)
docker compose exec -T db pg_dump -U crm -d crm --format=custom > "backups/crm-$stamp.dump"
docker compose run --rm -T -v "$(pwd)/backups:/backups" --entrypoint sh app -c "tar czf /backups/storage-$stamp.tgz -C /app storage" >/dev/null
find backups -type f -mtime +30 -delete
echo "Backup written: backups/crm-$stamp.dump"
# Restore: docker compose exec -T db pg_restore -U crm -d crm --clean < backups/crm-<stamp>.dump
