#!/usr/bin/env bash
# Restore drill: proves the latest backup can actually be restored, WITHOUT
# touching the live CRM. It restores the newest backup into a throwaway
# PostgreSQL and a temporary folder, then checks:
#   - every migration is present, and the main tables have rows;
#   - every KYC document in the database exists in the files archive,
#     and matches its recorded SHA-256.
# Writes backups/last-drill.json. Run monthly (and after any change to backups):
#   scripts/restore-drill.sh            # on the server (uses Docker)
#   DRILL_PG_URL=postgres://… scripts/restore-drill.sh   # against a spare database you provide
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR=${BACKUP_DIR:-backups}
set -a; [ -f .env ] && . ./.env; set +a
work=$(mktemp -d)
container=""
cleanup() { rm -rf "$work"; [ -n "$container" ] && docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

latest=$(ls -1t "$BACKUP_DIR"/crm-*.dump* 2>/dev/null | head -1 || true)
[ -n "$latest" ] || { echo "No backups in $BACKUP_DIR"; exit 1; }
stamp=$(basename "$latest" | sed -E 's/^crm-(.*)\.dump(\.enc)?$/\1/')
echo "Drill on backup $stamp"
dump="$latest"; files=$(ls -1 "$BACKUP_DIR"/storage-"$stamp".tgz* | head -1)
if [ -f "$BACKUP_DIR/SHA256SUMS-$stamp" ]; then (cd "$BACKUP_DIR" && sha256sum -c --quiet "SHA256SUMS-$stamp"); echo "Checksums OK"; fi
dec() { case "$1" in *.enc) openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$1" -out "$2" ;; *) cp "$1" "$2" ;; esac; }
dec "$dump" "$work/crm.dump"; dec "$files" "$work/storage.tgz"
mkdir "$work/storage"; tar xzf "$work/storage.tgz" -C "$work/storage"

if [ -z "${DRILL_PG_URL:-}" ]; then
  container="crm-restore-drill-$$"
  docker run -d --rm --name "$container" -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=crm -e POSTGRES_DB=crm postgres:16-alpine >/dev/null
  for _ in $(seq 1 60); do docker exec "$container" pg_isready -U crm -d crm >/dev/null 2>&1 && break; sleep 1; done
  docker cp "$work/crm.dump" "$container:/tmp/crm.dump" >/dev/null
fi
# The PostgreSQL tools run inside the drill container, so the server needs none installed.
if [ -n "$container" ]; then
  docker exec "$container" pg_restore -U crm -d crm --no-owner /tmp/crm.dump >/dev/null
  q() { docker exec "$container" psql -U crm -d crm -tAc "$1"; }
else
  pg_restore --no-owner --clean --if-exists -d "$DRILL_PG_URL" "$work/crm.dump" >/dev/null 2>&1 || pg_restore --no-owner -d "$DRILL_PG_URL" "$work/crm.dump"
  q() { psql "$DRILL_PG_URL" -tAc "$1"; }
fi
expected=$(grep -c '"tag"' drizzle/meta/_journal.json)
applied=$(q "select count(*) from drizzle.__drizzle_migrations")
users=$(q "select count(*) from users"); accounts=$(q "select count(*) from accounts"); ledger=$(q "select count(*) from disbursements")
problems=0
[ "$applied" -ge "$expected" ] || { echo "FAIL: $applied of $expected migrations in the backup"; problems=$((problems+1)); }
[ "$users" -ge 1 ] || { echo "FAIL: no users in the backup"; problems=$((problems+1)); }
missing=0; mismatched=0; checked=0
while IFS='|' read -r rel sha; do
  [ -z "$rel" ] && continue
  checked=$((checked+1))
  f="$work/storage/$rel"
  if [ ! -f "$f" ]; then missing=$((missing+1)); continue; fi
  if [ -n "$sha" ] && [ "$(sha256sum "$f" | cut -d' ' -f1)" != "$sha" ]; then mismatched=$((mismatched+1)); fi
done < <(q "select file_path, coalesce(sha256,'') from kyc_documents")
[ "$missing" -eq 0 ] || { echo "FAIL: $missing KYC files missing from the archive"; problems=$((problems+1)); }
[ "$mismatched" -eq 0 ] || { echo "FAIL: $mismatched KYC files don't match their SHA-256"; problems=$((problems+1)); }

result=$([ "$problems" -eq 0 ] && echo true || echo false)
printf '{"at":"%s","backup":"%s","ok":%s,"migrations":%s,"users":%s,"accounts":%s,"disbursements":%s,"kycChecked":%s,"kycMissing":%s,"kycMismatched":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$stamp" "$result" "$applied" "$users" "$accounts" "$ledger" "$checked" "$missing" "$mismatched" > "$BACKUP_DIR/last-drill.json"
cat "$BACKUP_DIR/last-drill.json"
[ "$problems" -eq 0 ] && echo "Restore drill PASSED." || { echo "Restore drill FAILED."; exit 1; }
