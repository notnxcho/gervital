# Multiple emergency contacts + transfer responsible

## Scope
Client form (AddClient wizard step 1 + ClientDetail). Support 1–5 emergency contacts
(min 1 enforced front + back, max 5 front only) and a free-text `transferResponsible` string.

## Plan
- [x] Migration 024: `clients.transfer_responsible` column; `emergency_contacts` allow N rows
      (drop UNIQUE(client_id), add `position`); recreate `clients_full` view (keep singular
      `emergencyContact` = first, add `emergencyContacts` array + `transferResponsible`);
      drop+recreate `create_client_full` / `update_client_full` swapping `p_ec_*` for
      `p_emergency_contacts jsonb` + `p_transfer_responsible text`.
- [x] clientTransformers.js: create/update/fromDb mapping for the new shape.
- [x] AddClient.jsx: array state, add/remove UI (1–5), validation, transfer responsible input.
- [x] ClientDetail.jsx: render contacts list + transfer responsible.
- [x] Compile Tailwind + build verify.

## Review
- Migration applied (no overload accumulation: 1 signature each). View returns both singular
  `emergencyContact` (first by position, keeps ClientList search working) and `emergencyContacts`.
- Backend min-1 enforced via `RAISE EXCEPTION`; update is delete-then-insert, rolled back if the
  new array has no valid contact (verified: contacts survive a rejected empty update).
- Frontend: max 5 enforced (add button disables), min 1 enforced (remove hidden on last row),
  per-contact name+phone required, relationship optional. Transfer responsible = free text, step 1.
- Verified: SQL assertions (create→2 ordered, update→1, transfer persists, empty rejected) + prod build.
