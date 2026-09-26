# Accessible reprint and UX audit

## Goal
Make ticket reprinting safe and available to non-admin operators while improving clarity for older users, then correct verified project defects and deploy the reviewed candidate.

## Scope
- Add same-device recent-sale history from existing IndexedDB records; do not expose a public folio search or sale enumeration endpoint.
- Add confirmation after a successful ticket print, print-button locking, and clear status messages for sale/reprint/encargo print actions.
- Add local print-history helpers and focused tests.
- Fix sale idempotency so an existing UUID replays successfully even after catalog prices change, with regression coverage.
- Fix the delivered encargo CSS class mismatch.
- Update stale printing documentation and cache/version expectations as needed.
- Preserve the independent Gym OS printer boundary and existing offline-first behavior.

## Non-goals
- No public cross-device sale lookup by folio.
- No changes to admin authorization boundaries or deployment secrets.
- No changes to printer transport, paper width, or stored sale calculations.
- No automatic commit or release; deployment is explicitly authorized by the user, but commit remains separate.

## Acceptance criteria
- A non-admin operator can open a clear "Reimprimir venta" action and select recent sales stored on that device.
- Synced sales show folio/date/total; pending sales remain printable and are clearly identified.
- A second successful print of the same ticket asks for confirmation; failed prints do not trigger that confirmation.
- Print controls cannot be double-submitted while a print is in progress.
- Idempotent sale replay remains successful after a catalog price change.
- Accessibility/readability improvements remain proportionate and tests pass.
- Live deployment reports healthy and serves the reviewed cache version.

## Deferred findings
- Protect `/api/clients` with seller-token policy after confirming operational token expectations.
- Resolve the encargo delivery ordering race in a separate transaction-focused change.
- Decide whether cross-device reprint by folio is required after testing same-device history.

## Progress
- [x] Add local recent-sale reprint.
- [x] Prevent accidental duplicate printing.
- [x] Fix audited correctness issues and docs.
- [x] Verify and deploy.

## Evidence
- Focused regression/contract tests: 48/48 passed.
- Full suite: 131/131 passed.
- `npm run check`: passed.
- Deployment backup created on gym-node-02 before rebuild; 54 sales preserved.
- Container rebuilt and healthy at `192.168.1.134:3002`.
- Live endpoint serves `cm-sales-v16`, `swVersion = 'v16'`, and the local reprint dialog.
- Physical Bluetooth print remains pending for an operator smoke test.
