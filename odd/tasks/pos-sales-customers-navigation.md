# POS sales, customers, and navigation improvements

## Goal
Improve the point-of-sale workflow with one-off custom size/pricing, clear add-item feedback, adjustable cart quantities, correction of completed sales, saved customer management with typo-tolerant suggestions, a left navigation menu, and a unified three-mode theme control.

## Confirmed decisions
- Deliver the requested work in stages rather than one oversized change.
- A custom size and price applies to the current sale only; it must not mutate the saved catalog.
- Completed sales remain auditable: corrections retain prior values/change history rather than silently replacing history.
- Voided sales are terminal and cannot be edited; edits apply only to active completed sales.
- Replace the current visible three-choice theme selector with one button that cycles Claro → Noche → E-ink and visibly indicates the active mode.
- Preserve the existing offline-first application and current sale/customer behavior unless a task explicitly changes it.
- Preserve pre-existing untracked `NUL`; do not stage, edit, or remove it.

## Existing-code findings
- `public/app.js` owns cart and checkout interactions; `public/domain.js` owns line and amount rules.
- `server/store.js` validates and persists completed sales; the current completed-sale path supports voiding, not editing.
- `public/ui-interactions.js` filters customer suggestions by substring; saved customers and API routes already exist.
- The theme already supports persistent `light|dark|eink` state and currently uses a three-choice selector; the request is a UI change to cycle it with one button.
- This request overlaps the existing quantity-UX workstream but adds edit-in-review and post-completion correction behaviors; retain current quantity bounds and ticket semantics.

## Tasks
- [x] **POS-1 — Improve cart item entry and review** *(verified; delegated direct writer + independent verifier)*
  - Support a one-off manually entered size and price for a sale line without changing the catalog.
  - Show a live, adjacent summary of the item/size/quantity about to be added (example: `Pant. 4 # 6`).
  - Allow increment/decrement of each line quantity during cart review, with existing validation and correct totals.
  - Check: domain/interaction tests cover validation, custom price serialization, preview updates, quantity bounds, and recalculated totals.
- [x] **POS-2 — Correct completed sales with retained history** *(independently verified)*
  - Add an Edit action to completed-sale details that reopens the sale in an editable form populated from the saved sale.
  - Persist corrections while retaining prior sale values and recording correction time and before/after details; do not silently erase the original record.
  - Check: server/API tests cover correction persistence, history, totals/line changes, invalid input, stale revisions/retry behavior, and rejection of edits to voided sales.
- [x] **POS-3 — Add left navigation and saved customer management** *(independently verified)*
  - Add a responsive left-side dropdown/drawer with destinations for sales, customers, and existing administration functions.
  - Provide manual customer creation and saved-name suggestions; rank typo-tolerant matches (e.g. `Prdro` → registered `Pedro`) without losing exact/prefix matches.
  - Keep phone/address profile expansion out of this first increment unless existing customer model makes it a low-risk compatible extension; current request frames those fields as future profile growth.
  - Check: customer matching/creation tests and navigation/accessibility tests; existing free-text customer entry remains supported.
- [x] **POS-4 — Unify theme control** *(independently verified)*
  - Replace the current three-option theme selector with one accessible button cycling Claro → Noche → E-ink, persisting the active mode and announcing/showing the current mode.
  - Preserve existing appearance, theme migration, e-ink constraints, and offline loading.
  - Check: storage and UI tests cover cycle order, persistence, initialization, labels/announcements, and all three theme states.
- [x] **POS-5 — Cross-feature verification** *(complete)*
  - Run focused and complete repository checks, inspect changed contracts and offline/cache behavior, and report remaining limitations and manual checks.
  - Check: `npm test`, `npm run check`, and `git diff --check` pass; verify edited-sale and customer flows structurally.

