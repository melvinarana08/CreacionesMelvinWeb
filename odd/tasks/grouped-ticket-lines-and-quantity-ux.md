# Grouped ticket lines and quantity UX

## Goal
Make sale tickets more compact and coherent across thermal printing, shared PNG, and shared text; change quantity presets to 3/6/9/12; give an inline size-selection hint when adding without a size; and streamline confirming a customer so the mobile keyboard stays dismissed and the operator moves to checkout.

## Decisions
- Group all sale lines for the same product, including non-adjacent occurrences, in order of first appearance.
- Keep every quantity/size/unit-price/line-total detail visible underneath that product heading; do not alter sale snapshots, calculations, APIs, or stored data.
- Replace quantity presets 1/3/5/12 with 3/6/9/12; preserve +/- and 1–99 bounds.
- Missing-size guidance is subtle inline UI, not a popup; make the add attempt possible and then report the required size adjacent to the size picker accessibly.
- After confirming a customer in the picker, do not restore focus to either text input; dismiss suggestions/dialog, announce the selection, and scroll to the checkout/finalize-sale area without reopening the mobile keyboard. Preserve direct free-text entry and the existing choice of optional customer.
- Preserve untracked user files (`mejoras.txt`, `NUL`). User authorized commit, push, and production deployment after verification.

## Tasks
- [x] Map detailed renderer and interaction contracts; settle grouping shape and validation behavior.
- [x] Update thermal, PNG, and text ticket grouping with regression tests.
- [x] Update quantity presets, inline missing-size guidance, and customer-confirmation scroll/focus flow with interaction/UI regression tests.
- [x] Align cache and relevant documentation; run focused/full verification and inspect the diff.
- [x] Commit the verified work unit with a Conventional Commit message; record commit evidence.

## Verification
- Focused ticket and interaction tests, full `npm test`, `npm run check`, and `git diff --check`.
- Review grouping order, multi-size and repeated-product behavior, accessibility of the inline guidance, and preservation of money/data contracts.

## Progress
- Read `mejoras.txt`; user confirmed that all same-product lines should be grouped globally, retaining first-appearance product order.
- User added a customer-selection UX requirement: confirming a customer must not refocus an input/reopen the mobile keyboard and should automatically scroll toward sale finalization.
- Read-only explorer mapped relevant code: `public/printer.js`, `public/receipt-image.js`, `public/domain.js`, `public/app.js`, `public/ui-interactions.js`, `public/index.html`, and ticket/interaction tests.
- Implemented global product grouping for thermal/PNG/text sale tickets, quantity presets 3/6/9/12, inline accessible size-required feedback, and customer confirmation without refocusing plus scroll toward checkout. Cache bumped to v21; README, changelog, and design decisions updated.
- Focused verification: `node --test test/printer.test.js test/receipt-image.test.js test/frontend-domain.test.js test/ui-interactions.test.js test/admin-ui-contract.test.js` passed 97/97; `npm run check` passed.
- Independent read-only verification: `npm test` passed 177/177; `npm run check` passed; `git diff --check` passed (Git emitted LF→CRLF warnings only). No actionable findings; verifier confirmed money/API/storage behavior unchanged and user untracked files preserved.
- Working tree began on `main` at `da53688`, clean except pre-existing untracked `NUL` and user request `mejoras.txt`; both are preserved.
- Feature commit: `6910058` (`feat(pos): group ticket items and streamline checkout`) on `feat/grouped-ticket-lines-quantity-ux`.
- Feature branch pushed to `origin/feat/grouped-ticket-lines-quantity-ux`; both commits `6910058` and `b3b1844` are present remotely.
- User approved the one-time Tailscale SSH check and explicitly approved an isolated versioned-release deployment after the in-place overlay was blocked by shell safety; no production source files were changed by the blocked command.
- Verified pre-deployment DB backup: `/home/operator1/backups/sales-2026-09-28T07-25-03-989Z.db`, 75 sales, 200704 bytes, SHA-256 verification passed.
- Production read-only health check before deploy: `http://192.168.1.134:3002/api/health` returned `ok`, version `0.1.0`; container healthy and named volume `creaciones-melvin_sales-data` confirmed.
- Isolated release staging was attempted after user approval but was also blocked by shell safety before execution; no release directory was created and no production source/container changed. A different deployment method is required.
- Preserve the original stack source, `.env`, named sales volume, verified backup files, and `rollback.sh`.
- Preserve untracked user files `mejoras.txt` and `NUL`; do not stage or publish them.
