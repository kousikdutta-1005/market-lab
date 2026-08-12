#!/usr/bin/env bash
# One-time Cloudflare Pages setup for market-lab.
#
# Everything here can be done from the dashboard by hand; this exists so it is done the
# same way twice and so the one genuinely manual step is obvious.
#
# The only thing a human has to do is mint an API token, because Cloudflare will not
# issue one without an existing credential:
#
#   https://dash.cloudflare.com/profile/api-tokens -> Create Token -> Custom token
#   Permissions: Account -> Cloudflare Pages -> Edit
#
# Then:
#   CLOUDFLARE_API_TOKEN=xxx ./scripts/setup_cloudflare.sh
#
# It is safe to re-run: every step checks the current state first.

set -euo pipefail

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-35d86148a77cfdca59d5ab2fcb7c52aa}"
PROJECT="${CF_PROJECT:-market-lab}"
DOMAIN="${CF_DOMAIN:-experiments.kousikdutta.com}"
REPO="${GH_REPO:-kousikdutta-1005/market-lab}"
API="https://api.cloudflare.com/client/v4"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is not set." >&2
  echo "Create one at https://dash.cloudflare.com/profile/api-tokens with" >&2
  echo "Account -> Cloudflare Pages -> Edit, then re-run with it set." >&2
  exit 1
fi

cf() {
  local method="$1" path="$2"
  shift 2
  curl -sS -X "$method" "${API}${path}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" "$@"
}

ok() { python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" <<<"$1"; }
errs() { python3 -c "
import json,sys
d=json.load(sys.stdin)
print('; '.join(f\"{e.get('code')}: {e.get('message')}\" for e in d.get('errors', [])) or 'unknown error')
" <<<"$1"; }

echo "==> Verifying the token"
res="$(cf GET /user/tokens/verify)"
[[ "$(ok "$res")" == "True" ]] || { echo "Token rejected: $(errs "$res")" >&2; exit 1; }
echo "    ok"

echo "==> Checking for an existing '${PROJECT}' project"
res="$(cf GET "/accounts/${ACCOUNT_ID}/pages/projects")"
[[ "$(ok "$res")" == "True" ]] || { echo "Could not list projects: $(errs "$res")" >&2; exit 1; }

kind="$(python3 -c "
import json,sys
d=json.load(sys.stdin)
for p in d.get('result', []):
    if p.get('name') == '${PROJECT}':
        print('git' if p.get('source') else 'direct')
        break
else:
    print('none')
" <<<"$res")"

case "$kind" in
  git)
    # A git-connected project builds the site on Cloudflare, and this site cannot be
    # built from the repository alone: the data comes from the Python pipeline and
    # web/public/data is gitignored. Cloudflare also refuses direct uploads to a project
    # it builds itself, so this has to go.
    echo "    found a git-connected project — deleting it, direct upload needs its own"
    res="$(cf DELETE "/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}")"
    [[ "$(ok "$res")" == "True" ]] || { echo "Delete failed: $(errs "$res")" >&2; exit 1; }
    kind="none"
    ;;
  direct) echo "    a direct-upload project already exists" ;;
  none)   echo "    none yet" ;;
esac

if [[ "$kind" == "none" ]]; then
  echo "==> Creating the direct-upload project"
  res="$(cf POST "/accounts/${ACCOUNT_ID}/pages/projects" \
    --data "{\"name\":\"${PROJECT}\",\"production_branch\":\"main\"}")"
  [[ "$(ok "$res")" == "True" ]] || { echo "Create failed: $(errs "$res")" >&2; exit 1; }
  echo "    created"
fi

echo "==> Attaching ${DOMAIN}"
res="$(cf GET "/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}/domains")"
if python3 -c "
import json,sys
d=json.load(sys.stdin)
sys.exit(0 if any(x.get('name')=='${DOMAIN}' for x in d.get('result', [])) else 1)
" <<<"$res"; then
  echo "    already attached"
else
  res="$(cf POST "/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}/domains" \
    --data "{\"name\":\"${DOMAIN}\"}")"
  if [[ "$(ok "$res")" == "True" ]]; then
    echo "    attached — Cloudflare adds the DNS record itself, the zone is already here"
  else
    echo "    could not attach: $(errs "$res")" >&2
    echo "    add it by hand under Pages -> ${PROJECT} -> Custom domains" >&2
  fi
fi

echo "==> Storing the token as a repository secret"
if command -v gh >/dev/null 2>&1; then
  printf '%s' "${CLOUDFLARE_API_TOKEN}" | gh secret set CLOUDFLARE_API_TOKEN --repo "${REPO}"
  gh secret set CLOUDFLARE_ACCOUNT_ID --repo "${REPO}" --body "${ACCOUNT_ID}"
  echo "    stored"
  echo
  echo "Done. Deploy with:"
  echo "  gh workflow run 'Daily refresh' --repo ${REPO} -f skip_fetch=true"
else
  echo "    gh not found; set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID by hand" >&2
fi
