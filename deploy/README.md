# Deploying GMC Check-in on your own VPS

What you get: `https://check.yourdomain.pk/portal/` (ERP portal) + the personal offline app at `/`, HTTPS certificates renewed automatically, the server restarted automatically, nightly database backups.

## 0. What you need (and I could not do for you)
| Item | Notes |
|---|---|
| A VPS | Ubuntu 22.04/24.04 or Debian 12. **1 GB RAM is enough for a department; use ≥ 2 GB for the whole university** (measured ~600 MB while serving 30,000 students). 1-2 vCPU. |
| A domain name | e.g. `check.yourcollege.edu.pk`. Add an **A record** pointing to the VPS IP. HTTPS (required for installable app and push notifications) needs a real domain. *For a quick pilot you can try an IP-based name such as `203-0-113-10.sslip.io` (third-party service, unverified here).* |
| Open ports | 22 (SSH), 80, 443 — at the provider firewall too. |
| Written permission | From the college before loading real student data (see `docs/ERP-PLAN.md` §6, §11). |

## 1. Install (≈ 5 minutes)
```bash
ssh root@YOUR_VPS_IP
apt-get update && apt-get install -y git
git clone https://github.com/faxi559233-boop/Lectus.git /opt/gmc
bash /opt/gmc/deploy/install.sh check.yourcollege.edu.pk you@yourcollege.edu.pk --firewall
```
`--firewall` enables ufw allowing only SSH/80/443. Preview first with `DRY_RUN=1 bash /opt/gmc/deploy/install.sh ...`.

## 2. Create the first administrator
```bash
sudo -u gmc env $(grep -v '^#' /etc/gmc/gmc.env | xargs) node --no-warnings /opt/gmc/server/cli.mjs create-admin you@yourcollege.edu.pk "Your Name"
```
It prints a one-time password. Open `https://check.yourcollege.edu.pk/portal/`, sign in, and choose your own password (≥ 10 characters).

## 3. Verify
```bash
bash /opt/gmc/deploy/verify.sh https://check.yourcollege.edu.pk
```
All lines should say OK (health, login required, server code not exposed, HTTPS headers, HTTP→HTTPS redirect).

## 4. Set up the college (portal → Admin)
1. Departments → Programs → Term → Sections (e.g. *BS ECO 5th, Section A*) → Courses → Offerings (course × section × teacher).
2. Users → add teachers/HODs (a one-time password is shown once).
3. Students → *Import* (CSV/XLSX with Roll, Name, Phone) → then **Create logins** for one section at a time (students sign in with their **roll number**). Print or send the credentials sheet; everybody must change the password at first login. *Roll out section by section — see docs/SCALING.md (login cost).*

## 5. Backups (do not skip)
- Automatic: every night ~02:00 a verified copy goes to `/var/backups/gmc/` (14 days kept).
- **Off-site copy**: `apt install rclone`, `rclone config` (remote named `gmc-offsite`), then `crontab -e`: `30 3 * * * /opt/gmc/deploy/offsite-backup.sh`.
- **Restore drill (monthly)**: `sudo -u gmc env $(grep -v '^#' /etc/gmc/gmc.env | xargs) node --no-warnings /opt/gmc/server/cli.mjs restore-drill` → must print `"ok": true`.
- Restore for real: `systemctl stop gmc; cp /var/backups/gmc/gmc-YYYYMMDD-HHMMSS.db /var/lib/gmc/gmc.db; chown gmc:gmc /var/lib/gmc/gmc.db; rm -f /var/lib/gmc/gmc.db-wal /var/lib/gmc/gmc.db-shm; systemctl start gmc`.

## 6. Updating
`sudo bash /opt/gmc/deploy/update.sh` — takes a backup, pulls, installs, restarts, health-checks, and **rolls back automatically** if the new version does not start.

## 7. Day-to-day
| Task | Command |
|---|---|
| App logs | `journalctl -u gmc -f` |
| HTTPS/proxy logs | `journalctl -u caddy -f` · `/var/log/caddy/gmc-access.log` (cookies are stripped) |
| Restart | `systemctl restart gmc` |
| Reset a password | `... cli.mjs reset-password user@college.edu.pk` (or Admin → Users → Reset) |
| Counts | `... cli.mjs stats` |
| Capacity test on THIS machine | `cd /opt/gmc/bench && npm i && node --no-warnings seed-real.mjs /tmp/gmc-real` then start a throw-away server and `node load-real.mjs /tmp/gmc-real` (see header comments) |
| Free uptime monitor | any monitor pinging `https://…/api/health` every minute (email/Telegram on failure) |

## 8. Hardening checklist
- [ ] SSH keys only (`PasswordAuthentication no`), root login disabled **after** you confirm a sudo user works.
- [ ] `unattended-upgrades` enabled.
- [ ] Provider snapshots weekly (in addition to the off-site backup).
- [ ] Two administrators exist (so one lost password is not a lockout).
- [ ] Monthly restore drill done and recorded.

*Not verified on a real VPS by the author:* the apt/NodeSource/Caddy repository steps and the systemd unit were written from the vendors' documented procedures but could only be syntax-checked and dry-run in the build sandbox. Run `verify.sh` and tell me what fails.

## No domain yet? Use a free hostname
HTTPS (needed for the portal's service worker, install-to-home-screen and push) requires a hostname, not a bare IP. Until you buy a domain, use a free wildcard-DNS name that points at your IP, e.g. for IP `203.0.113.7`:

    sudo bash deploy/install.sh 203-0-113-7.sslip.io you@example.com

Caddy gets a real certificate for it automatically. When you buy a domain later: add the A record, then re-run `install.sh` with the new hostname (data and users are kept). Students must be told the new link then, so for the pilot prefer to buy the domain before sharing the link widely.
