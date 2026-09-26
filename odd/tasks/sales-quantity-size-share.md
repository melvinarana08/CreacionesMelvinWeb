# Sales quantity-first flow and digital ticket sharing

## Objective
Align the point-of-sale flow and ticket presentation with the operator's real workflow: select product, choose quantity, choose size, then add the line. Prevent accidental anonymous receipts and allow completed tickets to be shared digitally, including through WhatsApp's system share target.

## Problem and rationale
- The current picker asks for size before quantity and resets quantity when the size changes, which conflicts with the operator's normal sequence.
- Printed ticket lines currently emphasize size before quantity (`T 4 x5`), making rapid reading harder.
- A sale can be finalized with an empty customer name without warning, so operators can accidentally issue an anonymous ticket.
- Completed tickets can be printed but cannot be shared digitally from the web app.

## Scope
- Reorder the sale picker to product → quantity → size and preserve the selected quantity when a size is chosen.
- Make size selection explicit instead of silently choosing the first size.
- Present quantity before size in completed and thermal tickets, using a compact key/header and line form such as `5 # 4`.
- Confirm before finalizing only when the normalized customer name is empty; cancellation must preserve the current sale.
- Add a completed-sale share action using the Web Share API, with a clipboard fallback and clear Spanish status messaging.
- Add focused regression/contract coverage and bump the service-worker cache version.

## Constraints and non-goals
- Preserve existing working-tree changes; do not reset or overwrite them.
- Keep empty customer names valid in storage and backend APIs; this is an operator confirmation guard, not a new server validation rule.
- Do not add a public sale lookup, WhatsApp-specific dependency, backend endpoint, or external sharing service.
- Keep the 58 mm thermal ticket within its existing fixed-width formatting conventions.
- Commit and production deployment were explicitly authorized after implementation verification. The commit must capture the accumulated verified v16 baseline changes already deployed but still uncommitted, plus this v18 feature, so production is not regressed to stale `HEAD` content.
- Production deployment must preserve `.env` and sales data, create a verified backup first, and retain the documented rollback path.

## Implementation route
- Route: delegated direct implementation.
- Trigger evidence: the change requires coordinated non-trivial edits across multiple frontend, printer, service-worker, and test files.
- Writer: `gentle-ai-worker`, single writer in the current worktree.
- Estimated authored diff: approximately 250–350 changed lines, below the 400-line planning heuristic.
- Delivery strategy: `ask-on-risk`; no delivery action is currently authorized.

## Test policy
- TDD mode: unknown; no explicit project/session setting enabling strict TDD was found.
- Source: repository search and current task context.
- Runner: focused Node test files, then `npm test` and `npm run check`.
- Verification approach: ordinary functional regression checks; do not claim RED/GREEN evidence unless actually observed.

## Tasks
- [x] **QSF-1 — Quantity-first picker flow**
  - Move quantity controls before size controls.
  - Require an explicit size choice and do not reset quantity when choosing size.
  - Preserve accessible touch targets, responsive layout, clear Spanish guidance, and stable keyboard focus.
  - Check: an executable helper/interaction test proves selected/ARIA state updates without replacing the focused size control.
- [x] **QSF-2 — Quantity-first ticket presentation**
  - Add a compact quantity/size key to the completed receipt and thermal ticket.
  - Render item metadata quantity-first in the requested form (`5 # 4`) without breaking long names or letter sizes.
  - Wrap long thermal product names within the existing 32-column width across sale, workshop summary, client detail, and individual encargo output.
  - Check: printer tests cover numeric/letter sizes and overlong product names in each thermal path.
- [x] **QSF-3 — Empty-customer confirmation**
  - Ask for explicit confirmation only when the normalized customer name is empty.
  - Cancel before persistence/synchronization and preserve all current sale state.
  - Prevent rapid duplicate finalization while local save is pending.
  - Check: focused tests/contracts cover prompt wiring, cancellation, and named-customer bypass.
