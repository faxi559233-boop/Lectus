#!/usr/bin/env bash
# Copies the nightly database backups to a second place with rclone (Google Drive, S3, Backblaze B2, SFTP ...).
# One-time:  rclone config   (create a remote called "gmc-offsite")   then add to cron:  30 3 * * *  /opt/gmc/deploy/offsite-backup.sh
set -euo pipefail
command -v rclone >/dev/null || { echo "rclone is not installed (apt install rclone)"; exit 1; }
rclone copy /var/backups/gmc gmc-offsite:gmc-backups --max-age 3d --include 'gmc-*.db' --log-level INFO
echo "off-site copy finished $(date -Is)"
