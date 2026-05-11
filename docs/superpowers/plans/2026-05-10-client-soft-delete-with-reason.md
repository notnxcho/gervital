# Client Soft-Delete with Reason Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-delete of clients with soft-delete that captures a discrete reason + free-text notes, hides ex-clients from operational views by default, and supports reactivation — all while preserving the full historical record (invoices, attendance, transport, groups).

**Architecture:** Read-side filtering. A single `UPDATE clients SET deleted_at = NOW(), deactivation_reason = ..., deactivation_notes = ..., deactivated_by = ...` declarative marker. Operational reads filter `deleted_at IS NULL` via the `clients_full` view at the service layer; historical queries (invoices, attendance) are accessed by `clientId` and remain untouched.

**Tech Stack:** Postgres + Supabase RPC + React 19 + Tailwind. Migration follows the idempotent pattern established by `015_pricing_redesign.sql` and `011_client_avatars.sql` (`DROP VIEW IF EXISTS` → `CREATE VIEW`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).

**Testing approach:** This repo has no unit-test culture (only the default CRA `App.test.js`, no Supabase mocking infrastructure, no React Testing Library setup). Per the project's "Simplicity First / Impact minimal code" rule, this plan uses **verification steps** instead of TDD: SQL probes via the Supabase MCP, manual UI click-through with `npm start`, and `git diff` review. Each task ends with explicit verification before the commit.

**Spec:** `docs/superpowers/specs/2026-05-10-client-soft-delete-with-reason-design.md`

---

## File map

**New files:**
- `supabase/migrations/016_client_soft_delete.sql` — schema + RPCs + view refresh
- `src/pages/Clients/DeactivateClientModal.jsx` — shared modal (radio cards + notes textarea)

**Modified files:**
- `src/services/clients/clientService.js` — remove `deleteClient`, add `deactivateClient` + `reactivateClient`, add `includeDeleted` flag to `getClients`
- `src/services/clients/clientTransformers.js` — pass through new fields on `transformClientFromDb`
- `src/services/api.js` — facade: drop `deleteClient`, export the new functions
- `src/services/dashboard/dashboardService.js` — filter active clients in metrics query
- `src/services/transport/transportService.js` — filter active clients in `getTransportClients`
- `src/pages/Clients/ClientList.jsx` — replace hard-delete confirm with the new modal, add "Mostrar bajas" filter, atenuate ex-client cards
- `src/pages/Clients/ClientDetail.jsx` — replace hard-delete modal, add deactivated banner with "Reactivar" action, hide operational actions when deactivated

**Untouched (intentional):**
- `src/services/attendance/attendanceService.js`, `src/services/invoices/invoiceService.js` — historical access by `clientId`; correct that ex-client history remains visible
- `src/services/groups/groupService.js` — already loads its pool via `getClients()` (which filters by default); membership rows of ex-clients become invisible because the resolve goes through the active list
- `supabase/migrations/004_views.sql` — historical baseline; not modified (the repo convention is to ship view changes in the migration that motivates them, see `011`, `012`)

---

## Task 1: Migration 016 — schema, view, RPCs

**Files:**
- Create: `supabase/migrations/016_client_soft_delete.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/016_client_soft_delete.sql`:

