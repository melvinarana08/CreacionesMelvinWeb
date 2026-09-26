# Visual ticket sharing and mobile/e-ink UX

## Objective
Make ticket sharing preserve its visual structure, make customer entry unmistakably a name field on phones, speed up common quantity selection, and provide a clear high-contrast tablet experience including monochrome e-ink devices.

## Product decisions
- Share a generated **PNG ticket image**, not PDF or JPG. PNG preserves text edges, previews well in messaging apps, and can be generated offline without dependencies.
- Generate the PNG deterministically from the receipt data model with Canvas 2D rather than taking a fragile DOM screenshot.
- Pre-generate/cache the image when the completed receipt renders and regenerate it when a pending receipt receives its real folio. Gate file sharing with `navigator.canShare({ files })`.
- Preserve plain text as companion content. If file sharing is unsupported or fails for a non-cancellation reason, download the PNG and copy the text; `AbortError` remains a cancellation with no fallback side effects.
- Use exact quantity presets **1, 3, 5, 12**, not additive `+3/+5/+12`, so the resulting quantity is always obvious. Keep −/+ for fine adjustment and the 1–99 limit.
- Add a persisted, user-visible **Modo e-ink** control because browser media queries cannot reliably detect e-ink hardware. Also honor reduced-motion and forced-colors preferences automatically.

## Scope
- Add a zero-dependency PNG receipt renderer and executable tests for layout/wrapping/content.
- Extend sharing to prefer a PNG `File` through native Web Share and provide download/text fallbacks.
- Improve customer-field semantics, helper text, saved-client selection, focus behavior, and mobile keyboard hints.
- Add one-tap exact quantity presets with accessible selected state and shared clamping behavior.
- Strengthen tablet layout and add persisted black/white e-ink presentation with no color-only states or unnecessary motion.
- Update static serving, service-worker precache/cache version, syntax checks, documentation, and regression coverage.

## Constraints and non-goals
- Keep zero runtime dependencies and offline-first behavior.
- Do not add a server-side PDF/image service, WhatsApp SDK, analytics, or external CDN.
- Do not alter sale money calculations, stored sale schemas, API contracts, or the 1–99 quantity invariant.
- Do not auto-share, auto-download, or copy after a user cancels the native share sheet.
- Preserve `.env`, production data, and existing unrelated behavior.
- No commit, push, or deployment is authorized by this request.

## Implementation route
- Route: delegated direct implementation.
- Trigger evidence: coordinated non-trivial changes span frontend modules, styles, persistence, server static allowlisting, service worker, and tests.
- Writer: one `gentle-ai-worker` in the current worktree.
- Estimated authored diff: approximately 450–650 changed lines, split conceptually into two reviewable work units (sharing/mobile controls and tablet/e-ink) without code-golf.
- Delivery strategy: `ask-on-risk`; no delivery action is currently authorized.

## Test policy
- Effective strict-TDD mode: disabled.
- Source: explicit user selection in the parent session.
- Verification mode: ordinary focused regression tests followed by `npm test` and `npm run check`; do not claim RED/GREEN evidence.

## Tasks
- [x] **VTE-1 — PNG ticket renderer**
  - Add a pure/testable receipt layout model and browser Canvas renderer for a shareable PNG.
  - Cover long products/custom sizes, Unicode, optional customer/discount, pending/synced folio, 99 quantity, dynamic height, and bounded pixel ratio.
  - Check: executable tests verify deterministic drawing/layout content without requiring a real browser canvas.
- [x] **VTE-2 — Image-first sharing**
  - Pre-generate the receipt PNG and keep the share button state/status intuitive.
  - Share PNG + companion text only when file sharing is supported.
  - Fall back to PNG download plus copied/manual text, while preserving cancellation semantics and revoking object URLs.
  - Check: executable interaction tests cover file share, unsupported files, native rejection, cancellation, download, copy, and final failure.
- [x] **VTE-3 — Intuitive customer entry**
  - Give the main field explicit customer-name semantics and mobile keyboard/autocapitalization hints.
  - Add concise helper text and improve the saved-client button/chips, focus return, and status announcement.
  - Avoid duplicate/conflicting native datalist behavior on mobile.
  - Check: UI contract and interaction tests cover semantics and selection behavior.
- [x] **VTE-4 — One-tap quantity presets**
  - Add exact presets 1/3/5/12 plus existing −/+ fine adjustment.
  - Centralize clamping and UI updates, selected/ARIA state, and boundary disabling without resetting quantity during size selection.
  - Check: executable tests cover presets, 1/99 boundaries, selected state, and preserved size flow.
