#!/bin/sh
# One backup run: database dump + uploaded files, verified, optionally encrypted
# and copied off-site, then old copies pruned. Runs inside the `backup` service
# (docker-compose.yml) but only needs pg_dump/pg_restore, tar, openssl and
# (for off-site copies) rclone, so it can also run on any machine.
#
# Settings (from .env):
#   BACKUP_PASSPHRASE   encrypt every file with AES-256 (openssl, PBKDF2). Strongly recommended.
#                       Keep the passphrase somewhere safe OFF the server: without it backups can't be restored.
#   RCLONE_REMOTE       e.g. "gdrive:switchlink-backups" or "s3:bucket/crm" (configure with `rclone config`,
#                       file mounted at /config/rclone/rclone.conf). Without it backups stay on this server only.
#   BACKUP_KEEP_DAYS    local copies to keep (default 30)
#   ALERT_WEBHOOK_URL   optional: a failure is POSTed here as JSON (Slack/Teams/ntfy/Google Chat webhook)
# Writes BACKUP_DIR/last-success.json (read by /api/health) or last-failure.json.
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
STORAGE_SRC=${STORAGE_SRC:-/storage}
KEEP=${BACKUP_KEEP_DAYS:-30}
stamp=$(date -u +%Y-%m-%dT%H%MZ)
mkdir -p "$BACKUP_DIR"
cd "$BACKUP_DIR"

fail() {
  msg="$1"
  printf '{"at":"%s","error":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" > last-failure.json
  echo "BACKUP FAILED: $msg" >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    body=$(printf '{"text":"Switchlink CRM backup FAILED at %s: %s"}' "$stamp" "$msg")
    wget -q -O /dev/null --header='Content-Type: application/json' --post-data="$body" "$ALERT_WEBHOOK_URL" 2>/dev/null \
      || curl -fsS -H 'Content-Type: application/json' -d "$body" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
  rm -f "crm-$stamp.dump" "storage-$stamp.tgz"
  exit 1
}

# 1. Database (custom format: compressed, restorable table by table).
pg_dump --format=custom --no-owner --file="crm-$stamp.dump" || fail "pg_dump failed"
pg_restore --list "crm-$stamp.dump" >/dev/null 2>&1 || fail "the database dump can't be read back"

# 2. Uploaded files (KYC documents, statements).
if [ -d "$STORAGE_SRC" ]; then
  tar czf "storage-$stamp.tgz" -C "$STORAGE_SRC" . || fail "archiving uploaded files failed"
  tar tzf "storage-$stamp.tgz" >/dev/null || fail "the files archive can't be read back"
else
  fail "uploaded files folder $STORAGE_SRC not found"
fi

files="crm-$stamp.dump storage-$stamp.tgz"

# 3. Encrypt.
encrypted=false
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  out=""
  for f in $files; do
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$f" -out "$f.enc" || fail "encrypting $f failed"
    rm -f "$f"
    out="$out $f.enc"
  done
  files=$(echo $out)
  encrypted=true
fi
sha256sum $files > "SHA256SUMS-$stamp" || fail "checksums failed"
files="$files SHA256SUMS-$stamp"

# 4. Off-site copy.
offsite=false
if [ -n "${RCLONE_REMOTE:-}" ]; then
  for f in $files; do
    rclone copyto "$f" "$RCLONE_REMOTE/$f" --config "${RCLONE_CONFIG:-/config/rclone/rclone.conf}" || fail "copying $f to $RCLONE_REMOTE failed"
  done
  offsite=true
fi

# 5. Prune old local copies (off-site retention is set on the remote).
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'crm-*' -o -name 'storage-*' -o -name 'SHA256SUMS-*' \) -mtime "+$KEEP" -delete

size=$(du -ck $files | tail -1 | cut -f1)
printf '{"at":"%s","stamp":"%s","files":"%s","sizeKb":%s,"encrypted":%s,"offsite":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$stamp" "$files" "$size" "$encrypted" "$offsite" > last-success.json
rm -f last-failure.json
echo "Backup $stamp written ($size KB, encrypted=$encrypted, off-site=$offsite)."
