# analysis/

This directory is reserved for **local-only** parser exploration, diagnostic
dumps, and ad-hoc analysis output. **Nothing under `analysis/` is committed
except this README and an optional `.gitkeep`.** See `.gitignore` at the repo
root for the exact rules.

## Why this directory is gitignored

Real customer data — VINs, stock numbers, posting dates, dollar amounts, GL
account identifiers, bank reference numbers — is regulated business
information. Even when a single CSV looks innocuous, combining several samples
re-identifies a dealer's floorplan, inventory, and cash position. Treat every
file produced by the parser, the recon engine, or any diagnostic script as
sensitive by default.

## History rewrite — incident note

A prior commit accidentally checked in a real-client diagnostic file
(`analysis/hiley-vin-diagnostics-output.txt`) that contained VINs and stock
numbers from a live dealer dataset. The file was removed and the affected
history was **rewritten and force-pushed**.

Treat the data that was briefly published as **disclosed**. Specifically:

- Assume any clone, fork, mirror, CI artifact cache, or scraper that fetched
  the repository between the leaking commit and the force-push retains a copy.
- Do **not** rely on the rewrite as a remediation by itself. Notify the
  affected dealer, rotate or revoke any credentials or tokens that appeared
  alongside the data, and follow whatever breach-notification process your
  contract or policy requires.
- If you find any other diagnostic output in git history, treat it the same
  way — disclosure first, cleanup second.

## Coordinating future history rewrites

History rewrites are disruptive and only partially effective. Before doing
another one:

1. **Confirm scope.** Use `git log --all -- <path>` and `git log -S '<secret>'`
   to enumerate every commit and ref that touched the data. Branches, tags,
   and PR refs all need to be handled.
2. **Coordinate with collaborators.** A force-push invalidates everyone's
   local clones. Announce the rewrite, give a cutoff time, and have everyone
   re-clone afterward — `git pull --rebase` is not a substitute and will
   silently re-introduce the offending commits.
3. **Use `git filter-repo`** (not the deprecated `filter-branch`) for the
   actual rewrite. Run it against a fresh mirror clone.
4. **Invalidate caches.** Trigger GitHub support to drop dangling commits if
   needed; clear CI artifact stores, container registries, and any
   documentation builds that may have snapshotted the file.
5. **Treat data as disclosed regardless.** See the section above. The rewrite
   reduces future exposure; it does not undo past exposure.

## What's allowed in this directory

Local-only files for your own use:

- Parser sample inputs you generated synthetically.
- Output from `PARSER_DEBUG=true npm run …` redirected to a file.
- One-off scratch notes.

If you ever need to commit something here, add an explicit allow-list entry to
`.gitignore` and have the change reviewed by someone other than the author.
**Default-deny is the policy.**
