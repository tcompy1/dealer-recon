# Dealer-Recon v1 Production Runbook

**Version:** v1
**Environment:** Production
**Deployment Date:** 2026-07-02
**Status:** Active

---

# Production URL

https://app.dealer-recon.io

---

# Infrastructure

Provider:
Hostinger VPS (KVM 2)

Hostname:
dealer.recon.prod

Operating System:
Ubuntu Server 24.04 LTS

Application Directory:
/opt/dealer-recon

Timezone:
America/Chicago

---

# Core Services

Reverse Proxy:
Caddy

Frontend:
Dealer-Recon Frontend

Backend:
Dealer-Recon API

Database:
PostgreSQL 16

Docker:
Docker Compose

---

# Git

Repository:
https://github.com/tcompy1/dealer-recon

Production Branch:
main

---

# Production Accounts

Platform Administrator
- trent@dealer-recon.io

Emergency Administrator
- demo@dealer-recon.io

Pilot User
- tara@dealer-recon.io

Passwords are intentionally not stored in this document.

---

# Deployment

Repository

git pull origin main

Start

docker compose -f docker-compose.prod.yml --env-file .env.production up -d

Verify

docker compose -f docker-compose.prod.yml --env-file .env.production ps

Health

curl https://app.dealer-recon.io/health

Ready

curl https://app.dealer-recon.io/ready

---

# Database Migrations

docker compose \
-f docker-compose.prod.yml \
--env-file .env.production \
run --rm backend npm run migrate:prod

---

# Backups

The original relative-path helper and output-discarding cron example are obsolete for the existing VPS. Do not reinstall them. The October 15 repair uses `/usr/local/sbin/dealer-recon-backup`, explicit production Compose paths, private `/opt/backups/managed` run records, and `/opt/backups/managed/scheduler.log`. Daily scheduling remains 02:00 America/Chicago; revalidate the actual installed command before any change.

Follow [operational resilience](operational-resilience.md) for the repaired wrapper contract, scheduled-outcome adapter, prospective human review and separate activation gates. Repository monitoring code is not evidence of an installed timer or functioning notifications. Never discard backup errors or treat archive validation as restore verification. Preserve historical files and the separately restore-verified recovery checkpoint.

---

# Restore Procedure

Create temporary database

createdb dealer_recon_restore_test

Restore

pg_restore

Verify

- users
- source files
- upload contents
- reconciliation runs
- artifacts
- transactions

Drop temporary database after verification.

---

# Hostinger Snapshots

Infrastructure Baseline

Dealer-Recon Phase 1 Baseline

Production Baseline

Dealer-Recon v1 Production

---

# Health Verification

Backend

https://app.dealer-recon.io/health

Readiness

https://app.dealer-recon.io/ready

---

# Pilot Workflow

1. Login
2. Select Hiley Mazda of Hurst
3. Upload BOA CSV
4. Upload Dealertrack CSV
5. Run reconciliation
6. Review exceptions
7. Download FP REC

---

# Known Limitations

Native .xlsx uploads are not yet supported.

Operators currently convert Excel workbooks to CSV before upload.

Tracked by:

GitHub Issue #36

---

# Operational Notes

Docker log rotation enabled.

Nightly PostgreSQL backups enabled.

Production restore verified.

HTTPS managed automatically by Caddy.

Healthcheck uses:

127.0.0.1:8000/ready

---

# Emergency Recovery

1. Restore latest Hostinger snapshot if infrastructure failure occurs.

2. Restore latest PostgreSQL backup if database corruption occurs.

3. Verify:

- Login
- Upload
- Reconciliation
- Artifacts
- FP REC export

4. Notify pilot users if recovery required.
