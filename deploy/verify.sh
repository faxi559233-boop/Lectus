#!/usr/bin/env bash
# Post-deploy smoke test:  bash deploy/verify.sh https://check.college.edu.pk
set -u; URL="${1:?base url, e.g. https://check.college.edu.pk}"; fail=0
ok() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }; bad() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
[ "$(code "$URL/api/health")" = 200 ] && ok "API health" || bad "API health"
[ "$(code "$URL/portal/")" = 200 ] && ok "portal page" || bad "portal page"
[ "$(code "$URL/api/admin/users")" = 401 ] && ok "admin API requires login" || bad "admin API requires login"
for p in /server/config.mjs /server/data/gmc.db /docs/ERP-PLAN.md /.git/config /deploy/install.sh; do [ "$(code "$URL$p")" = 404 ] && ok "not exposed: $p" || bad "EXPOSED: $p"; done
h="$(curl -sI "$URL/portal/")"; for k in strict-transport-security x-content-type-options content-security-policy; do echo "$h" | grep -qi "^$k" && ok "header $k" || bad "missing header $k"; done
curl -sI "http://${URL#https://}/" | grep -qi "^location: https" && ok "HTTP redirects to HTTPS" || bad "HTTP does not redirect to HTTPS"
[ "$fail" = 0 ] && echo "All checks passed." || { echo "Some checks FAILED."; exit 1; }
