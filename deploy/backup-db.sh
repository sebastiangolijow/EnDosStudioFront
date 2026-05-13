#!/bin/sh
# =============================================================================
# Daily Postgres backup. Install on the VPS as /etc/cron.daily/stickerapp-backup
# (or as a deploy-user cron). Keeps last 14 days of gzipped pg_dumps locally
# plus a daily rsync of the media volume.
# =============================================================================
set -e

BACKUP_DIR=/opt/stickerapp/backups
TS=$(date +%Y%m%d_%H%M%S)
COMPOSE=/opt/stickerapp/docker-compose.prod.yml

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/media"

# Postgres dump — read creds from the running container.
docker compose -f "$COMPOSE" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip > "$BACKUP_DIR/db/db_${TS}.sql.gz"

# Keep last 14 days.
find "$BACKUP_DIR/db" -name 'db_*.sql.gz' -mtime +14 -delete

# Media: rsync the named volume's contents. Snapshots overkill day 1.
docker compose -f "$COMPOSE" run --rm \
  -v "$BACKUP_DIR/media:/backup" web \
  sh -c 'rsync -a --delete /app/media/ /backup/'
