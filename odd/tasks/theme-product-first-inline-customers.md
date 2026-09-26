# Three-state theme, product-first sharing, and inline customers

## Objective
Make the POS PWA more intuitive by offering explicit light, night, and e-ink themes; ensuring every shared ticket presents the product before quantity/size; and exposing saved customers as immediate touch-friendly suggestions without resembling a login username field.

## Product decisions
- Use a compact native theme selector labelled **Tema** with explicit options **Claro**, **Noche**, and **E-ink**. This is the user-selected option and fits the crowded mobile header better than three permanent buttons.
- Persist a three-state `light|dark|eink` preference while migrating existing `cm_eink_mode=true` devices to e-ink. Invalid, absent, or inaccessible storage falls back safely to light.
- Keep current e-ink behavior unchanged, including monochrome styling and disabled haptics. Night mode remains a colored dark theme rather than inheriting e-ink restrictions.
- Shared PNG and plain-text fallback tickets must show the product first, followed by quantity and size, for example `Camisa · 4 # 5`. DOM and thermal tickets are already product-first and should remain so.
- Show recent saved customers directly below the optional customer field when it receives focus or touch. Filter suggestions as the operator types and keep the full directory dialog for larger lists.
- Reduce Chrome credential-manager confusion using `autocomplete="off"`, a sale-specific field name, and a clearer admin-login form boundary. Browser heuristics cannot be fully controlled, so no hidden decoy or readonly hacks will be used.

## Scope
- Replace boolean e-ink persistence with a backwards-compatible three-state theme API.
- Add the compact accessible theme selector, runtime theme application, dynamic browser theme color, and complete dark-mode variables/overrides.
- Change shared PNG and plain-text ticket ordering to product first.
- Add inline saved-customer chips/buttons with filtering, dismissal, focus/touch safety, and status announcements.
- Harden customer-field and admin-login semantics against false credential classification.
- Advance aligned PWA cache/app version to v20 and update tests and Spanish documentation.

## Constraints and non-goals
- Preserve zero runtime dependencies and offline-first behavior.
- Preserve sale calculations, API contracts, database schema, optional free-text customer entry, and the existing full customer-directory dialog.
- Preserve e-ink behavior confirmed working by the user.
- Do not change thermal ticket ordering beyond regression protection because it is already product-first.
- Do not promise complete suppression of Chrome/password-manager suggestions; only reduce false classification using standards-aligned hints and form boundaries.
- No commit, push, or deployment is authorized by this request.

## Implementation route
- Route: delegated direct implementation.
- Trigger evidence: coordinated non-trivial edits span frontend runtime, storage, receipt formatting, responsive styling, service worker, tests, and documentation.
- Writer: one `gentle-ai-worker` in the current worktree.
- Estimated authored diff: approximately 350–500 changed lines; keep changes cohesive rather than code-golfing.
- Delivery strategy: `ask-on-risk`; delivery requires separate explicit authorization.

## Test policy
- Effective strict-TDD mode: disabled.
- Source: explicit user selection earlier in the current parent session.
- Verification mode: focused regression tests, full `npm test`, `npm run check`, `git diff --check`, and independent verification; do not claim RED/GREEN evidence.

## Tasks
- [x] **MTP-1 — Migrate persisted themes**
  - Add validated `light|dark|eink` loading and saving.
  - Migrate legacy `cm_eink_mode=true` to e-ink while defaulting false/missing/malformed/inaccessible state to light.
  - Check: storage tests cover all values, migration, malformed state, blocked storage, rollback mirroring, and partial-write restoration.
- [x] **MTP-2 — Add selector and night presentation**
  - Replace the e-ink toggle with a labelled native selector and apply one root theme state.
  - Add dark variables/overrides, selected state, 44px target, dynamic theme color, preserved e-ink/reduced-motion/forced-colors behavior, and accessible amber-control contrast.
  - Check: UI/CSS contracts cover selector semantics, root state, theme color, dark styling, e-ink haptic suppression, contrast, and v20 alignment.
- [x] **MTP-3 — Put product first in shared tickets**
  - Render product before quantity/size in PNG and plain-text sharing.
  - Keep wrapping lossless and DOM/thermal paths product-first.
  - Check: executable receipt/domain tests assert ordering, including a long product.
- [x] **MTP-4 — Show inline saved customers**
  - Render recent/filter-matching saved names below the field on focus or touch.
  - Use real buttons, at least 44px targets, safe deferred blur/outside/Escape dismissal, selection announcement, and existing storage/directory sources.
  - Check: interaction tests cover visibility, filtering, selection, touch-safe focus behavior, Escape/outside dismissal, and empty results.