```sql
-- ============================================
-- 016: Client Soft-Delete with Reason
-- - Adds deleted_at + deactivation_reason + deactivation_notes + deactivated_by
--   to `clients`.
-- - Refreshes clients_full view to expose those fields (no internal filter —
--   the service layer applies `deleted_at IS NULL` for operational reads).
-- - RPCs `deactivate_client(p_client_id, p_reason, p_notes, p_user_id)` and
--   `reactivate_client(p_client_id)`.
-- ============================================

-- ============================================
-- ⚠️  FRONTEND COUPLING (must ship in lockstep)
--
--   src/services/clients/clientService.js
--     - deleteClient removed; deactivateClient + reactivateClient added
--     - getClients gains { includeDeleted } option
--   src/services/clients/clientTransformers.js
--     - transformClientFromDb passes through the 3 new fields
--   src/services/api.js
--     - drop deleteClient export, add deactivateClient + reactivateClient
--   src/services/dashboard/dashboardService.js
--     - clients query filters deleted_at IS NULL
--   src/services/transport/transportService.js
--     - getTransportClients filters deleted_at IS NULL
--   src/pages/Clients/{ClientList,ClientDetail}.jsx + new DeactivateClientModal.jsx
-- ============================================

-- ============================================
-- Step 1 — Columns on `clients`
-- ============================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deactivation_notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deactivated_by UUID;

-- FK for deactivated_by (separate so re-runs don't crash if it already exists)
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_deactivated_by_fkey;
ALTER TABLE clients
  ADD CONSTRAINT clients_deactivated_by_fkey
  FOREIGN KEY (deactivated_by) REFERENCES users(id) ON DELETE SET NULL;

-- Reason check constraint
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_deactivation_reason_check;
ALTER TABLE clients ADD CONSTRAINT clients_deactivation_reason_check
  CHECK (deactivation_reason IS NULL OR deactivation_reason IN (
    'death',
    'transfer_to_other_center',
    'relocation',
    'health_decline',
    'family_decision',
    'financial',
    'service_dissatisfaction',
    'other'
  ));

-- Integrity: active rows must have no deactivation fields;
-- deactivated rows must have at least a reason.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_deactivation_consistency;
ALTER TABLE clients ADD CONSTRAINT clients_deactivation_consistency CHECK (
  (deleted_at IS NULL
    AND deactivation_reason IS NULL
    AND deactivation_notes IS NULL
    AND deactivated_by IS NULL)
  OR
  (deleted_at IS NOT NULL AND deactivation_reason IS NOT NULL)
);

-- ============================================
-- Step 2 — Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_clients_active
  ON clients(deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_deactivation_reason
  ON clients(deactivation_reason) WHERE deleted_at IS NOT NULL;

-- ============================================
-- Step 3 — Refresh clients_full view
-- (no internal filter on deleted_at; the service layer filters)
-- ============================================

DROP VIEW IF EXISTS clients_full;
CREATE VIEW clients_full AS
SELECT
  c.id,
  c.first_name AS "firstName",
  c.last_name AS "lastName",
  c.email,
  c.phone,
  c.birth_date AS "birthDate",
  c.cognitive_level AS "cognitiveLevel",
  c.start_date AS "startDate",
  c.recovery_days_available AS "recoveryDaysAvailable",
  c.avatar_url AS "avatarUrl",
  c.deleted_at AS "deletedAt",
  c.deactivation_reason AS "deactivationReason",
  c.deactivation_notes AS "deactivationNotes",
  c.created_at AS "createdAt",

  CASE
    WHEN cp.id IS NOT NULL THEN
      jsonb_build_object(
        'frequency', cp.frequency,
        'schedule', cp.schedule,
        'hasTransport', cp.has_transport,
        'assignedDays', cp.assigned_days
      )
    ELSE NULL
  END AS plan,

  CASE
    WHEN ec.id IS NOT NULL THEN
      jsonb_build_object(
        'name', ec.name,
        'relationship', ec.relationship,
        'phone', ec.phone
      )
    ELSE NULL
  END AS "emergencyContact",

  CASE
    WHEN ca.id IS NOT NULL THEN
      jsonb_build_object(
        'street', ca.street,
        'accessNotes', ca.access_notes,
        'doorbell', ca.doorbell,
        'concierge', ca.concierge,
        'latitude', ca.latitude,
        'longitude', ca.longitude,
        'distanceRange', ca.distance_range
      )
    ELSE NULL
  END AS address,

  CASE
    WHEN mi.id IS NOT NULL THEN
      jsonb_build_object(
        'dietaryRestrictions', mi.dietary_restrictions,
        'medicalRestrictions', mi.medical_restrictions,
        'mobilityRestrictions', mi.mobility_restrictions,
        'medication', mi.medication,
        'medicationSchedule', mi.medication_schedule,
        'notes', mi.notes
      )
    ELSE NULL
  END AS "medicalInfo"

FROM clients c
LEFT JOIN client_plans cp ON c.id = cp.client_id
LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
LEFT JOIN client_addresses ca ON c.id = ca.client_id
LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- ============================================
-- Step 4 — RPC: deactivate_client
-- ============================================

CREATE OR REPLACE FUNCTION deactivate_client(
  p_client_id UUID,
  p_reason TEXT,
  p_notes TEXT,
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_clean_notes TEXT;
BEGIN
  IF p_reason NOT IN (
    'death','transfer_to_other_center','relocation','health_decline',
    'family_decision','financial','service_dissatisfaction','other'
  ) THEN
    RAISE EXCEPTION 'Invalid deactivation reason: %', p_reason;
  END IF;

  v_clean_notes := NULLIF(trim(coalesce(p_notes, '')), '');

  IF p_reason = 'other' AND v_clean_notes IS NULL THEN
    RAISE EXCEPTION 'Notes required when reason is "other"';
  END IF;

  UPDATE clients
     SET deleted_at = NOW(),
         deactivation_reason = p_reason,
         deactivation_notes = v_clean_notes,
         deactivated_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or already deactivated';
  END IF;

  RETURN p_client_id;
END;
$$;

-- ============================================
-- Step 5 — RPC: reactivate_client
-- ============================================

CREATE OR REPLACE FUNCTION reactivate_client(p_client_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE clients
     SET deleted_at = NULL,
         deactivation_reason = NULL,
         deactivation_notes = NULL,
         deactivated_by = NULL,
         updated_at = NOW()
   WHERE id = p_client_id
     AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or not deactivated';
  END IF;

  RETURN p_client_id;
END;
$$;
```

- [ ] **Step 2: Apply the migration**

Run via the Supabase MCP `mcp__supabase__apply_migration` tool with:
- `name`: `016_client_soft_delete`
- `query`: the entire file contents above

Expected: success (no error).