## Progress
- Read-only exploration delegated to `gentle-ai-explore`; findings and existing test commands recorded above.
- User selected staged delivery, one-off-only size/price, audited completed-sale corrections, and a cycling single-button theme control.
- Baseline branch is `feat/grouped-ticket-lines-quantity-ux`. The only observed untracked path is `NUL`; preserve it.
- Strict TDD is disabled by explicit user choice; run functional regression tests after each stage. Test runner: `node --test` via `npm test`.
- POS-1 verification commands: `node --test test/frontend-domain.test.js test/ui-interactions.test.js test/sales.test.js`, `npm run check`, and `git diff --check`.
- Route for POS-1: one `gentle-ai-worker`; writer delegation is required because the behavior spans multiple non-trivial frontend/domain/server/test files. Parent retains task reconciliation and review.
- POS-1 implemented manual sale-only size/price, add-item preview, and editable cart quantities. Focused writer and independent-verifier command runs each passed 68/68 tests; both `npm run check` and `git diff --check` passed. Git reported an LF→CRLF warning in `test/ui-interactions.test.js`; no whitespace errors.
- POS-1 parent readback confirmed catalog size/price validation remains for ordinary lines and manual prices are explicitly marked, bounded, and stored only on sale snapshots. A native risk assessment was `unassessable` because untracked paths require explicit declaration; the returned plan required an independent verifier, which reported no actionable findings. No real-browser interaction test was run.
- POS-2 architecture map found admin-session + CSRF-protected APIs, transaction-backed sale snapshots, UUID idempotency for creation, void-only admin mutation, schema v2 migrations in `server/db.js`, and no named admin identity (audit actor is IP). User confirmed voided sales stay terminal.
- Recommended POS-2 approach: additive schema migration with revisioned, append-only before/after correction snapshots; admin-only correction endpoint guarded by expected revision and retry key; active sales only. Editing loads the sale into the current panel and submits a correction, not a new sale UUID.
- POS-2 writer implemented the admin correction flow, schema v3 migration, retained snapshots, version/retry controls, and corresponding UI/API/tests. Focused tests passed 67/67; `npm run check` and `git diff --check` passed (LF→CRLF warning only). Native risk assessment again returned `unassessable` because untracked paths are undeclared; its plan requires independent verification before closing this task.
- POS-2 authored change stat was approximately 479 insertions and 31 deletions over the accumulated diff. Independent verification passed the same 67 focused tests, `npm run check`, and `git diff --check`; no actionable findings. Browser interaction coverage remains unrun.
- POS-3 architecture map: top navigation currently exposes Sales/Encargos, Admin is footer-only and authenticated, Customers is a dialog, and a public `POST /api/clients` plus `upsertClient` already saves names (1–100 chars). Customer schema is name-only with case-insensitive unique names; profiles have no phone/address fields. Suggestions are substring-only and ordered by recency.
- POS-3 scope remains manual saved names only; phone/address are explicitly deferred as future profile work. Proposed typo matcher ranks exact/prefix/substrings before bounded edit-distance matches, normalizing case/diacritics without dependencies; keep exact matches ahead of typo suggestions.
- POS-3 implementation route: one delegated writer across `public/index.html`, `public/app.js`, `public/styles.css`, and `public/ui-interactions.js`; it reused client APIs/local storage and did not change schema or server contracts. Focused suite passed 67/67, `npm run check` passed, and `git diff --check` passed with LF→CRLF warnings only. Native assessment returned `unassessable` due undeclared untracked paths, so a separate verifier is required.
- POS-3 independent verification passed 67/67 focused tests, `npm run check`, and `git diff --check`; no actionable findings. Reviewer confirmed authenticated admin access, local offline creation behavior, exact/prefix/substring priority before fuzzy matches, and no phone/address schema fields. No browser run; LF→CRLF warnings only.
- POS-4 writer replaced the selector with an accessible persisted Claro→Noche→E-ink cycle button and advanced PWA cache to v22. Focused theme/storage tests and independent verification both passed 41/41; `npm run check` and `git diff --check` passed. No actionable findings. No real-browser or installed-PWA update check was run.
- Parent readback confirmed correction timestamps/revisions are displayed in the admin sale detail; correction history remains admin-scoped.
- POS-5 independent cross-feature verification passed: `npm test` 189/189, `npm run check` passed, and `git diff --check` passed with LF→CRLF warnings only; no actionable findings.
- Remaining manual checks: real browser/device behavior for sale entry, review quantities, completed-sale correction, customer drawer/suggestions, theme appearance, and installed-PWA v21→v22 activation. No browser or installed-PWA harness was run.
- Source and documentation work-unit commit: `8a2a3204c06bb3357da60d6113fb5acfb4dd0c8b` (`feat(pos): improve sales and customer workflows`), 20 files, 958 insertions/112 deletions. The pre-existing untracked `NUL` remains untouched.
- The user reauthenticated GitHub through the approved device flow; `gh auth status` confirmed account `melvinarana08`, and push succeeded to `origin/feat/grouped-ticket-lines-quantity-ux` (`74f4ea8..8a2a320`). No credentials were exposed or changed by the assistant.
- Native risk assessment was unassessable due untracked inventory. Final inspect offered a branch base-diff slice; one START attempt failed preflight when the untracked inventory changed after the task document became tracked. A fresh inspect was performed, but native review remains unstarted; independent verifiers passed each stage and the full suite.
- Deployment preflight on `gym-node-02` passed: health `ok`, container healthy, named volume `creaciones-melvin_sales-data` mounted, 88 sales, schema v2, and zero correction records. Fresh backup `/home/operator1/backups/sales-2026-09-30T03-14-09-333Z.db` verified at 212,992 bytes with matching SHA-256 `fefad77c79991ca73abe8e660234319fe36414c68de3d2e6c40e1b8c6e926709`; it contains 88 sales/schema v2.
- Committed source archive `8a2a3204c06bb3357da60d6113fb5acfb4dd0c8b` was streamed to `/tmp/creaciones-melvin-v22-8a2a320.tar.gz` on the server (146,596 bytes, SHA-256 `1b55052f227c69ed2ffe65569259c460ea5951e272aacf9e0ba540d13b6be492`). The safety policy blocked the automated extraction/build/start; the user then applied the release manually.
- Post-deployment read-only verification passed: release `/home/operator1/releases/creaciones-melvin-v22-8a2a320-20260930-0315`; health HTTP 200 and container healthy; PWA cache `cm-sales-v22`; five frontend assets HTTP 200; SQLite schema v3 with 88 sales and zero corrections; persistent volume `creaciones-melvin_sales-data` mounted at `/app/data`.
- Added `docs/despliegue-v22-manual.md` as a reproducible operator aid; it remains deliberately untracked and unpushed per the user's temporary-deployment-file instruction. This task-history update is preserved separately from that aid. Real browser/mobile and installed-PWA checks remain pending.