- [x] **MTP-5 — Reduce credential autofill confusion**
  - Change customer autocomplete/name hints and establish a clear admin-login form boundary.
  - Preserve optional free-text entry and mobile keyboard behavior.
  - Check: HTML contracts reject username/password-like customer semantics and retain correct admin password autocomplete.
- [x] **MTP-6 — Cache, docs, and verification**
  - Advance app/service-worker/contracts to v20 and update README, changelog, and design decisions.
  - Run focused/full checks and independent verification.

## Acceptance criteria
- Existing devices with `cm_eink_mode=true` remain in e-ink after upgrade.
- Claro, Noche, and E-ink selections persist across reloads and expose an intuitive labelled mobile control.
- Night mode is readable throughout the POS; e-ink remains monochrome and motion/haptic constrained.
- Shared PNG and plain-text tickets always show product before quantity/size.
- Focusing or touching the customer field reveals recent saved names as buttons directly below it.
- Typing filters suggestions; selecting one fills the field, hides suggestions, and announces the choice without losing the touch action.
- Escape, outside interaction, and leaving the customer control dismiss suggestions predictably.
- The customer remains optional free text and no longer requests semantic name/username autofill.
- The admin password remains correctly scoped as a credential field.
- Cache v20 serves every changed frontend asset offline, and existing sale persistence/printing/synchronization regressions remain green.

## Progress and evidence
- User confirmed the deployed e-ink mode works well on a real device.
- Read-only exploration mapped current boolean theme storage, shared ticket paths, customer directory flow, Chrome-autofill risks, tests, and cache implications.
- User selected the compact native theme selector.
- Baseline worktree was clean: local `main` and `origin/main` both resolved to `75a677cb2b9e387d0e67f1582b7cfa259046abee`.
- The writer implemented MTP-1 through MTP-5 plus the cache/documentation portion of MTP-6. Initial focused suites passed and the full suite reached 170/170.
- First independent verification found two medium issues: malformed new theme state incorrectly triggered legacy e-ink migration, and amber controls retained insufficient white-text contrast. It also identified this progress document as stale.
- A failed correction-agent launch changed no files. Fresh read-only diagnosis confirmed the two issues were still present and the worktree had no conflict markers or correction-specific corruption.
- The bounded correction now distinguishes absent from malformed theme state, restores both prior storage keys after a partial mirrored write, uses a shared dark amber foreground, and adds focused regression coverage.
- Corrected writer verification passed: storage 12/12, UI contract 26/26, full suite 174/174, `npm run check`, and scoped `git diff --check`.
- Final independent verification confirmed all runtime acceptance areas and every authorized command: storage 12/12, receipt image 7/7, interactions 14/14, domain 28/28, UI contract 26/26, full suite 174/174, `npm run check`, and scoped `git diff --check`.
- Its only remaining findings were this unchecked MTP-6 progress marker and ambiguous migration wording in `docs/DECISIONS.md`; both documentation issues were corrected without changing runtime code.
- The two documentation corrections were independently reverified with no remaining findings; documentation `git diff --check` passed.
- Parent structural readback confirmed theme migration/rollback, product-first PNG layout, theme application, inline customer touch/focus flow, and e-ink haptic suppression. Parent reran `npm test` successfully at 174/174 and `git diff --check` without errors.
- Native review could not create a lineage because intended-untracked selection returned schema-incompatible; the completed independent verifier and parent checks remain the review evidence.
- Work-unit commit: `a093fcf` (`feat(pos): add themes and inline customer suggestions`); delivery-evidence commit: `eef713e`.
- Pushed `main` through `eef713e` to `origin/main`.
- Pre-deployment source backup: `/home/operator1/backups/creaciones-melvin-source-before-eef713e-20260926-130623.tar.gz`.
- Verified SQLite backup: `/home/operator1/backups/sales-2026-09-26T19-06-24-425Z.db` with matching SHA-256 and 69 sales.
- Deployed from `/home/operator1/releases/creaciones-melvin-eef713e-20260926-1307` using the preserved production `.env` and named volume `creaciones-melvin_sales-data`.
- Live verification passed: container healthy, `/api/health` OK, 69 sales preserved, HTML exposes the theme selector and inline customers, service worker serves cache v20 with changed shell assets, dark/amber styles are present, and PNG/plain-text sharing code is product-first.

## Next step
User-owned real-device/browser checks: theme appearance and selector fit, Chrome credential heuristics, touch/focus customer behavior, forced-colors/reduced-motion, installed-PWA v19→v20 activation, shared PNG/text appearance, and physical thermal output.
