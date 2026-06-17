# NEXT STEPS

Status: tomorrow working handoff for Dealer-Recon v1.
Created: Wednesday, June 17, 2026.
Tomorrow: Thursday, June 18, 2026.
Issue: #19.

## Purpose

This document preserves the current repository state, PR state, launch decision state, and the exact first workflow for tomorrow's ChatGPT/Codex session. Use this instead of relying on chat memory.

Dealer-Recon v1 is in release/readiness mode. The current goal is to finish owner decisions and final validation for the single-store Hurst Mazda FP REC pilot. It is not feature-development mode.

## Current Branch And PR State

Target branch for current v1 readiness work:

- integration-cleanup-2026-06-10.

Latest merged work:

- PR #14 / Issue #13: Batch 3 review hardening.
- PR #16 / Issue #15: v1 security and code review packet.

Current open work:

- Draft PR #18 / Issue #17: launch decision package.
- PR #18 is based on integration-cleanup-2026-06-10 and should be reviewed first tomorrow.

Issue #19 creates this next-steps handoff document only. It should not change application code or include PR #18's launch decision docs unless PR #18 is merged separately.

## Current Project State

Dealer-Recon v1 is a single-store Hurst Mazda FP REC pilot. The product supports the clerk's monthly workflow:

1. Upload BOA and Dealertrack source files.
2. Clean and normalize inputs, including removed-row audit and VIN6 extraction.
3. Run reconciliation and review exceptions.
4. Generate and store the Hurst FP REC export.

The FP REC export is the output of record. The dashboard guides the workflow.

Completed areas:

- Upload and duplicate-upload hardening.
- Reviewed-detail artifact source-of-record hardening.
- Store/null-store authorization hardening.
- Frontend/backend error handling hardening.
- v1 security/code review packet.
- Deployment readiness docs.
- Launch decision docs in draft PR #18.

Current launch decision state:

- Owner decision package is drafted in PR #18 but not merged yet.
- Owner decisions are still pending for artifact retention, artifact integrity, accounting month boundary, upload security, CSRF posture, rate limiting, and infrastructure readiness.
- The next engineering activity should be final validation after PR #18 is merged, not new feature work.

## Tomorrow's First Steps

1. Review PR #18 docs.
2. If acceptable, mark PR #18 ready and merge into integration-cleanup-2026-06-10.
3. Confirm the local working tree is clean.
4. Pull latest integration-cleanup-2026-06-10.
5. Decide whether to create a release branch or continue final readiness on the integration branch.
6. Create the next GitHub issue only after PR #18 is merged.

## Next Likely Issue After PR #18

Likely issue title:

v1 Final Validation Signoff

Expected scope:

- Run final validation after PR #18 is merged.
- Re-run server/frontend validation commands.
- Validate known Hurst datasets if available locally.
- Capture final validation signoff doc.
- No product behavior changes.

Expected deliverable:

- A concise final validation signoff document in docs/reviews or another clearly discoverable location.
- A PR referencing the new issue unless the owner explicitly chooses a direct commit process.

## Guardrails

- Do not add new features.
- Do not modify reconciliation behavior.
- Do not introduce Batch 4 scope.
- Do not start multi-store work.
- Do not change deployment architecture unless an explicit blocker is found.
- Do not start analytics, dashboard metric, trend, or reviewer-workload work.
- Work through GitHub issues and PRs only.
- Keep v1 framed as the single-store Hurst Mazda FP REC pilot.
- Keep the stored FP REC export as the output of record.

## Commands To Run Tomorrow

Start here:

```bash
git checkout integration-cleanup-2026-06-10
git pull
git status --short
```

After PR #18 is merged:

```bash
cd server && npm run typecheck
cd server && npm test
cd frontend && npm test -- --run
cd frontend && npm run build
git diff --check
```

Useful PR checks:

```bash
gh pr view 18 --json number,title,state,isDraft,mergeable,baseRefName,headRefName,url
gh pr checkout 18
```

## Session Handoff Summary

For tomorrow's ChatGPT/Codex session:

Start by reviewing draft PR #18 for Issue #17. If the launch decision matrix, launch gate checklist, and pilot recommendation summary are acceptable, mark PR #18 ready and merge it into integration-cleanup-2026-06-10. Then update the local checkout, confirm the worktree is clean, and create the next issue for v1 Final Validation Signoff. Do not begin new feature work or Batch 4 work.

For the human owner:

The project is ready for owner launch decisions, not automatic launch. The next meaningful decision is whether PR #18's launch decision package is acceptable as the go/no-go framework for the private Hurst Mazda FP REC pilot.
