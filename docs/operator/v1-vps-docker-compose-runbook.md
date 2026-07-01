# Dealer-Recon v1 VPS Deployment Runbook

Status: private Hurst Mazda v1 deployment runbook.
Target: single Ubuntu VPS, Docker Compose, Postgres container, Caddy HTTPS reverse proxy, same-origin frontend/backend.

Do not deploy until Ponytail security/code review findings are resolved or explicitly accepted.

## Selected Target

Use one VPS with:

- Docker Engine and Docker Compose plugin.
- `docker-compose.prod.yml` for Postgres, backend, and frontend.
- Caddy on the host for HTTPS and same-origin routing.
- Postgres volume `postgres_data` for app data.
- Database backups written outside the repo, then copied to durable storage.

This target is the simplest credible first deployment because it matches the repo's production Compose file and avoids cross-site cookie behavior.

## Merge Path

Current deploy branch: `integration-cleanup-2026-06-10`.

Recommended path:

1. Leave or close PR #9 as superseded; it is a draft for `local-integration-2026-06-10`, not the current deployment branch.
2. Open a new PR from `integration-cleanup-2026-06-10` to `main`.
3. In the PR body, include latest validation: backend lint/typecheck/test/build, frontend lint/test/build, and production Compose config.
4. Request final Ponytail/security review on that PR branch.
5. Merge only after CI/review is green and accepted risks are recorded.
6. Deploy from the merge commit on `main`, not from an unmerged branch, unless owner explicitly approves branch deployment.

## Server Setup

Run on a fresh Ubuntu VPS as an operator with sudo access.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl python3 ufw

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin caddy

sudo usermod -aG docker "$USER"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Log out and back in so Docker group membership applies.

## Checkout

```bash
sudo mkdir -p /opt/dealer-recon
sudo chown "$USER":"$USER" /opt/dealer-recon
cd /opt/dealer-recon

git clone https://github.com/tcompy1/dealer-recon.git .
git fetch origin
git checkout main
git pull --ff-only origin main
git rev-parse --short HEAD
```

If deploying before merge by explicit owner approval:

```bash
git checkout integration-cleanup-2026-06-10
git pull --ff-only origin integration-cleanup-2026-06-10
```

## Env File Creation

Set the production hostname first.

```bash
export APP_DOMAIN=dealer-recon.example.com
cp deploy/env.production.example .env.production
chmod 600 .env.production
```

Generate secrets.

```bash
export POSTGRES_PASSWORD="$(openssl rand -hex 32)"
export SESSION_SECRET="$(openssl rand -hex 32)"
```

Write `.env.production`.

```bash
cat > .env.production <<EOF
POSTGRES_DB=dealer_recon
POSTGRES_USER=dealer_recon
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

NODE_ENV=production
DATABASE_URL=postgresql://dealer_recon:${POSTGRES_PASSWORD}@db:5432/dealer_recon
BACKEND_CORS_ORIGINS=https://${APP_DOMAIN}
DEFAULT_DEALERSHIP_ID=1
SESSION_SECRET=${SESSION_SECRET}
VITE_API_BASE_URL=https://${APP_DOMAIN}
EOF
chmod 600 .env.production
```

Verify no placeholder remains.

```bash
grep -n 'CHANGE_ME\|example.com\|localhost\|local-dev' .env.production && exit 1 || true
```

Load the env into the current shell for later commands.

```bash
set -a
source .env.production
set +a
```

## HTTPS Reverse Proxy

Install the Caddy config.

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i "s/dealer-recon.example.com/${APP_DOMAIN}/g" /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The proxy sends backend API paths to port `8000` and all other paths to the frontend on port `5173`.

## Production Compose Config

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config
```

Expected result: rendered config exits `0` and shows `NODE_ENV: production`, same-origin `BACKEND_CORS_ORIGINS`, same-origin `VITE_API_BASE_URL`, and `postgres_data`.

## Production Build

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

## Database Migration

Start only Postgres first.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d db
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Run migrations.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm backend npm run migrate:prod
```

Confirm migration records.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select id, name, run_on from pgmigrations order by run_on, id;"
```

## Startup

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Readiness must fail if migrations are missing and pass after migrations are applied.

```bash
curl -fsS "https://${APP_DOMAIN}/health"
curl -fsS "https://${APP_DOMAIN}/ready"
```

## Smoke Test

Set test credentials for a real production user that has already been provisioned.

```bash
export BASE_URL="https://${APP_DOMAIN}"
export USER_EMAIL="controller@example.com"
export USER_PASSWORD="CHANGE_ME"
export COOKIE_JAR="/tmp/dealer-recon-cookies.txt"
```

Login and verify session.

```bash
curl -fsS -c "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${USER_EMAIL}\",\"password\":\"${USER_PASSWORD}\"}" \
  "${BASE_URL}/login"

curl -fsS -b "$COOKIE_JAR" "${BASE_URL}/me"
```

Upload non-sensitive Hurst-compatible smoke files.

```bash
export BOA_FILE="/path/to/non-sensitive/hurst-boa-smoke.csv"
export DT_FILE="/path/to/non-sensitive/hurst-dealertrack-smoke.csv"

