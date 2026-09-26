# Improve ticket size readability

## Goal
Make printed size labels easy to read on the small 58 mm thermal ticket by separating the `T` prefix from the size value (for example, `T 4` instead of `T4`). Preserve the distinction between numeric and letter sizes.

## Scope
- Update ESC/POS ticket formatting in `public/printer.js`.
- Add regression coverage in `test/printer.test.js` for numeric and letter sizes and all ticket paths that format sizes.
- Bump the service-worker cache version in `public/sw.js` so installed clients receive the updated formatter.

## Non-goals
- No deployment changes in `gym-homelab`.
- No printer transport, Bluetooth, paper width, or backend changes.
- No changes to sale calculations or stored data.

## Acceptance criteria
- Sale tickets print numeric sizes as `T 4` and letter sizes as `T M`.
- Encargo tickets use the same readable spacing in individual and workshop-summary sections.
- Existing ticket content and ESC/POS framing remain intact.
- Focused and full automated checks pass.

## Progress
- [x] Update formatter and tests.
- [x] Bump frontend cache version and align the app footer version.
- [x] Run verification and record evidence.

## Evidence
- `node --test test/printer.test.js`: 15/15 passed.
- `node --test test/admin-ui-contract.test.js`: 16/16 passed.
- `npm test`: 124/124 passed.
- `npm run check`: passed.