- [ ] **Step 3: Verify schema via SQL probe**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'clients'
  AND column_name IN ('deleted_at','deactivation_reason','deactivation_notes','deactivated_by')
ORDER BY column_name;
```

Expected: 4 rows. All `is_nullable = YES`.

- [ ] **Step 4: Verify view shape**

```sql
SELECT "deletedAt", "deactivationReason", "deactivationNotes"
FROM clients_full
LIMIT 1;
```

Expected: 3 columns, all NULL for existing rows (no client deactivated yet).

- [ ] **Step 5: Smoke-test the RPC happy path**

Pick any existing client UUID:

```sql
SELECT id FROM clients WHERE deleted_at IS NULL LIMIT 1;
```

Then exercise both RPCs (use a real `users.id` for `p_user_id`):

```sql
-- Replace <client-uuid> and <user-uuid> with real values from your DB.
SELECT deactivate_client(
  '<client-uuid>'::uuid,
  'relocation',
  'Probando migración',
  '<user-uuid>'::uuid
);

SELECT id, deleted_at, deactivation_reason, deactivation_notes, deactivated_by
FROM clients WHERE id = '<client-uuid>'::uuid;

SELECT reactivate_client('<client-uuid>'::uuid);

SELECT id, deleted_at, deactivation_reason
FROM clients WHERE id = '<client-uuid>'::uuid;
```

Expected:
- After `deactivate_client`: `deleted_at` is a recent timestamp, `deactivation_reason = 'relocation'`, `deactivation_notes = 'Probando migración'`, `deactivated_by` matches the user uuid.
- After `reactivate_client`: all four fields back to NULL.

- [ ] **Step 6: Smoke-test the RPC error paths**

```sql
-- "other" without notes should fail
SELECT deactivate_client('<client-uuid>'::uuid, 'other', '', '<user-uuid>'::uuid);
-- Expected: ERROR: Notes required when reason is "other"

-- Invalid reason should fail
SELECT deactivate_client('<client-uuid>'::uuid, 'made_up_reason', NULL, '<user-uuid>'::uuid);
-- Expected: ERROR: Invalid deactivation reason: made_up_reason

-- Double-deactivate should fail
SELECT deactivate_client('<client-uuid>'::uuid, 'relocation', NULL, '<user-uuid>'::uuid);
SELECT deactivate_client('<client-uuid>'::uuid, 'relocation', NULL, '<user-uuid>'::uuid);
-- Second call expected: ERROR: Client not found or already deactivated

-- Cleanup
SELECT reactivate_client('<client-uuid>'::uuid);
```

Expected: each invalid call raises the documented error; final reactivate cleans up.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/016_client_soft_delete.sql
git commit -m "feat(db): soft-delete clientes con motivo + notas (mig 016)"
```

---

## Task 2: Service layer — clientService + transformers

**Files:**
- Modify: `src/services/clients/clientTransformers.js`
- Modify: `src/services/clients/clientService.js`

- [ ] **Step 1: Update `transformClientFromDb` to pass through soft-delete fields**

Edit `src/services/clients/clientTransformers.js`, in `transformClientFromDb` (line 47), replace the function body to include the new fields:

```javascript
export function transformClientFromDb(dbClient) {
  return {
    ...dbClient,
    birthDate: dbClient.birthDate ? String(dbClient.birthDate).split('T')[0] : null,
    startDate: dbClient.startDate ? String(dbClient.startDate).split('T')[0] : null,
    createdAt: dbClient.createdAt ? String(dbClient.createdAt).split('T')[0] : null,
    deletedAt: dbClient.deletedAt || null,
    deactivationReason: dbClient.deactivationReason || null,
    deactivationNotes: dbClient.deactivationNotes || null,
    recoveryDaysAvailable: dbClient.recoveryDaysAvailable || 0,
    plan: dbClient.plan || {
      frequency: 1,
      schedule: 'morning',
      hasTransport: false,
      assignedDays: []
    },
    emergencyContact: dbClient.emergencyContact || {
      name: '',
      relationship: '',
      phone: ''
    },
    address: dbClient.address || {
      street: '',
      accessNotes: '',
      doorbell: '',
      concierge: '',
      distanceRange: null
    },
    medicalInfo: dbClient.medicalInfo || {
      dietaryRestrictions: '',
      medicalRestrictions: '',
      mobilityRestrictions: '',
      medication: '',
      medicationSchedule: '',
      notes: ''
    }
  }
}
```

- [ ] **Step 2: Replace `getClients` and `deleteClient` in clientService.js**

Edit `src/services/clients/clientService.js`. Replace the `getClients` function (lines 12-23) with a version that accepts an `options` argument:

```javascript
/**
 * Get clients with nested data.
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false] - When true, include soft-deleted clients
 * @returns {Promise<Array>}
 */
export async function getClients({ includeDeleted = false } = {}) {
  let query = supabase
    .from('clients_full')
    .select('*')
    .order('lastName', { ascending: true })

  if (!includeDeleted) {
    query = query.is('deletedAt', null)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data.map(transformClientFromDb)
}
```