BOA_ID="$(
  curl -fsS -b "$COOKIE_JAR" \
    -F source_type=boa \
    -F store_id=1 \
    -F "file=@${BOA_FILE}" \
    "${BASE_URL}/upload" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["source_file_id"])'
)"

DT_ID="$(
  curl -fsS -b "$COOKIE_JAR" \
    -F source_type=dealertrack \
    -F store_id=1 \
    -F "file=@${DT_FILE}" \
    "${BASE_URL}/upload" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["source_file_id"])'
)"
```

Run reconciliation and verify artifacts.

```bash
RUN_ID="$(
  curl -fsS -b "$COOKIE_JAR" \
    -H "Content-Type: application/json" \
    -d "{\"boa_source_file_id\":${BOA_ID},\"dealertrack_source_file_id\":${DT_ID},\"dealership_store_id\":1}" \
    "${BASE_URL}/reconcile" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["reconciliation_run_id"])'
)"

curl -fsS -b "$COOKIE_JAR" "${BASE_URL}/reconciliation-runs/${RUN_ID}"
curl -fsS -b "$COOKIE_JAR" "${BASE_URL}/reconciliation-runs/${RUN_ID}/artifacts"
curl -fsS -b "$COOKIE_JAR" "${BASE_URL}/reconciliation-runs/${RUN_ID}/fp-rec" -o /tmp/fp-rec-smoke.xls
test -s /tmp/fp-rec-smoke.xls
```

Expected artifact types: `RAW_BOA`, `RAW_DEALERTRACK`, `CLEANED_BOA`, `CLEANED_DEALERTRACK`, `MERGED_FLOORPLAN`, `FP_REC`.

Do not upload real Hurst files until this smoke test passes.

## Backup

Create a backup directory outside the repo and run the helper.

```bash
mkdir -p /opt/dealer-recon-backups
./scripts/backup-postgres.sh .env.production /opt/dealer-recon-backups
ls -lh /opt/dealer-recon-backups
```

Copy the resulting `.dump` to approved durable storage.

## Restore Verification

Verify restore into a separate Compose project and volume, not production.

```bash
export RESTORE_ENV="/tmp/dealer-recon-restore.env"
export RESTORE_PASSWORD="$(openssl rand -hex 32)"
export BACKUP_FILE="/opt/dealer-recon-backups/dealer_recon_YYYYMMDDTHHMMSSZ.dump"

cat > "$RESTORE_ENV" <<EOF
POSTGRES_DB=dealer_recon_restore
POSTGRES_USER=dealer_recon_restore
POSTGRES_PASSWORD=${RESTORE_PASSWORD}
NODE_ENV=production
DATABASE_URL=postgresql://dealer_recon_restore:${RESTORE_PASSWORD}@db:5432/dealer_recon_restore
BACKEND_CORS_ORIGINS=https://${APP_DOMAIN}
DEFAULT_DEALERSHIP_ID=1
SESSION_SECRET=$(openssl rand -hex 32)
VITE_API_BASE_URL=https://${APP_DOMAIN}
EOF

docker compose -p dealer-recon-restore -f docker-compose.prod.yml --env-file "$RESTORE_ENV" up -d db
docker compose -p dealer-recon-restore -f docker-compose.prod.yml --env-file "$RESTORE_ENV" exec -T db \
  pg_restore -U dealer_recon_restore -d dealer_recon_restore --clean --if-exists < "$BACKUP_FILE"
docker compose -p dealer-recon-restore -f docker-compose.prod.yml --env-file "$RESTORE_ENV" exec -T db \
  psql -U dealer_recon_restore -d dealer_recon_restore \
  -c "select count(*) as artifacts from reconciliation_artifacts;"
docker compose -p dealer-recon-restore -f docker-compose.prod.yml --env-file "$RESTORE_ENV" down -v
rm -f "$RESTORE_ENV"
```

Restore verification is not complete until a stored FP REC artifact can be listed and downloaded in a non-production environment.

## Rollback

Prefer rollback to the previous image/build plus database restore from the pre-deployment backup.

```bash
git rev-parse --short HEAD > /tmp/dealer-recon-current-sha.txt
docker compose -f docker-compose.prod.yml --env-file .env.production logs --no-color > "/tmp/dealer-recon-logs-$(date -u +%Y%m%dT%H%M%SZ).log"

git fetch origin
git checkout <previous-good-sha>
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend
curl -fsS "https://${APP_DOMAIN}/ready"
```

If data integrity is in doubt, restore the pre-deployment database backup instead of running down migrations.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production stop backend frontend
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < /path/to/pre-deploy.dump
docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend
curl -fsS "https://${APP_DOMAIN}/ready"
```

After rollback, verify login, upload visibility, run listing, artifact listing, and stored FP REC download.

## Remaining Gates

- Final PR from `integration-cleanup-2026-06-10` to `main` merged or explicitly approved for branch deployment.
- Production hostname selected and DNS pointed at the VPS.
- Real production users provisioned with Hurst store access.
- Non-sensitive smoke BOA/Dealertrack files selected.
- Backup destination and retention approved.
- Restore verification completed before real Hurst data is uploaded.
