# Operational resilience

## Restart policy

Production Compose declares `restart: unless-stopped` for PostgreSQL, backend and frontend. A deliberately stopped container stays stopped across daemon restarts; the operator must explicitly start it after maintenance. Retain the existing images, database volume, health checks, dependencies and loopback-only publications.

Compose startup orders DB healthy → backend ready → frontend. Docker daemon recovery does not enforce Compose dependency ordering. The backend can initially fail while PostgreSQL starts; convergence must be tested with the selected runtime and images. An unhealthy but running container is not automatically restarted by this policy. Do not add a competing host restart loop.

Repository integration does not update existing production containers. Applying the policy later needs a separate attended authorization and identity/backup preflight. A reviewed `docker update --restart unless-stopped` targeting exactly the three verified existing IDs can avoid recreation; preserve matching Compose configuration. Rollback restores the previous policy (`no`) on those same IDs and reverts only the three Compose entries, with explicit manual outage coverage. Never remove a volume or change public bindings as a policy rollback.

Fort Worth remains disabled. No migration, application deployment or production reboot is part of this configuration change.

Repository verification on 2026-10-19 exercised Docker 27.5.1 in a disposable Linux daemon with invented readiness tables and the retained approved-source rehearsal images. Passed: exact rendered-config comparison (only three restart fields), backend convergence after delayed DB startup, daemon restart recovery, deliberate stop across daemon restart, clean/nonzero process exit restart, and running-unhealthy nonrestart. This was not a physical VPS reboot or a production operation; amd64 application images ran on the local arm64 Docker host. No startup retry code was needed for the observed convergence.

## Backend idle database failures

The server entry point installs one pool error listener before its first query. PostgreSQL removes a failed idle client; the handler emits `postgres_idle_client_error` with an allowlisted code (otherwise `UNKNOWN`). It never logs connection details, SQL, client objects or exception text. A reporter failure uses a fixed safe fallback event. This does not retry failed requests or financial writes, and it does not change the shared pool factory used by CLI tools.

A real child-server regression terminates only its owned idle connection in a disposable database: the old server exits 1 with uncaught `57P01`; the patched server records the safe event, survives and reconnects. Tests also reject readiness while connections are unavailable, recover readiness afterward, and prove an interrupted checked-out transaction rolls back without replay. Deploying this code requires a new approved image/deployment; setting a restart policy alone does not install it. Database schema/migrations and financial behavior are unchanged.