Then delete the entire `deleteClient` function (lines 86-99 in the current file — the doc block plus the function body).

- [ ] **Step 3: Add `deactivateClient` and `reactivateClient` at the bottom of clientService.js**

Append to `src/services/clients/clientService.js` (after `updateRecoveryDays`):

```javascript
/**
 * Soft-delete a client with a reason and optional notes.
 * @param {string} id - Client UUID
 * @param {object} payload
 * @param {string} payload.reason - One of the discrete reasons enforced by the RPC
 * @param {string} [payload.notes] - Free-text notes (required when reason === 'other')
 * @param {string} payload.userId - UUID of the system user performing the action
 * @returns {Promise<object>} The updated client
 */
export async function deactivateClient(id, { reason, notes, userId }) {
  const { error } = await supabase.rpc('deactivate_client', {
    p_client_id: id,
    p_reason: reason,
    p_notes: notes || null,
    p_user_id: userId
  })

  if (error) {
    throw new Error(error.message)
  }

  return getClientById(id)
}

/**
 * Reactivate a soft-deleted client.
 * @param {string} id - Client UUID
 * @returns {Promise<object>} The updated client
 */
export async function reactivateClient(id) {
  const { error } = await supabase.rpc('reactivate_client', {
    p_client_id: id
  })

  if (error) {
    throw new Error(error.message)
  }

  return getClientById(id)
}
```

Note: `getClientById` is intentionally left as-is (no filter on `deletedAt`) — ex-clients must remain navigable for historical access.

- [ ] **Step 4: Verify the file still parses**

Run:

```bash
node --check src/services/clients/clientService.js && node --check src/services/clients/clientTransformers.js
```

Expected: no output (both files parse).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/clientService.js src/services/clients/clientTransformers.js
git commit -m "feat(clients): deactivate/reactivate service + includeDeleted flag"
```

---

## Task 3: API facade

**Files:**
- Modify: `src/services/api.js`

- [ ] **Step 1: Update CLIENTS exports**

Edit `src/services/api.js`. Replace the CLIENTS API block (lines 22-32) with:

```javascript
// ============================================
// CLIENTS API
// ============================================
export {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deactivateClient,
  reactivateClient,
  updateClientAddressCoords
} from './clients/clientService'
```

(Drop `deleteClient`; add `deactivateClient` and `reactivateClient`.)

- [ ] **Step 2: Confirm no callers still import `deleteClient`**

```bash
grep -rn "deleteClient" src/
```

Expected output: matches only in `ClientList.jsx` and `ClientDetail.jsx` (those are fixed in Tasks 6 and 7). No matches in any service file. The avatar service's `deleteClientAvatar` is a different function and is fine.

If any other consumer pops up, capture it as a follow-up task and fix it before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/services/api.js
git commit -m "refactor(api): swap deleteClient for deactivateClient/reactivateClient"
```

---

## Task 4: Audit operational queries

**Files:**
- Modify: `src/services/dashboard/dashboardService.js:14-17`
- Modify: `src/services/transport/transportService.js:4-16`

Both files bypass `getClients()` and hit `clients_full` directly. They need an explicit `deletedAt IS NULL` filter.

- [ ] **Step 1: Filter active clients in the dashboard query**

Edit `src/services/dashboard/dashboardService.js`. In the `Promise.all` block, replace the clients query (lines 15-17):

```javascript
    supabase
      .from('clients_full')
      .select('id, firstName, lastName, avatarUrl, cognitiveLevel, recoveryDaysAvailable, plan')
      .is('deletedAt', null),
```

(Just `.is('deletedAt', null)` chained onto the existing query.)

- [ ] **Step 2: Filter active clients in the transport pool**

Edit `src/services/transport/transportService.js`. Replace `getTransportClients` (lines 4-16):

```javascript
export async function getTransportClients() {
  const { data, error } = await supabase
    .from('clients_full')
    .select('*')
    .is('deletedAt', null)
  if (error) throw new Error(error.message)
  return data
    .filter(c => c.plan?.hasTransport)
    .map(c => ({
      ...c,
      latitude: c.address?.latitude || null,
      longitude: c.address?.longitude || null
    }))
}
```

- [ ] **Step 3: Verify Groups path is already safe**

```bash
grep -n "getClients\|clients_full\|from('clients'" src/services/groups/groupService.js src/pages/Groups/DailyGroups.jsx
```

Expected: `DailyGroups.jsx` uses `getClients()` (already filtered by default), and `groupService.js` only reads/writes `group_activity_assignments` keyed by `client_id`. Ex-client memberships stay in DB but become invisible in the UI because rendering joins through the active client list. No edit needed.

- [ ] **Step 4: Verify the files still parse**

```bash
node --check src/services/dashboard/dashboardService.js && node --check src/services/transport/transportService.js
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboard/dashboardService.js src/services/transport/transportService.js
git commit -m "fix(services): filter soft-deleted clients out of dashboard/transport"
```

