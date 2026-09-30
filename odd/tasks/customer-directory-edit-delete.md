# Customer directory: edit and delete

## Goal
Let the operator fix customer typos from the **Clientes** view: rename a saved customer and delete a saved customer, with clear confirmation and honest failure messages.

## User intent
- Add **Editar** and **Borrar** options to the saved-customers list only.
- Then commit and push the changes.

## Decisions
- **Scope is the directory only.** Renaming or deleting touches the `clients` table and the local `cm_clients` list. Historical sales and encargos keep their stored `client_name` text; the app never rewrites sale history to satisfy a directory edit.
- **Rename and delete require a successful server response.** No local-only mutation, because `loadClientsList()` merges the server list back into local storage and would resurrect a locally deleted name. Offline therefore reports a clear message and changes nothing.
- **Rename onto an existing name is a conflict (409)**, not a silent merge: the user is told to delete the duplicate instead.
- **A 404 is confirmation of absence.** When the server answers 404, the stale local entry is removed from the device, so a customer deleted from another device cannot linger as a ghost that the UI can never remove. Network errors, 409 and unknown failures still leave local state untouched.
- **No new authentication.** The existing `POST /api/clients` is unauthenticated and the Clientes view is reachable without an admin session; rename and delete mirror that level. Residual risk recorded, not changed here.
- **API shape avoids path parameters** because customer names contain spaces and accents: `PUT /api/clients` with `{ from, to }`, and `DELETE /api/clients?name=<urlencoded>`.
- Reuse the existing `customerCreateStatus` status region for create, rename and delete messages instead of adding a second one.
- Bump the PWA cache `cm-sales-v23` → `cm-sales-v24` so installed clients receive the changed shell.

## Existing-code findings
- Server: `clients` table (`name TEXT NOT NULL UNIQUE COLLATE NOCASE`), `upsertClient`/`listClients` in `server/store.js`; routes `GET`/`POST /api/clients` in `server/app.js`.
- Frontend data: `loadClients`/`saveClients`/`rememberClient` over localStorage key `cm_clients` in `public/storage.js`; `fetchClients`/`postClient` in `public/api.js`.
- Frontend UI: `renderCustomersList()` emits a plain `<li class="customer-list-item">name</li>`; `createCustomer()` handles the create form; `state.clients` is the merged list.
- Tests: server client coverage lives in `test/encargos.test.js`; UI shell contracts in `test/admin-ui-contract.test.js`; local storage in `test/storage.test.js`; pure helpers in `test/ui-interactions.test.js`.

## Tasks
- [ ] **CDE-1 — Server rename and delete**
  - Add `renameClient(db, from, to)` and `deleteClient(db, name)` to `server/store.js` with validation (`invalid_client_name`), missing target (`client_not_found`, 404) and name collision (`client_name_taken`, 409) handled as `HttpError`s.
  - Add `PUT /api/clients` (body `{ from, to }`) and `DELETE /api/clients?name=` routes to `server/app.js`, next to the existing client routes.
  - Check: server tests cover rename success, collision, missing source, invalid names, delete success, delete missing, and prove sales/encargos rows are untouched.
- [ ] **CDE-2 — Frontend data layer**
  - Add `putClient`/`deleteClient` to `public/api.js` and `forgetClient`/`renameClient` to `public/storage.js` (case-insensitive match, dedupe, preserve order).
  - Check: storage tests cover case-insensitive removal, rename with position preserved, and renaming onto an existing name.
- [ ] **CDE-3 — Clientes view actions**
  - Render each saved customer with accessible **Editar** and **Borrar** actions; inline rename with Guardar/Cancelar, Enter/Escape, and focus management; delete behind an explicit confirmation that states sales keep the old name.
  - Keep in-flight buttons disabled, keep the edit row across re-renders, and report outcomes through the existing status region, including offline, conflict and already-deleted cases.
  - Add row/action styles with mobile touch targets; bump `cm-sales-v24` in `public/sw.js` and `swVersion` in `public/app.js`.
  - Check: UI contract tests assert the actions, accessible names, status region and cache v24.
- [ ] **CDE-4 — Docs, verification and delivery**
  - Update `CHANGELOG.md` (`[Unreleased]`) and `docs/DECISIONS.md` with the directory-only scope and the offline rule.
  - Check: `npm test`, `npm run check` and `git diff --check` pass; independent verification; then one work-unit commit and push to the existing feature branch, excluding untracked `NUL` and the temporary `docs/despliegue-*` aids.

## Progress
- Strict TDD is disabled by prior explicit user choice; run functional verification after each stage. Runner: Node built-in `node:test` via `npm test`.
- Current branch `feat/grouped-ticket-lines-quantity-ux` is clean and pushed at `abc190d`; production runs POS v23. `NUL`, `docs/despliegue-v22-manual.md` and `docs/despliegue-v23-manual.md` are untracked and must stay that way.
- Implementation complete: `renameClient`/`deleteClient` in `server/store.js` with `PUT`/`DELETE /api/clients` routes outside the admin CSRF block; `putClient`/`deleteClient` and `forgetClient`/`renameClient` in the frontend data layer; Clientes rows with accessible Editar/Borrar, inline edit and confirmation; cache `cm-sales-v24`; CHANGELOG and DECISIONS entry 21.
- Independent verification of the full change found no defects and ran `npm test` 209/209, `npm run check` and `git diff --check`. It raised one non-blocking dead end, now fixed: the 404 branch left an un-removable local ghost. Both 404 branches now drop the stale local entry.
- Residual, accepted: SQLite `NOCASE` only folds ASCII, so accented case variants are not treated as equal. Real browser interaction and installed-PWA cache activation remain unverified here.
- Work-unit commit: `b1be0eb759fa040e3affc5ca6959adceb7ceea30` (`feat(pos): rename and delete saved customers`), 13 files, 585 insertions and 7 deletions. Final independent verification passed `npm test` 209/209, `npm run check` and `git diff --check` with no findings.
- Untracked and deliberately excluded from the commit: `NUL`, `docs/despliegue-v22-manual.md`, `docs/despliegue-v23-manual.md`.
