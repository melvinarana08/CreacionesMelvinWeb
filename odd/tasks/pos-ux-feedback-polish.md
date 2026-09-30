# POS feedback and control polish

## Goal
Fix the add-item summary order, make manual synchronization outcomes clear, reduce the visual weight of the theme button, and add only action-oriented icons that improve POS scanning without replacing accessible button labels.

## User intent and decisions
- Add-item preview order is **Product → Quantity → Size** (for example: `Pant. 6 # 4`).
- Keep the **Sincronizar** button: it is useful as a manual retry for pending offline sales, including cases where the browser's online event does not trigger. Improve its progress/result feedback rather than removing it.
- Theme control must display only a subtle theme-dependent emoji; preserve a descriptive accessible name/status announcing the current and next theme.
- Use icons sparingly for primary actions only; keep visible text labels and accessible names. Never replace the words on high-consequence actions.
- Preserve offline-first synchronization, sale data, all three theme persistence, the prior pushed commit, the untracked `NUL`, and temporary deployment runbooks.
- Do not commit or push `docs/despliegue-*.md` or `docs/comandos-despliegue-*.txt` files; they are operator-owned temporary aids.

## Existing-code findings
- `public/domain.js` formats the preview; `public/app.js` updates it.
- `syncAll()` sends IndexedDB-persisted pending sales to `Api.postSale`; automatic retry triggers also exist. The manual button has no dedicated progress/result status today.
- The theme button already persists `light|dark|eink` and announces state, but currently shows a verbose label.
- Existing UI contract and interaction/domain tests cover the relevant app shell and preview; add focused coverage for sync feedback state transitions.

## Tasks
- [x] **UXP-1 — Correct add preview order** *(independently verified)*
  - Format preview as product, quantity, then size, e.g. `Pant. 6 # 4`.
  - Check: domain tests assert the exact order and empty/invalid selection behavior remains clear.
- [x] **UXP-2 — Clarify manual synchronization feedback** *(independently verified; no actionable findings)*
  - Keep the button; expose an accessible “syncing” state and a concise completion/no-pending/offline/failure result, prevent overlapping manual attempts, and preserve pending sales and automatic retry semantics.
  - Check: focused interaction/domain tests cover pending counts, disabled/progress state, result messaging, and failure retention.
- [x] **UXP-3 — Refine theme and primary-action affordances** *(independently verified; no findings)*
  - Make the theme button visually subtle and emoji-only while keeping dynamic accessible label/status; choose clear theme-dependent symbols, including monochrome-safe E-ink presentation.
  - Add a small number of helpful icons to primary Add/Sync/Finalize actions only where they aid scanning; retain visible text and accessible names.
  - Check: UI contract tests verify visible label/emoji, accessible names, target size, focus, and theme cycle behavior.
- [ ] **UXP-4 — Verify and deliver** *(in progress)*
  - Run focused and full tests, syntax and whitespace checks; inspect the combined diff and ensure the deployment helper files remain excluded from commits.
  - Check: `npm test`, `npm run check`, and `git diff --check` pass; commit and push the verified code and non-temporary task evidence to the existing feature branch, excluding `NUL` and deployment helper files.

## Progress
- Context resumed from Engram observation 179 and `odd/tasks/pos-sales-customers-navigation.md`; source commit `8a2a320` is already pushed and deployed as PWA v22.
- User explicitly requested context compression, fixing preview order, evaluating synchronization, subtle emoji theme control, a bounded UX/UI icon pass, and committing/pushing any missing changes.
- Read-only mapping by `gentle-ai-explore` confirmed Sync serves manual offline retry, preview has a domain formatter, and theme already has accessible state announcements.
- Strict TDD is disabled by prior explicit user choice; run functional verification after each stage. Test runner is Node built-in `node:test` via npm scripts.
- Current worktree contains the previous uncommitted ODD delivery-progress update and temporary `docs/despliegue-v22-manual.md`; preserve both as non-code user context, and never include the deployment helper in a commit. Preserve `NUL`.
- Strict TDD is disabled; UXP-1 verification commands: `node --test test/frontend-domain.test.js`, `npm run check`, and `git diff --check`.
- UXP-1 changed only `public/domain.js` and `test/frontend-domain.test.js`; writer and independent verifier each passed 31/31 domain tests plus syntax/whitespace checks. No actionable findings; ticket formatting/payload semantics remain unchanged.
- UXP-2 writer retained Sync, added queue-based progress/results, status announcements, and overlapping-run protection. Focused tests passed 60/60 plus syntax/whitespace checks; native assessment was unassessable because untracked files require declaration.
- Independent verification found a data-integrity gap: a response with `ok: true` but missing/malformed `data.sale` was marked synced. Add response-contract validation before `markSynced`; invalid successful envelopes must remain retryable and count as failures.
- UXP-2 verifier confirmed the server response contract (`{ sale: publicSale }`), that malformed responses cannot mark records synced, and no other actionable findings. Focused tests passed 62/62; npm and diff checks passed. Browser testing remains pending.
- UXP-3 writer made the theme control emoji-only (☀️/🌙/📄), preserved dynamic accessible names and live announcements, added decorative icons to Add/Sync/Finalize without removing labels, and bumped app/service-worker cache to v23. Focused UI contract tests passed 31/31 and npm/whitespace checks passed. Native assessment remains unassessable due untracked files; independent verification is required.
- UXP-3 independent verifier found no issues; 31 UI contract tests passed, app/service-worker v23 aligned, visual device/browser check not performed.
- UXP-4 full independent verification passed `npm test` (195/195), `npm run check`, and `git diff --check`; no actionable findings. Verifier confirmed changed scope and excluded `NUL`/deployment aid from the code diff.
- UXP-4 is preparing one Conventional Commit and push on the existing feature branch. Commit implementation, focused tests, and ODD task evidence; explicitly exclude untracked `NUL` and `docs/despliegue-v22-manual.md`. Real browser/device checks remain pending. Commit identity will be recorded in this feature document after commit.