---

## Task 5: `DeactivateClientModal` component

**Files:**
- Create: `src/pages/Clients/DeactivateClientModal.jsx`

- [ ] **Step 1: Create the component**

Create `src/pages/Clients/DeactivateClientModal.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { WarningCircle } from 'iconoir-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'

export const DEACTIVATION_REASONS = [
  { value: 'death', label: 'Fallecimiento' },
  { value: 'transfer_to_other_center', label: 'Cambio a otra institución' },
  { value: 'relocation', label: 'Mudanza' },
  { value: 'health_decline', label: 'Internación / deterioro de salud' },
  { value: 'family_decision', label: 'Decisión familiar' },
  { value: 'financial', label: 'Razones económicas' },
  { value: 'service_dissatisfaction', label: 'Insatisfacción con el servicio' },
  { value: 'other', label: 'Otro' }
]

const NOTES_PLACEHOLDERS = {
  service_dissatisfaction: '¿Qué aspecto puntual? Ayudanos a mejorar.',
  other: 'Describí brevemente el motivo (obligatorio).',
  default: 'Información adicional (opcional).'
}

export default function DeactivateClientModal({ isOpen, onClose, client, onConfirm, loading }) {
  const [reason, setReason] = useState(null)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (isOpen) {
      setReason(null)
      setNotes('')
    }
  }, [isOpen])

  const requiresNotes = reason === 'other'
  const canConfirm = reason !== null && (!requiresNotes || notes.trim().length > 0)

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm({ reason, notes: notes.trim() })
  }

  const placeholder = NOTES_PLACEHOLDERS[reason] || NOTES_PLACEHOLDERS.default

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Dar de baja cliente">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-amber-100 rounded-full shrink-0">
          <WarningCircle className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <p className="text-gray-900 font-medium">
            {client?.firstName} {client?.lastName}
          </p>
          <p className="text-sm text-gray-500">
            Podés reactivarlo después desde el detalle del cliente.
          </p>
        </div>
      </div>

      <p className="text-sm font-medium text-gray-700 mb-2">Motivo</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {DEACTIVATION_REASONS.map(r => {
          const selected = reason === r.value
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => setReason(r.value)}
              className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors ${
                selected
                  ? 'bg-purple-50 border-purple-400 text-purple-900'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {r.label}
            </button>
          )
        })}
      </div>

      <label className="block text-sm font-medium text-gray-700 mb-1">
        Notas {requiresNotes && <span className="text-red-600">*</span>}
      </label>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
      />

      <div className="flex gap-3 justify-end mt-6">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          onClick={handleConfirm}
          loading={loading}
          disabled={!canConfirm || loading}
        >
          Confirmar baja
        </Button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Verify the file parses**

```bash
node --check src/pages/Clients/DeactivateClientModal.jsx 2>&1 || \
  npx --yes esbuild src/pages/Clients/DeactivateClientModal.jsx --bundle=false --loader=jsx > /dev/null
```

Expected: no errors. (Plain `node --check` does not understand JSX; the `esbuild` fallback validates JSX syntax.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/Clients/DeactivateClientModal.jsx
git commit -m "feat(clients): DeactivateClientModal con motivos + notas"
```

---

## Task 6: Wire `ClientList` to the new modal + add the "Mostrar bajas" toggle

**Files:**
- Modify: `src/pages/Clients/ClientList.jsx`

- [ ] **Step 1: Update imports and pull in `useAuth`**

Edit `src/pages/Clients/ClientList.jsx`. Replace the imports at the top (lines 1-9) with:

```jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Trash, Refresh, SunLight, HalfMoon, Sparks } from 'iconoir-react'
import { differenceInYears, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { getClients, deactivateClient } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Filters, { getActiveFiltersCount } from '../../components/ui/Filters'
import DeactivateClientModal, { DEACTIVATION_REASONS } from './DeactivateClientModal'
```

(Drop `deleteClient` and `Modal`; add `deactivateClient`, `useAuth`, `DeactivateClientModal`, and the `format`/`es` helpers used to render the deactivation date.)

- [ ] **Step 2: Build a reason label map for the card badge**

Right under the `FILTERS_CONFIG` constant (around line 62 of the current file), add:

```jsx
const REASON_LABEL = Object.fromEntries(
  DEACTIVATION_REASONS.map(r => [r.value, r.label])
)
```

- [ ] **Step 3: Update `ClientList` component state, loading, and filtering**

Replace the body of the `ClientList` function from `const [clients, setClients]` through the `activeFiltersCount` line with:

```jsx
export default function ClientList() {
  const { user } = useAuth()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [deactivateModal, setDeactivateModal] = useState({ open: false, client: null })
  const [deactivating, setDeactivating] = useState(false)
  const [filters, setFilters] = useState({
    cognitiveLevel: null,
    frequency: null,
    hasTransport: null
  })

  const navigate = useNavigate()

  useEffect(() => {
    loadClients()
    // re-load when toggle flips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDeleted])

  const loadClients = async () => {
    setLoading(true)
    try {
      const data = await getClients({ includeDeleted: showDeleted })
      setClients(data)
    } catch (error) {
      console.error('Error cargando clientes:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredClients = clients.filter((client) => {
    const fullName = `${client.firstName} ${client.lastName}`.toLowerCase()
    const phone = client.emergencyContact?.phone?.toLowerCase() || ''
    const address = client.address?.street?.toLowerCase() || ''
    const searchLower = search.toLowerCase()
    const matchesSearch = fullName.includes(searchLower) || phone.includes(searchLower) || address.includes(searchLower)

    const matchesCognitive = filters.cognitiveLevel === null || client.cognitiveLevel === filters.cognitiveLevel
    const matchesFrequency = filters.frequency === null || client.plan.frequency === filters.frequency
    const matchesTransport = filters.hasTransport === null || client.plan.hasTransport === filters.hasTransport

    return matchesSearch && matchesCognitive && matchesFrequency && matchesTransport
  })

  const activeFiltersCount = getActiveFiltersCount(filters)
```

- [ ] **Step 4: Replace `handleDelete` with `handleDeactivate`**

Replace the `handleDelete` function (lines 122-135 of the current file) with:

```jsx
  const handleDeactivate = async ({ reason, notes }) => {
    if (!deactivateModal.client || !user?.id) return

    setDeactivating(true)
    try {
      await deactivateClient(deactivateModal.client.id, { reason, notes, userId: user.id })
      setDeactivateModal({ open: false, client: null })
      await loadClients()
    } catch (error) {
      console.error('Error dando de baja al cliente:', error)
    } finally {
      setDeactivating(false)
    }
  }
```

- [ ] **Step 5: Add the "Mostrar bajas" toggle to the header**

Inside the JSX, between the `<Filters .../>` block and the "Alta de cliente" `<Button>` (currently around line 165), insert:

```jsx
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={e => setShowDeleted(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            Mostrar bajas
          </label>
```

- [ ] **Step 6: Swap the delete confirmation modal for `DeactivateClientModal`**

Replace the whole `{/* Delete confirmation modal */}` block (lines 215-243 of the current file) with:

```jsx
      <DeactivateClientModal
        isOpen={deactivateModal.open}
        onClose={() => setDeactivateModal({ open: false, client: null })}
        client={deactivateModal.client}
        onConfirm={handleDeactivate}
        loading={deactivating}
      />
```

Then in the `filteredClients.map(...)` JSX, update the prop name on `<ClientCard>` from `onDelete={() => setDeleteModal({...})}` to:

```jsx
                onDelete={() => setDeactivateModal({ open: true, client })}
```