- [x] **QSF-4 — Digital ticket sharing**
  - Add a share action to the completed-sale view.
  - Generate plain Spanish ticket text from the current receipt, including pending/synced identity, optional customer, quantity-before-size lines, and totals.
  - Use `navigator.share` when available; otherwise copy through `navigator.clipboard.writeText()` and show clear Spanish status/instructions.
  - If Web Share fails for any reason other than `AbortError`, attempt the clipboard fallback before reporting failure.
  - Check: executable tests cover successful share, `AbortError` without copy, non-cancel rejection followed by copy, copy-only fallback, and final failure.
- [x] **QSF-5 — Cache and verification**
  - Bump and align the frontend service-worker cache version.
  - Run focused tests, full tests, and syntax checks.
  - Check: all authorized commands pass, or failures are recorded accurately.
- [ ] **QSF-6 — Documentation and work-unit commit**
  - Align README, changelog, and design decisions with the implemented quantity-first, anonymous-sale confirmation, and digital sharing behavior.
  - Re-run the full automated checks and scan the staged candidate for secrets or production data.
  - Commit the complete verified working-tree release unit with a Conventional Commit message, excluding local indexes and runtime data.
- [ ] **QSF-7 — Backup, deploy, and live verification**
  - Create and verify a production database backup before replacing application files.
  - Deploy the committed source snapshot to gym-node-02 without replacing `.env`, `data/`, backups, or rollback assets.
  - Rebuild the container and verify health, cache v18, the share control, and container health.
  - Record exact deployment and rollback evidence.

## Acceptance criteria
- After selecting a product, the visible and interactive sequence is quantity first, then size, then add.
- Changing/selecting size does not reset the chosen quantity.
- Tickets show an understandable quantity/size key and quantity-first line data such as `5 # 4`.
- Finalizing with an empty or whitespace-only customer asks for confirmation; declining leaves the sale untouched and performs no save or sync.
- Finalizing with a non-empty customer does not show the anonymous-sale confirmation.
- A completed ticket can be shared through the native share sheet when supported and copied through a clear fallback otherwise.
- Offline/pending tickets never invent a folio; synchronized tickets include the real folio.
- Existing print, local reprint, admin reprint, sale persistence, and offline-first behavior remain functional.

## Progress and evidence
- Exploration completed by `gentle-ai-explore`; mapped relevant UI, app, printer, service-worker, and tests.
- `gentle-ai-worker` implemented the initial QSF-1 through QSF-4 behavior and cache bump without committing or deploying.
- Initial writer verification: `test/frontend-domain.test.js` 27/27, `test/printer.test.js` 15/15, `test/admin-ui-contract.test.js` 22/22, full suite 136/136, and `npm run check` passed.
- Native assessment was unavailable because the dirty worktree contains undeclared untracked files; the prescribed fallback required an independent verifier.
- First independent verification passed all commands but returned `partial`: long product names could exceed 32 thermal columns, failed Web Share did not attempt clipboard fallback, and size selection rebuilt the focused chip.
- The first correction resolved those implementations and again passed 136/136 tests plus syntax checks.
- Second independent verification confirmed the corrected runtime logic but returned `partial`: the focus/share branches were only asserted textually, and long-name wrapping did not yet cover workshop/client/individual encargo ticket generators.
- The second correction added `public/ui-interactions.js` plus six executable interaction tests, extended long-name wrapping across every thermal path, advanced cache/app alignment to v18, and passed 146/146 tests plus syntax checks.
- Native reassessment remained unavailable because undeclared untracked files were present, so an independent final verifier was required again.
- Final independent verification completed with no actionable findings: interaction 6/6, domain 27/27, printer 19/19, UI contract 22/22, full suite 146/146, and `npm run check` passed.
- Parent structural readback confirmed the helper wiring, pre-persistence customer guard, share status handling, and 32-column wrapping across thermal paths.
- Parent spot-check reran `node --test test/ui-interactions.test.js` (6/6) and `git diff --check` completed without errors; only existing line-ending warnings were reported.
- No commit, deployment, dependency installation, or cleanup of unrelated dirty-worktree changes occurred.

## Next step
Align delivery documentation, create the authorized work-unit commit, then back up and deploy the exact committed snapshot to gym-node-02. Device-only smoke checks remain user-owned after deployment.
