# V1 Security Must-Fix Remediation

Issue: https://github.com/tcompy1/dealer-recon/issues/32

Date: 2026-06-23

Scope: minimal remediations from issue #31 for a controlled single-store pilot. No auth redesign, new dependency, or infrastructure rewrite was introduced.

## Fixed Findings

### Login brute-force protection

- Implemented an in-process failed-login throttle in `server/src/app.ts`.
- Limit: 5 failed attempts per client/email key in a 15-minute window.
- Response: `429 LOGIN_RATE_LIMITED`.
- Successful login clears the failure counter for that client/email key.
- Rationale: smallest useful pilot control with no new dependency or infrastructure requirement.

### Artifact download audit logging

- Added `artifact_downloaded` audit events for persisted artifact downloads.
- Captures actor, artifact id, reconciliation run id, artifact type, store id, accounting month, filename, content type, and file size.
- Applied to `/artifacts/:artifactId/download` and stored artifact fallback downloads from merged floorplan / FP REC routes.

### Query-string logging cleanup

- Request logging now records `request.path` and sorted query key names.
- Raw query values are no longer written to application logs.
- Operational troubleshooting keeps route and parameter-shape visibility without logging account/search/date values.

### Dependency audit

- Ran non-breaking `npm audit fix` in `server` and `frontend`.
- Server production audit now passes: `npm audit --omit=dev --audit-level=low`.
- Frontend `@babel/core` advisory was remediated by package updates.

## Deferred Findings

### Frontend Vite/esbuild advisory

- Remaining `npm audit --omit=dev --audit-level=low` frontend finding is the Vite/esbuild dev-server advisory.
- `npm audit fix --force` would install a breaking Vite major version.
- Deferred for a focused toolchain upgrade because the pilot serves built static assets and must not expose the dev server.

### Raw upload and artifact storage protection

- App-level encryption was not added.
- Pilot decision: keep database-backed persistence and require deployment controls instead.
- Required controls: encrypted Postgres volume, encrypted backups, restricted database/admin access, defined backup retention, and private/allowlisted app access.

### Bearer-token fallback

- Not changed in this pass to avoid auth behavior churn.
- Pilot mitigation: frontend uses HTTP-only cookies; do not distribute bearer-token clients for pilot.

## Pilot Mitigations

- Use production config with required `DATABASE_URL`, `BACKEND_CORS_ORIGINS`, `DEFAULT_DEALERSHIP_ID`, and `SESSION_SECRET`.
- Keep pilot access private, VPN-protected, or IP-allowlisted.
- Do not expose Vite/dev server.
- Use named users, strong unique passwords, and no shared demo credentials.
- Restrict DB/admin access and verify encrypted storage/backups before loading real accounting files.
- Review `artifact_downloaded`, login, reconciliation, replay, VIN enrichment, and review workflow audit events during pilot.

## Remaining Risks

- In-process login throttling resets on server restart and is not shared across multiple backend instances.
- Artifact/raw upload confidentiality still depends on deployment storage and backup controls.
- Frontend Vite/esbuild advisory remains until a breaking toolchain upgrade is scheduled.
- Account summary/detail routes remain dealership-scoped, acceptable only for single-store pilot.

## Updated Readiness Verdict

Ready for a controlled single-store pilot once encrypted storage/backups, restricted DB access, and private/allowlisted deployment are confirmed.

Not ready for broad public production until the deferred toolchain upgrade and operational storage controls are closed.