(Keep the prop named `onDelete` on the component — it's an internal contract.)

- [ ] **Step 7: Atenuate cards for deactivated clients**

Replace the entire `ClientCard` function (currently starting around line 249) with this version. It dims the card, hides the trash button, and shows a "Baja: <motivo> · <fecha>" badge when `client.deletedAt` is set:

```jsx
function ClientCard({ client, onView, onDelete }) {
  const age = calculateAge(client.birthDate)
  const isDeactivated = !!client.deletedAt
  const deactivatedLabel = isDeactivated
    ? `Baja: ${REASON_LABEL[client.deactivationReason] || 'Sin motivo'} · ${format(new Date(client.deletedAt), "d MMM yyyy", { locale: es })}`
    : null

  return (
    <Card className={`overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group ${isDeactivated ? 'opacity-60 grayscale' : ''}`}>
      <div onClick={onView}>
        <div className="relative h-40 bg-gradient-to-br from-gray-200 to-gray-300">
          {client.avatarUrl ? (
            <img
              src={client.avatarUrl}
              alt={`${client.firstName} ${client.lastName}`}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-6xl text-gray-400 font-light">
                {client.firstName[0]}{client.lastName[0]}
              </span>
            </div>
          )}

          <div className={`absolute bottom-3 left-3 px-3 py-1 rounded-lg text-sm font-semibold border ${COGNITIVE_LEVEL_COLORS[client.cognitiveLevel] || 'bg-gray-100 text-gray-700'}`}>
            Tier {client.cognitiveLevel}
          </div>

          {client.recoveryDaysAvailable > 0 && !isDeactivated && (
            <div className="absolute bottom-3 right-3 flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur rounded-lg text-xs font-medium text-gray-700">
              <Refresh className="w-3 h-3" />
              {client.recoveryDaysAvailable}
            </div>
          )}
        </div>

        <div className="p-4">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">
              {client.firstName} {client.lastName}
            </h3>
            {age && <p className="text-gray-500 text-sm">{age} años</p>}
          </div>

          {isDeactivated ? (
            <div className="mt-3">
              <span className="inline-block px-2 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded">
                {deactivatedLabel}
              </span>
            </div>
          ) : (
            <>
              <div className="mt-3">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Contacto</p>
                <p className="text-sm text-gray-700">{client.emergencyContact?.phone}</p>
              </div>

              <div className="flex items-center gap-2 mt-4">
                <div className="flex gap-1.5">
                  {WEEK_DAYS.map((day) => {
                    const isAssigned = client.plan.assignedDays.includes(day.key)
                    return (
                      <span
                        key={day.key}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                          isAssigned
                            ? 'bg-purple-100 text-purple-700 border border-purple-200'
                            : 'bg-gray-100 text-gray-400 border border-gray-200'
                        }`}
                      >
                        {day.label}
                      </span>
                    )
                  })}
                </div>

                {SCHEDULE_CONFIG[client.plan.schedule] && (
                  <div className="relative group/schedule">
                    <div className="p-1.5 rounded-lg bg-gray-100 text-gray-500 border border-gray-200">
                      {(() => {
                        const { Icon } = SCHEDULE_CONFIG[client.plan.schedule]
                        return <Icon className="w-4 h-4" />
                      })()}
                    </div>
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-gray-900 text-white rounded whitespace-nowrap opacity-0 group-hover/schedule:opacity-100 transition-opacity pointer-events-none z-10">
                      {SCHEDULE_CONFIG[client.plan.schedule].label}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {!isDeactivated && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute top-2 right-2 p-2 bg-white/80 backdrop-blur rounded-lg text-gray-400 hover:text-red-600 hover:bg-white opacity-0 group-hover:opacity-100 transition-all"
        >
          <Trash className="w-4 h-4" />
        </button>
      )}
    </Card>
  )
}
```

- [ ] **Step 7.1: Confirm no stale `deleteModal`/`Modal` references remain**

```bash
grep -n "deleteModal\|<Modal" src/pages/Clients/ClientList.jsx
```

Expected: no output. If any line still references `deleteModal` or `<Modal>`, fix it.

- [ ] **Step 8: Verify the file parses**

```bash
npx --yes esbuild src/pages/Clients/ClientList.jsx --bundle=false --loader=jsx > /dev/null
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Clients/ClientList.jsx
git commit -m "feat(clients): lista con baja con motivo + toggle mostrar bajas"
```

---

## Task 7: Wire `ClientDetail` to the new modal + add deactivated banner

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Update imports**

Edit `src/pages/Clients/ClientDetail.jsx`. In the existing imports block, replace the `deleteClient` import with `deactivateClient, reactivateClient` (these come from `'../../services/api'` — look at line 27 area):

```jsx
  deactivateClient,
  reactivateClient,
  // ... keep everything else (uploadClientAvatar, deleteClientAvatar)
```

Then add the new modal import near the other component imports:

```jsx
import DeactivateClientModal, { DEACTIVATION_REASONS } from './DeactivateClientModal'
```

Also confirm `useAuth` is already imported (the detail page uses `user`). If it isn't, add:

```jsx
import { useAuth } from '../../context/AuthContext'
```

- [ ] **Step 2: Add a `REASON_LABEL` lookup near the top of the file**

Right after the existing top-level constants (e.g., near `DAY_LABELS`, `SCHEDULE_LABELS`, or `COGNITIVE_LEVEL_CONFIG`):

```jsx
const REASON_LABEL = Object.fromEntries(
  DEACTIVATION_REASONS.map(r => [r.value, r.label])
)
```

- [ ] **Step 3: Replace state and handlers**

Find `const [deleteModal, setDeleteModal] = useState(false)` (line 98) and replace with:

```jsx
  const [deactivateModal, setDeactivateModal] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [reactivating, setReactivating] = useState(false)
```

Find `handleDeleteClient` (around line 152) and replace it with:

```jsx
  const handleDeactivate = async ({ reason, notes }) => {
    if (!user?.id) return
    setDeactivating(true)
    try {
      const updated = await deactivateClient(id, { reason, notes, userId: user.id })
      setClient(updated)
      setDeactivateModal(false)
    } catch (error) {
      console.error('Error dando de baja al cliente:', error)
    } finally {
      setDeactivating(false)
    }
  }

  const handleReactivate = async () => {
    setReactivating(true)
    try {
      const updated = await reactivateClient(id)
      setClient(updated)
    } catch (error) {
      console.error('Error reactivando cliente:', error)
    } finally {
      setReactivating(false)
    }
  }
```

- [ ] **Step 4: Update the options menu — hide "Dar de baja" if already deactivated**

Find the options-menu block (around line 290). Replace it so the "Dar de baja" button only renders when the client is active:

```jsx
            {showOptionsMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1">
                {!client.deletedAt && (
                  <button
                    onClick={() => { setShowOptionsMenu(false); setDeactivateModal(true) }}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <Trash className="w-4 h-4" />
                    Dar de baja
                  </button>
                )}
              </div>
            )}
