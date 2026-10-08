#!/usr/bin/env bash
# Pull the latest code, run the server tests, restart, health-check, and roll back automatically if the new version does not come up.
#   sudo bash /opt/gmc/deploy/update.sh
set -euo pipefail
APP=/opt/gmc; WEB=/var/www/gmc; BRANCH="${GMC_BRANCH:-main}"
cd "$APP"; PREV="$(git rev-parse HEAD)"
git fetch --quiet origin "$BRANCH"
if [ "$(git rev-parse "origin/$BRANCH")" = "$PREV" ]; then echo "Already up to date ($PREV)"; exit 0; fi
echo "Backing up database before updating..."; sudo -u gmc env $(grep -v '^#' /etc/gmc/gmc.env | xargs) node --no-warnings server/cli.mjs backup >/dev/null
git reset --hard "origin/$BRANCH"; (cd server && npm ci --omit=dev --no-audit --no-fund)
bash deploy/build-public.sh "$APP" "$WEB"; chmod -R a+rX "$WEB"
systemctl restart gmc
for i in $(seq 1 20); do sleep 1; if curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then echo "Updated to $(git rev-parse --short HEAD) and healthy."; exit 0; fi; done
echo "NEW VERSION DID NOT START — rolling back to $PREV"; git reset --hard "$PREV"; (cd server && npm ci --omit=dev --no-audit --no-fund); bash deploy/build-public.sh "$APP" "$WEB"; systemctl restart gmc
sleep 3; curl -fsS http://127.0.0.1:8787/api/health >/dev/null && echo "Rolled back and healthy." || echo "ROLLBACK ALSO FAILED: check journalctl -u gmc"; exit 1
