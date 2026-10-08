#!/usr/bin/env bash
# GMC Check-in — one-shot installer for Ubuntu 22.04/24.04 or Debian 12 (run as root).
#   sudo bash deploy/install.sh check.college.edu.pk you@college.edu.pk [--firewall]
# Safe to re-run. Set DRY_RUN=1 to print what would happen without changing anything.
set -euo pipefail
DOMAIN="${1:-}"; CONTACT="${2:-}"; FIREWALL=0; [ "${3:-}" = "--firewall" ] && FIREWALL=1
REPO="${GMC_REPO:-https://github.com/faxi559233-boop/Lectus.git}"; BRANCH="${GMC_BRANCH:-main}"
APP=/opt/gmc; DATA=/var/lib/gmc; BACKUPS=/var/backups/gmc; ETC=/etc/gmc; WEB=/var/www/gmc
say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
run() { if [ "${DRY_RUN:-0}" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }
[ -n "$DOMAIN" ] && [ -n "$CONTACT" ] || { echo "Usage: sudo bash deploy/install.sh <domain> <admin-email> [--firewall]"; exit 2; }
[ "$(id -u)" = 0 ] || [ "${DRY_RUN:-0}" = 1 ] || { echo "Run as root (sudo)."; exit 1; }
getent hosts "$DOMAIN" >/dev/null 2>&1 || echo "WARNING: $DOMAIN does not resolve yet. Point its DNS A record to this server first or HTTPS certificates will fail."

say "1/8 System packages"
run apt-get update -y
run apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https sqlite3 ufw
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]; then
  say "Installing Node.js 22 (NodeSource)"
  run bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -'
  run apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null 2>&1; then
  say "Installing Caddy (official apt repo)"
  run bash -c "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
  run bash -c "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list"
  run apt-get update -y; run apt-get install -y caddy
fi

say "2/8 Service user and folders"
id gmc >/dev/null 2>&1 || run useradd --system --home "$DATA" --shell /usr/sbin/nologin gmc
run install -d -o gmc -g gmc -m 0700 "$DATA" "$BACKUPS"
run install -d -o root -g gmc -m 0750 "$ETC"
run install -d -o caddy -g caddy -m 0755 /var/log/caddy

say "3/8 Application code ($REPO @ $BRANCH)"
if [ -d "$APP/.git" ]; then run git -C "$APP" fetch --quiet origin "$BRANCH"; run git -C "$APP" checkout --quiet "$BRANCH"; run git -C "$APP" reset --hard "origin/$BRANCH"
else run git clone --branch "$BRANCH" "$REPO" "$APP"; fi
run bash -c "cd $APP/server && npm ci --omit=dev --no-audit --no-fund"
run chown -R root:root "$APP"; run chmod -R go-w "$APP"

say "4/8 Configuration"
if [ ! -f "$ETC/gmc.env" ]; then run install -m 0640 -o root -g gmc "$APP/deploy/gmc.env.example" "$ETC/gmc.env"; run sed -i "s|mailto:you@college.edu.pk|mailto:$CONTACT|" "$ETC/gmc.env"; fi
run bash -c "echo 'GMC_DOMAIN=$DOMAIN' > $ETC/caddy.env"; run chmod 0644 "$ETC/caddy.env"

say "5/8 Front-end files for Caddy"
run bash "$APP/deploy/build-public.sh" "$APP" "$WEB"; run chmod -R a+rX "$WEB"

say "6/8 systemd service"
run install -m 0644 "$APP/deploy/gmc.service" /etc/systemd/system/gmc.service
run systemctl daemon-reload; run systemctl enable --now gmc

say "7/8 Caddy (automatic HTTPS)"
run install -m 0644 "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
run mkdir -p /etc/systemd/system/caddy.service.d
run bash -c "printf '[Service]\nEnvironmentFile=$ETC/caddy.env\n' > /etc/systemd/system/caddy.service.d/env.conf"
run systemctl daemon-reload; run caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
run systemctl enable caddy; run systemctl restart caddy

say "8/8 Firewall"
if [ "$FIREWALL" = 1 ]; then run ufw allow OpenSSH; run ufw allow 80/tcp; run ufw allow 443/tcp; run ufw --force enable
else echo "Skipped (pass --firewall to allow only SSH, 80 and 443). Make sure ports 80/443 are open at your provider."; fi

cat <<MSG

Done. Next:
  1) Create the first administrator (shows a one-time password):
       sudo -u gmc env \$(grep -v '^#' $ETC/gmc.env | xargs) node --no-warnings $APP/server/cli.mjs create-admin $CONTACT "Administrator"
  2) Open https://$DOMAIN/portal/ and sign in, then set your own password.
  3) Check:   bash $APP/deploy/verify.sh https://$DOMAIN
  4) Logs:    journalctl -u gmc -f        (app)   |   journalctl -u caddy -f   (HTTPS)
MSG
