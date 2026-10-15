# Database writes: inventory and migration design (issue #290)

Status: **inventory / design in progress**, started 2026-10-15 after PR #289 was merged.
This file records observed architecture and the intended migration order. It is **not** an implementation of concurrent-write protection.

## Confirmed from the current source

| Storage / writer | Current mechanism | Coordination gap to investigate |
| --- | --- | --- |
| `server.js` | `saveDb()` writes the whole `db.json` synchronously; about 47 call sites including imports, books, loans, settings, and background cover updates | Not universally wrapped by a shared lock. `assertReviewedImportNotLost()` checks selected fields but an independent write can race between check and replacement. |
| `student-management-preload.js` | Multiple atomic JSON replacements; some paired DB/auth writes; PR7 added a mail-specific lock to selected routes | Other writers use different lock disciplines; mixed DB/auth actions must share one transaction. |
| `student-detail-admin-preload.js` | Own DB and auth file writes | Must re-read inside coordinated transaction and avoid overwriting auth changes. |
| `local-password-auth-preload.js` | Own `saveMainDb()` and `saveAuthStore()` | Credential changes, session invalidation and admin state must not be lost. |
| `google-auth-runtime-preload.js` | Own `saveAuthStore()` called from session/link flows | Writes contend with other auth writers and paired commits. |
| `student-google-handoff-preload.js` | Own auth-store writer | Auth link and handoff changes share the same auth file. |
| `link-consistency-preload.js` | Separate auth-store writer | Changes are triggered after API responses; verify no stale read/replace. |
| `google-first-admin-preload.js` / `finalize-school-auth-preload.js` | Paired DB/auth commit for staff/school imports | Need coordination with all DB/auth writers; school-sync has a PR7-specific lock, other paired paths still need inspection. |
| `paired-store-commit.js` | Journal + atomic individual JSON file replacements, recovery on startup | Journal/commit/recovery themselves must run under shared coordination; current design does not enforce a lock on its API. |
| `book-import-reminder-mail.js` | Filesystem lock with a guard file | Candidate primitive on **shared filesystem only**; audit recovery and fault modes before reuse. |

**Source scan note:** These are initial counts/observations, not an exhaustive list of effects. They were gathered from the latest `main` after merging PR7; count comments/wrapper invocations carefully when completing the full write map.

## Deployment prerequisite

`README.md` describes a Sliplane persistent volume with `BOEKENBAAI_DATA_PATH` (for example `/data/db.json`) and the optional `BOEKENBAAI_AUTH_DATA_PATH`. This does **not** prove that multiple Sliplane instances share one POSIX-compatible lockable filesystem. Confirm the deployed topology **before** claiming cross-instance safety.

- Same shared lockable volume: consider a bounded filesystem-coordinated transaction for current JSON format.
- Separate instance volumes or uncertain locking semantics: filesystem locks cannot coordinate instances; need a genuinely shared transactional store/coordinator or ensure a single writer. Do not introduce a paid service silently.

## Required invariants

1. A completed loan/return/import decision must not be silently rolled back by a stale request.
2. Student and teacher transfer/deactivation/account changes remain consistent with the auth identities that reference them.
3. Teacher/admin mail settings and verification addresses survive unrelated writes; deleted accounts cannot be resurrected by stale snapshots.
4. There is at most one active import, including across processes where the storage model supports coordination.
5. Paired `db.json` and auth writes either finish together or recover deterministically after a process crash.
6. External calls (mail bridge, ISBN lookup, book-cover download, Google verification) happen **outside** short database critical sections.
7. Invalid/busy/stale transactions fail explicitly, with idempotent retry only when it is safe; never duplicate loans, emails or imports.

## Migration strategy

### Step A: establish a deterministic failing concurrency baseline

Write tests for two conflicting workers (including distinct Node processes) using temporary isolated DB/auth files. Cases: overlapping mail preference + school sync, loan + book edit, teacher deletion + Google-link write, auth session + paired commit, import + cover background update. Explicitly record which currently fail. Add crash/recovery and lock contention cases.

### Step B: centralized transaction coordinator

Define a small, reusable API that obtains the lock **before reading** current data, runs synchronous mutators on the current state and commits with atomic replacement/recovery while the same lock remains held. For long asynchronous work, split preparation from a short final transaction. Do not assume merely wrapping an existing `saveDb(staleSnapshot)` is sufficient.

For combined DB/auth writes, coordinate both files using a **single lock ordering** and align `paired-store-commit` recovery. Consider a persistent revision or conflict token at the transaction boundary if routes must reject changes based on previously presented data.

### Step C: migrate all writers

Migrate in reviewable chunks, retaining one delivery PR if feasible:
1. Prototype with mail preferences, teacher deletion, student management, and school sync.
2. Primary `server.js` mutations and import/loan/cover background jobs.
3. Auth-only and paired-store writers across Google, student handoff, administrative edits and password reset.
4. Prohibit non-coordinated DB/auth writes except documented, safe startup/bootstrap paths.

### Step D: acceptance

- Unit and HTTP integration tests with deliberate interleavings, including two processes.
- Crash after journal creation and between DB/auth atomic swaps, plus recovery with concurrent callers.
- No regression to active-import exclusion or existing timeout/retry behavior.
- Full `npm test` and `npm run build` pass.
- Full own review before any substantive push and again after fixes; Codex review and justified blocking severity assessment.
- Verify production storage topology, backup and rollback plan before deployment.

## Explicit non-goals

- No rewrite of all business logic at once.
- No temporary/test login or changes to UI in this PR.
- No external infrastructure purchase without authorization.
- No promise of multiple-instance safety until the real deployment has been confirmed.

Next, finish the write map with precise call sites and add the first concurrency reproducer. The follow-on UI/UX review is issue #291.
