#!/usr/bin/env bash
# Restores a backup made by backup-run.sh into THIS deployment (replaces the
# current database and uploaded files). Run on the server, from the project folder:
#
#   scripts/restore.sh backups/crm-<stamp>.dump[.enc] backups/storage-<stamp>.tgz[.enc] --yes
#
# Encrypted files need BACKUP_PASSPHRASE in .env. The app is stopped during the
# restore and started again afterwards. Practise with scripts/restore-drill.sh first.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${3:-}" = "--yes" ] || { echo "This REPLACES the live database and files. Re-run with --yes as the third argument."; exit 1; }
dump=$1 files=$2
set -a; [ -f .env ] && . ./.env; set +a
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
plain() { # decrypts if needed; prints the plain file's path
  case "$1" in
    *.enc) openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$1" -out "$work/$(basename "${1%.enc}")"; echo "$work/$(basename "${1%.enc}")" ;;
    *) echo "$1" ;;
  esac
}
dump=$(plain "$dump"); files=$(plain "$files")
pg_restore --list "$dump" >/dev/null
tar tzf "$files" >/dev/null
echo "Backup files check out. Stopping the app…"
docker compose stop app
docker compose exec -T db pg_restore -U crm -d crm --clean --if-exists --no-owner < "$dump"
docker compose run --rm -T -v "$(cd "$(dirname "$files")" && pwd):/restore:ro" --entrypoint sh app -c \
  "find /app/storage -mindepth 1 -delete && tar xzf /restore/$(basename "$files") -C /app/storage"
docker compose run --rm tools   # applies any newer migrations
docker compose start app
echo "Restored. Sign in and check a few accounts, a KYC document and a report."