- [x] **VTE-5 — Tablet and e-ink presentation**
  - Refine responsive tablet columns, spacing, wrapping, sticky behavior, and minimum touch targets.
  - Add persisted e-ink mode with black/white palette, strong borders, text/shape selected states, no shadows/gradients/transparency/motion, and clear statuses.
  - Honor `prefers-reduced-motion` and `forced-colors` independently.
  - Check: storage and UI/CSS contract tests cover persistence, controls, and mode selectors.
- [x] **VTE-6 — Cache, static delivery, docs, and verification**
  - Allowlist/precache every new module, bump aligned app/SW cache version, and include modules in syntax checks.
  - Update README/changelog/design documentation for visual ticket sharing, quantity presets, and e-ink mode.
  - Run focused/full checks and independent verification.

## Acceptance criteria
- WhatsApp/native sharing receives a PNG ticket that remains readable without relying on text-column spacing.
- Unsupported file sharing still gives the operator a downloaded PNG and useful copied/manual text.
- Cancelling the native share sheet causes no download or clipboard mutation.
- The customer field is announced and autofilled as an optional person/customer name, not a password.
- Common quantities 1, 3, 5, and 12 are one tap away; −/+ and 1–99 boundaries still work.
- Tablet layout works at 768–1024 px portrait/landscape without overlap or clipped actions.
- E-ink mode remains usable in grayscale with strong borders, no color-only meaning, and reduced motion.
- All new static modules load over the real HTTP server and offline after service-worker installation.
- Existing sale persistence, printing/reprinting, totals, and synchronization remain unchanged.

## Progress and evidence
- Initial read-only exploration completed; PNG was selected over PDF/JPG based on zero-dependency implementation, messaging preview quality, and offline fallback behavior.
- The first writer exhausted its model token budget and left a recoverable partial implementation; no commit, push, deployment, or dependency installation occurred.
- Read-only incident diagnosis confirmed VTE-1 through VTE-5 were recoverable and identified incomplete v19/static/test/documentation plumbing.
- The resumed writer completed VTE-1 through VTE-5 and the implementation/documentation portion of VTE-6 without committing, pushing, deploying, or installing dependencies.
- Writer verification passed: receipt image 7/7, interactions 11/11, storage 7/7, UI contract 24/24, API 8/8, full suite 163/163, and `npm run check`.
- Writer also addressed delayed object-URL revocation, concurrent-share locking, bounded line clipping, e-ink haptic suppression, 44px directly involved targets, HTTP allowlisting/precache, and cache alignment at v19.
- Native risk assessment was unavailable because the worktree includes intended untracked feature files; the prescribed fallback required an independent verifier.
- Independent verification passed every authorized command and acceptance area, with one low-severity stale README limitation; the limitation was corrected and independently reverified with no remaining findings.
- Parent structural readback confirmed the deterministic PNG model, file-share/cancellation/download state machine, customer semantics, and exact quantity controls.
- Parent spot-check reran `node --test test/receipt-image.test.js` (7/7) and `git diff --check` completed without errors; only non-failing line-ending warnings were reported.
- Final automated evidence remains: focused suites 7/7, 11/11, 7/7, 24/24, and 8/8; full suite 163/163; `npm run check` passed.
- Work-unit commit: `5e902d4` (`feat(pos): add PNG ticket sharing and e-ink UX`); delivery-evidence commit: `fb33346`.
- Native review could not create a lineage because the provider rejected intended-untracked selection as schema-incompatible; the completed independent verifier and parent checks remain the review evidence.
- Pushed `main` through `fb33346` to `origin/main`.
- Deployed the `fb33346` release package to gym-node-02 from `/home/operator1/releases/creaciones-melvin-fb33346-20260926-0927`; preserved the existing `.env` and named SQLite volume.
- Pre-deployment source backup: `/home/operator1/backups/creaciones-melvin-before-fb33346-20260926-092726.tar.gz`.
- Production verification passed: container healthy, `/api/health` OK, `receipt-image.js` served, service worker exposes `cm-sales-v19` and precaches the image module, HTML contains e-ink and quantity controls, and the persistent database reports 67 sales.
- No dependency installation occurred.

## Next step
Run user-owned device smoke checks: Android/iOS file sharing and WhatsApp destination behavior, clipboard-denial/download fallback, 768–1024 px portrait and short-landscape layouts, and physical e-ink refresh/readability.
