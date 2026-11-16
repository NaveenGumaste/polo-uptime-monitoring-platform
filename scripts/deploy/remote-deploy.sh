#!/usr/bin/env bash
set -euo pipefail
umask 077

release=$(pwd -P)
case "$release" in
  /opt/polo/releases/*) ;;
  *) echo "Deployment must run inside /opt/polo/releases" >&2; exit 1 ;;
esac
test -f /var/lib/polo/bootstrap-complete
exec 9>/opt/polo/deploy.lock
flock -w 30 9

# Parent directories stay private; mounted secret files must be readable by container users.
chmod 700 "$release" "$release/secrets"
chmod 600 "$release/secrets/web.env" "$release/secrets/registry-token"
chmod 644 "$release/secrets/discord-webhook" "$release/secrets/grafana-admin-password"
export DOCKER_CONFIG="$release/.docker"
mkdir -m 700 "$DOCKER_CONFIG"
trap 'rm -f "$release/secrets/registry-token"; rm -rf "$DOCKER_CONFIG"' EXIT

compose=(docker compose --project-name polo --env-file "$release/release.env" -f "$release/docker-compose.prod.yml")
"${compose[@]}" config --quiet
docker login ghcr.io --username "$(cat registry-user)" --password-stdin < secrets/registry-token
"${compose[@]}" pull --quiet

previous=$(readlink -f /opt/polo/current || true)
if "${compose[@]}" up --detach --no-build --pull never --wait --wait-timeout 300 &&
   python3 scripts/verify-release.py; then
  ln -sfn "$release" /opt/polo/current
  "${compose[@]}" ps
  echo "Deployment and application verification passed."
else
  echo "Deployment failed; container status follows." >&2
  "${compose[@]}" ps --all
  if [[ -n "$previous" && "$previous" != "$release" && -f "$previous/release.env" ]]; then
    echo "Restoring the previous release." >&2
    docker compose --project-name polo --env-file "$previous/release.env" \
      -f "$previous/docker-compose.prod.yml" up --detach --no-build --pull never --wait --wait-timeout 300
  fi
  exit 1
fi