```

(If the menu becomes empty for deactivated clients, this is fine — leave it.)

- [ ] **Step 5: Add the deactivated banner above the plan summary**

Find the line `{/* Plan summary */}` and immediately above it insert:

```jsx
      {client.deletedAt && (
        <div className="mb-4 p-4 rounded-xl border border-amber-300 bg-amber-50 flex items-start justify-between gap-4">
          <div>
            <p className="text-amber-900 font-semibold">
              Cliente dado de baja el {format(new Date(client.deletedAt), "d 'de' MMMM, yyyy", { locale: es })}
            </p>
            <p className="text-sm text-amber-800 mt-1">
              Motivo: {REASON_LABEL[client.deactivationReason] || '—'}
              {client.deactivationNotes && <> · {client.deactivationNotes}</>}
            </p>
          </div>
          <Button variant="secondary" onClick={handleReactivate} loading={reactivating}>
            Reactivar cliente
          </Button>
        </div>
      )}
```

- [ ] **Step 6: Replace the delete modal at the bottom**

Find the `{/* Delete modal */}` block (around line 493) and replace it entirely with:

```jsx
      <DeactivateClientModal
        isOpen={deactivateModal}
        onClose={() => setDeactivateModal(false)}
        client={client}
        onConfirm={handleDeactivate}
        loading={deactivating}
      />
```

- [ ] **Step 7: Verify no orphan references**

```bash
grep -n "deleteModal\|handleDeleteClient\|deleteClient(" src/pages/Clients/ClientDetail.jsx
```

Expected: no output (the avatar service's `deleteClientAvatar` does not match `deleteClient(`).

- [ ] **Step 8: Verify the file parses**

```bash
npx --yes esbuild src/pages/Clients/ClientDetail.jsx --bundle=false --loader=jsx > /dev/null
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(clients): detalle con baja con motivo + banner reactivar"
```

---

## Task 8: End-to-end smoke test

No code changes — this task is the manual verification that everything works together. Do not commit anything in this task.

- [ ] **Step 1: Compile Tailwind**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
```

Expected: no errors. New utility classes from the modal and banner (e.g. `grayscale`, `opacity-60`) are picked up.

- [ ] **Step 2: Start the dev server**

```bash
npm start
```

(Leave it running for the rest of the steps.)

- [ ] **Step 3: Deactivate a client from the list**

In the browser:
1. Go to `/clientes`.
2. Hover any active client card. Click the trash icon.
3. The new modal appears. The "Confirmar baja" button is disabled.
4. Click "Mudanza". The button enables.
5. Click "Confirmar baja". Modal closes; the card disappears from the list.

Expected: no console errors. The client is no longer visible by default.

- [ ] **Step 4: Verify "Mostrar bajas" toggle**

Tick "Mostrar bajas". The card reappears with dimmed/grayscale styling and a "Baja: Mudanza · <fecha>" badge. The trash icon does not appear on hover.

- [ ] **Step 5: Open the detail of a deactivated client**

Click the dimmed card. The detail page shows:
- The amber banner at the top with motivo, fecha, and a "Reactivar cliente" button.
- The "Dar de baja" option in the menu (`MoreVert`) is gone.
- The calendar and historical info are still visible.

- [ ] **Step 6: Reactivate**

Click "Reactivar cliente". The banner disappears, the "Dar de baja" option returns to the menu.

- [ ] **Step 7: Verify operational filters**

1. Go to `/transporte`. The pool of clients does not include any deactivated client.
2. Go to `/dashboard`. Active-client counts exclude deactivated clients.
3. Go to `/grupos`. The pool of clients excludes deactivated clients.

- [ ] **Step 8: Test the "Otro" motive notes validation**

Deactivate another client; pick "Otro" without notes. "Confirmar baja" stays disabled. Type something. The button enables. Confirm.

- [ ] **Step 9: SQL spot-check**

Via `mcp__supabase__execute_sql`:

```sql
SELECT id, first_name, last_name, deleted_at, deactivation_reason, deactivation_notes
FROM clients
WHERE deleted_at IS NOT NULL
ORDER BY deleted_at DESC
LIMIT 5;
```

Expected: rows for the clients you just deactivated, with the reasons + notes captured.

- [ ] **Step 10: Stop the dev server**

Ctrl+C the `npm start` process.

---

## Self-review notes (resolved)

- **Spec coverage:** every section of the spec maps to a task — schema/RPC/view → T1; service layer → T2; api facade → T3; query audit → T4; modal → T5; list integration with toggle + atenuado → T6; detail integration with banner + reactivar → T7; smoke test → T8.
- **Type/name consistency:** `deactivateClient(id, { reason, notes, userId })` signature is identical across T2 (definition), T6 (list call), and T7 (detail call). `client.deletedAt`, `client.deactivationReason`, `client.deactivationNotes` are the exact field names exposed by the refreshed view in T1 and consumed in T6/T7. `DEACTIVATION_REASONS` is the single source of truth (T5) and is re-imported in T6 and T7.
- **No placeholders:** every step contains the actual code/SQL/command and the expected output.
- **Adjustment vs. spec:** the spec listed `004_views.sql` as a file to touch. The plan ships the view in `016` instead, matching the repo convention established by `011` and `012` (every view change ships in the migration that motivates it, leaving 004 as historical baseline).
