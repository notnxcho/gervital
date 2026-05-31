# Client Card Redesign + Medical Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three boolean medical conditions (diabetic, celiac, hypertensive) to the client profile and redesign the client list card to show name/age, single-letter weekday chips, text shift badges, a letter-only tier chip, and a color-dot medical conditions row.

**Architecture:** A new SQL migration (018) adds the columns to `medical_info` and recreates the `clients_full` view plus the `create_client_full`/`update_client_full` RPCs to carry the flags end-to-end. The service transformer layer maps the flags both directions. The `AddClient` wizard edits them via checkboxes; `ClientDetail` and `ClientList` render them read-only.

**Tech Stack:** React 19, Supabase (PostgreSQL + RPC), Tailwind CSS 3, iconoir-react. No automated test framework — verification is via Supabase MCP queries, Tailwind recompile, and manual UI checks.

**Spec:** `docs/superpowers/specs/2026-05-31-client-card-medical-flags-design.md`

---

## Conventions reminder

- Variables/code in English, UI text in Spanish.
- No semicolons in JS/JSX.
- Recompile Tailwind after style changes: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.

---

## Task 1: Database migration (columns + view + RPCs)

**Files:**
- Create: `supabase/migrations/018_medical_flags.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/018_medical_flags.sql` with the full content below. The view and functions are reproduced from their current definitions (017 for `clients_full` and `create_client_full`; 012 for `update_client_full`) with only the three flag fields/params added.

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 018_medical_flags.sql
-- Adds three boolean medical conditions to medical_info and threads them through
-- the clients_full view and the create/update RPCs.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE medical_info
  ADD COLUMN IF NOT EXISTS is_diabetic     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_celiac       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_hypertensive BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. clients_full view (from 017) + flag fields ──────────────────────────────
CREATE OR REPLACE VIEW clients_full AS
 SELECT c.id,
    c.first_name AS "firstName",
    c.last_name AS "lastName",
    c.email,
    c.phone,
    c.birth_date AS "birthDate",
    c.cognitive_level AS "cognitiveLevel",
    c.start_date AS "startDate",
    ( SELECT count(*)::int FROM recovery_credits rc
      WHERE rc.client_id = c.id
        AND rc.status = 'available'
        AND rc.expires_at >= CURRENT_DATE ) AS "recoveryDaysAvailable",
    c.avatar_url AS "avatarUrl",
    c.deleted_at AS "deletedAt",
    c.deactivation_reason AS "deactivationReason",
    c.deactivation_notes AS "deactivationNotes",
    c.created_at AS "createdAt",
        CASE
            WHEN cp.id IS NOT NULL THEN jsonb_build_object('frequency', cp.frequency, 'schedule', cp.schedule, 'hasTransport', cp.has_transport, 'assignedDays', cp.assigned_days)
            ELSE NULL::jsonb
        END AS plan,
        CASE
            WHEN ec.id IS NOT NULL THEN jsonb_build_object('name', ec.name, 'relationship', ec.relationship, 'phone', ec.phone)
            ELSE NULL::jsonb
        END AS "emergencyContact",
        CASE
            WHEN ca.id IS NOT NULL THEN jsonb_build_object('street', ca.street, 'accessNotes', ca.access_notes, 'doorbell', ca.doorbell, 'concierge', ca.concierge, 'latitude', ca.latitude, 'longitude', ca.longitude, 'distanceRange', ca.distance_range)
            ELSE NULL::jsonb
        END AS address,
        CASE
            WHEN mi.id IS NOT NULL THEN jsonb_build_object('dietaryRestrictions', mi.dietary_restrictions, 'medicalRestrictions', mi.medical_restrictions, 'mobilityRestrictions', mi.mobility_restrictions, 'medication', mi.medication, 'medicationSchedule', mi.medication_schedule, 'notes', mi.notes, 'isDiabetic', mi.is_diabetic, 'isCeliac', mi.is_celiac, 'isHypertensive', mi.is_hypertensive)
            ELSE NULL::jsonb
        END AS "medicalInfo"
   FROM clients c
     LEFT JOIN client_plans cp ON c.id = cp.client_id
     LEFT JOIN emergency_contacts ec ON c.id = ec.client_id
     LEFT JOIN client_addresses ca ON c.id = ca.client_id
     LEFT JOIN medical_info mi ON c.id = mi.client_id;

-- ── 3. create_client_full overload A (no distance_range, from 017) + flags ─────
CREATE OR REPLACE FUNCTION public.create_client_full(
  p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT false,
  p_plan_assigned_days text[] DEFAULT '{}', p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_med_dietary text DEFAULT NULL,
  p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL, p_med_medication text DEFAULT NULL,
  p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL,
  p_med_is_diabetic boolean DEFAULT false, p_med_is_celiac boolean DEFAULT false, p_med_is_hypertensive boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date)
  RETURNING id INTO v_client_id;
  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, frequency, schedule, has_transport, assigned_days)
    VALUES (v_client_id, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days);
  END IF;
  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (v_client_id, p_ec_name, p_ec_relationship, p_ec_phone);
  END IF;
  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge)
    VALUES (v_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge);
  END IF;
  INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes, is_diabetic, is_celiac, is_hypertensive)
  VALUES (v_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes, p_med_is_diabetic, p_med_is_celiac, p_med_is_hypertensive);
  RETURN v_client_id;
END;
$function$;

-- ── 4. create_client_full overload B (with distance_range, from 017) + flags ───
CREATE OR REPLACE FUNCTION public.create_client_full(
  p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL, p_cognitive_level text DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE,
  p_plan_frequency integer DEFAULT NULL, p_plan_schedule text DEFAULT NULL, p_plan_has_transport boolean DEFAULT false,
  p_plan_assigned_days text[] DEFAULT '{}', p_ec_name text DEFAULT NULL, p_ec_relationship text DEFAULT NULL,
  p_ec_phone text DEFAULT NULL, p_addr_street text DEFAULT NULL, p_addr_access_notes text DEFAULT NULL,
  p_addr_doorbell text DEFAULT NULL, p_addr_concierge text DEFAULT NULL, p_addr_distance_range text DEFAULT NULL,
  p_med_dietary text DEFAULT NULL, p_med_medical text DEFAULT NULL, p_med_mobility text DEFAULT NULL,
  p_med_medication text DEFAULT NULL, p_med_medication_schedule text DEFAULT NULL, p_med_notes text DEFAULT NULL,
  p_med_is_diabetic boolean DEFAULT false, p_med_is_celiac boolean DEFAULT false, p_med_is_hypertensive boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_client_id UUID;
BEGIN
  INSERT INTO clients (first_name, last_name, email, phone, birth_date, cognitive_level, start_date)
  VALUES (p_first_name, p_last_name, p_email, p_phone, p_birth_date, p_cognitive_level, p_start_date)
  RETURNING id INTO v_client_id;
  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, frequency, schedule, has_transport, assigned_days)
    VALUES (v_client_id, p_plan_frequency, p_plan_schedule, p_plan_has_transport, p_plan_assigned_days);
  END IF;
  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (v_client_id, p_ec_name, p_ec_relationship, p_ec_phone);
  END IF;
  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (v_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range);
  END IF;
  INSERT INTO medical_info (client_id, dietary_restrictions, medical_restrictions, mobility_restrictions, medication, medication_schedule, notes, is_diabetic, is_celiac, is_hypertensive)
  VALUES (v_client_id, p_med_dietary, p_med_medical, p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes, p_med_is_diabetic, p_med_is_celiac, p_med_is_hypertensive);
  RETURN v_client_id;
END;
$function$;

-- ── 5. update_client_full (from 012) + flags ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_client_full(
  p_client_id UUID,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_birth_date DATE DEFAULT NULL,
  p_cognitive_level TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_plan_frequency INTEGER DEFAULT NULL,
  p_plan_schedule TEXT DEFAULT NULL,
  p_plan_has_transport BOOLEAN DEFAULT NULL,
  p_plan_assigned_days TEXT[] DEFAULT NULL,
  p_ec_name TEXT DEFAULT NULL,
  p_ec_relationship TEXT DEFAULT NULL,
  p_ec_phone TEXT DEFAULT NULL,
  p_addr_street TEXT DEFAULT NULL,
  p_addr_access_notes TEXT DEFAULT NULL,
  p_addr_doorbell TEXT DEFAULT NULL,
  p_addr_concierge TEXT DEFAULT NULL,
  p_addr_distance_range TEXT DEFAULT NULL,
  p_med_dietary TEXT DEFAULT NULL,
  p_med_medical TEXT DEFAULT NULL,
  p_med_mobility TEXT DEFAULT NULL,
  p_med_medication TEXT DEFAULT NULL,
  p_med_medication_schedule TEXT DEFAULT NULL,
  p_med_notes TEXT DEFAULT NULL,
  p_med_is_diabetic BOOLEAN DEFAULT NULL,
  p_med_is_celiac BOOLEAN DEFAULT NULL,
  p_med_is_hypertensive BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE clients SET
    first_name = COALESCE(p_first_name, first_name),
    last_name = COALESCE(p_last_name, last_name),
    email = COALESCE(p_email, email),
    phone = COALESCE(p_phone, phone),
    birth_date = COALESCE(p_birth_date, birth_date),
    cognitive_level = COALESCE(p_cognitive_level, cognitive_level),
    start_date = COALESCE(p_start_date, start_date),
    updated_at = NOW()
  WHERE id = p_client_id;

  IF p_plan_frequency IS NOT NULL THEN
    INSERT INTO client_plans (client_id, frequency, schedule, has_transport, assigned_days)
    VALUES (p_client_id, p_plan_frequency, p_plan_schedule, COALESCE(p_plan_has_transport, FALSE), COALESCE(p_plan_assigned_days, '{}'))
    ON CONFLICT (client_id) DO UPDATE SET
      frequency = EXCLUDED.frequency,
      schedule = EXCLUDED.schedule,
      has_transport = EXCLUDED.has_transport,
      assigned_days = EXCLUDED.assigned_days,
      updated_at = NOW();
  END IF;

  IF p_ec_name IS NOT NULL THEN
    INSERT INTO emergency_contacts (client_id, name, relationship, phone)
    VALUES (p_client_id, p_ec_name, p_ec_relationship, p_ec_phone)
    ON CONFLICT (client_id) DO UPDATE SET
      name = EXCLUDED.name,
      relationship = EXCLUDED.relationship,
      phone = EXCLUDED.phone,
      updated_at = NOW();
  END IF;

  IF p_addr_street IS NOT NULL THEN
    INSERT INTO client_addresses (client_id, street, access_notes, doorbell, concierge, distance_range)
    VALUES (p_client_id, p_addr_street, p_addr_access_notes, p_addr_doorbell, p_addr_concierge, p_addr_distance_range)
    ON CONFLICT (client_id) DO UPDATE SET
      street = EXCLUDED.street,
      access_notes = EXCLUDED.access_notes,
      doorbell = EXCLUDED.doorbell,
      concierge = EXCLUDED.concierge,
      distance_range = COALESCE(EXCLUDED.distance_range, client_addresses.distance_range),
      updated_at = NOW();
  END IF;

  IF p_med_dietary IS NOT NULL OR p_med_medical IS NOT NULL OR p_med_mobility IS NOT NULL
     OR p_med_medication IS NOT NULL OR p_med_medication_schedule IS NOT NULL OR p_med_notes IS NOT NULL
     OR p_med_is_diabetic IS NOT NULL OR p_med_is_celiac IS NOT NULL OR p_med_is_hypertensive IS NOT NULL THEN
    INSERT INTO medical_info (
      client_id, dietary_restrictions, medical_restrictions,
      mobility_restrictions, medication, medication_schedule, notes,
      is_diabetic, is_celiac, is_hypertensive
    ) VALUES (
      p_client_id, p_med_dietary, p_med_medical,
      p_med_mobility, p_med_medication, p_med_medication_schedule, p_med_notes,
      COALESCE(p_med_is_diabetic, FALSE), COALESCE(p_med_is_celiac, FALSE), COALESCE(p_med_is_hypertensive, FALSE)
    )
    ON CONFLICT (client_id) DO UPDATE SET
      dietary_restrictions = COALESCE(EXCLUDED.dietary_restrictions, medical_info.dietary_restrictions),
      medical_restrictions = COALESCE(EXCLUDED.medical_restrictions, medical_info.medical_restrictions),
      mobility_restrictions = COALESCE(EXCLUDED.mobility_restrictions, medical_info.mobility_restrictions),
      medication = COALESCE(EXCLUDED.medication, medical_info.medication),
      medication_schedule = COALESCE(EXCLUDED.medication_schedule, medical_info.medication_schedule),
      notes = COALESCE(EXCLUDED.notes, medical_info.notes),
      is_diabetic = COALESCE(p_med_is_diabetic, medical_info.is_diabetic),
      is_celiac = COALESCE(p_med_is_celiac, medical_info.is_celiac),
      is_hypertensive = COALESCE(p_med_is_hypertensive, medical_info.is_hypertensive),
      updated_at = NOW();
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP tool `mcp__supabase__apply_migration` with name `018_medical_flags` and the SQL from Step 1.

- [ ] **Step 3: Verify columns and view**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'medical_info'
  AND column_name IN ('is_diabetic','is_celiac','is_hypertensive')
ORDER BY column_name;
```
Expected: 3 rows — `is_celiac`, `is_diabetic`, `is_hypertensive`.

Then confirm the view exposes the keys:

```sql
SELECT "medicalInfo" FROM clients_full LIMIT 1;
```
Expected: the JSON includes `isDiabetic`, `isCeliac`, `isHypertensive` (all `false` for existing rows).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/018_medical_flags.sql
git commit -m "feat(clients): migration 018 — medical condition flags

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Service transformers

**Files:**
- Modify: `src/services/clients/clientTransformers.js`

- [ ] **Step 1: Add flags to `transformClientToDb`**

In `transformClientToDb`, after the `p_med_notes` line (currently line 36), add the three params (note the medical block ends the returned object, so add a comma after `p_med_notes`):

```js
    p_med_notes: clientData.medicalInfo?.notes || null,
    p_med_is_diabetic: clientData.medicalInfo?.isDiabetic || false,
    p_med_is_celiac: clientData.medicalInfo?.isCeliac || false,
    p_med_is_hypertensive: clientData.medicalInfo?.isHypertensive || false
```

- [ ] **Step 2: Add flags to `transformUpdateToDb`**

Inside `if (updateData.medicalInfo) { ... }`, after the `p_med_notes` line, add:

```js
    if (updateData.medicalInfo.isDiabetic !== undefined) params.p_med_is_diabetic = updateData.medicalInfo.isDiabetic
    if (updateData.medicalInfo.isCeliac !== undefined) params.p_med_is_celiac = updateData.medicalInfo.isCeliac
    if (updateData.medicalInfo.isHypertensive !== undefined) params.p_med_is_hypertensive = updateData.medicalInfo.isHypertensive
```

- [ ] **Step 3: Add flags to the `transformClientFromDb` default**

In the `medicalInfo: dbClient.medicalInfo || { ... }` fallback, add the three flags:

```js
    medicalInfo: dbClient.medicalInfo || {
      dietaryRestrictions: '',
      medicalRestrictions: '',
      mobilityRestrictions: '',
      medication: '',
      medicationSchedule: '',
      notes: '',
      isDiabetic: false,
      isCeliac: false,
      isHypertensive: false
    }
```

- [ ] **Step 4: Verify it compiles**

Run: `npx eslint src/services/clients/clientTransformers.js`
Expected: no errors (or only pre-existing warnings unrelated to these lines).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/clientTransformers.js
git commit -m "feat(clients): map medical flags in transformers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: AddClient wizard — edit the flags

**Files:**
- Modify: `src/pages/Clients/AddClient.jsx`

- [ ] **Step 1: Add flags to `INITIAL_FORM_DATA`**

After the `notes: ''` line in `INITIAL_FORM_DATA` (currently line 80), add the flags (add a comma after `notes: ''`):

```js
  notes: '',
  // Condiciones
  isDiabetic: false,
  isCeliac: false,
  isHypertensive: false
```

- [ ] **Step 2: Hydrate flags in edit mode**

In the `setFormData({ ... })` call inside the edit-mode `useEffect`, after the `notes: client.medicalInfo?.notes || ''` line (currently line 141), add (add a comma after the `notes` line):

```js
          notes: client.medicalInfo?.notes || '',
          isDiabetic: client.medicalInfo?.isDiabetic || false,
          isCeliac: client.medicalInfo?.isCeliac || false,
          isHypertensive: client.medicalInfo?.isHypertensive || false
```

- [ ] **Step 3: Include flags in the saved `medicalInfo` object**

In the object built before save, in the `medicalInfo: { ... }` block (currently lines 255-262), after `notes: formData.notes` add (add a comma after `notes: formData.notes`):

```js
        medicalInfo: {
          dietaryRestrictions: formData.dietaryRestrictions,
          medicalRestrictions: formData.medicalRestrictions,
          mobilityRestrictions: formData.mobilityRestrictions,
          medication: formData.medication,
          medicationSchedule: formData.medicationSchedule,
          notes: formData.notes,
          isDiabetic: formData.isDiabetic,
          isCeliac: formData.isCeliac,
          isHypertensive: formData.isHypertensive
        }
```

- [ ] **Step 4: Add the "Condiciones" checkboxes section in Step 3**

In the Step 3 JSX, insert a new section between the "Restricciones" `<div>` block (ends at line 657) and the "Medicación" `<div>` block (starts at line 659). `Checkbox` is already imported (line 9) and takes `label`, `checked`, `onChange`:

```jsx
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Condiciones</h3>
                <div className="flex flex-wrap gap-6">
                  <Checkbox
                    label="Diabético"
                    checked={formData.isDiabetic}
                    onChange={(e) => updateField('isDiabetic', e.target.checked)}
                  />
                  <Checkbox
                    label="Celíaco"
                    checked={formData.isCeliac}
                    onChange={(e) => updateField('isCeliac', e.target.checked)}
                  />
                  <Checkbox
                    label="Hipertenso"
                    checked={formData.isHypertensive}
                    onChange={(e) => updateField('isHypertensive', e.target.checked)}
                  />
                </div>
              </div>
```

- [ ] **Step 5: Verify it compiles and renders**

Run: `npm start` (or rely on the dev server already running). Navigate to `/clientes/nuevo`, go to Step 3.
Expected: a "Condiciones" section with three checkboxes appears between "Restricciones" and "Medicación". No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/AddClient.jsx
git commit -m "feat(clients): edit medical condition flags in add/edit wizard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ClientDetail — display flags in medical tab

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

- [ ] **Step 1: Add a conditions row to the medical tab**

In the `activeTab === 'medical'` block, after the closing `</div>` of the `grid grid-cols-2` block (currently line 497) and before the `notes` block (line 498), insert a conditions row that renders chips only for active flags:

```jsx
              <div>
                <p className="text-sm text-gray-500">Condiciones</p>
                {(() => {
                  const conditions = [
                    { active: client.medicalInfo?.isDiabetic, label: 'Diabético', color: 'bg-blue-100 text-blue-700 border-blue-200' },
                    { active: client.medicalInfo?.isCeliac, label: 'Celíaco', color: 'bg-amber-100 text-amber-700 border-amber-200' },
                    { active: client.medicalInfo?.isHypertensive, label: 'Hipertenso', color: 'bg-red-100 text-red-700 border-red-200' }
                  ].filter(c => c.active)
                  if (conditions.length === 0) return <p className="font-medium text-gray-900">-</p>
                  return (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {conditions.map(c => (
                        <span key={c.label} className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${c.color}`}>
                          {c.label}
                        </span>
                      ))}
                    </div>
                  )
                })()}
              </div>
```

- [ ] **Step 2: Verify it renders**

In the running app, open a client detail page and switch to the "Información Médica" tab.
Expected: a "Condiciones" entry showing `-` (no flags) or color chips for active conditions. No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(clients): show medical condition chips in detail medical tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ClientList — card redesign

**Files:**
- Modify: `src/pages/Clients/ClientList.jsx`

- [ ] **Step 1: Update `WEEK_DAYS` to single letters**

Replace the `WEEK_DAYS` array (lines 14-20) with:

```js
// MOCKED RES - Días de la semana
const WEEK_DAYS = [
  { key: 'monday', label: 'L' },
  { key: 'tuesday', label: 'M' },
  { key: 'wednesday', label: 'M' },
  { key: 'thursday', label: 'J' },
  { key: 'friday', label: 'V' }
]
```

- [ ] **Step 2: Replace `SCHEDULE_CONFIG` with text labels and add `MEDICAL_FLAGS`**

Replace the `SCHEDULE_CONFIG` block (lines 30-35) with a text-badge config, and add a `MEDICAL_FLAGS` config right after it:

```js
// MOCKED RES - Labels de horario (badge corto + nombre largo para tooltip)
const SCHEDULE_CONFIG = {
  morning: { badge: 'AM', label: 'Mañana' },
  afternoon: { badge: 'PM', label: 'Tarde' },
  full_day: { badge: 'TD', label: 'Día completo' }
}

// MOCKED RES - Condiciones médicas mostradas como punto + inicial
const MEDICAL_FLAGS = [
  { key: 'isDiabetic', label: 'Diabético', initial: 'D', dot: 'bg-blue-500' },
  { key: 'isCeliac', label: 'Celíaco', initial: 'C', dot: 'bg-amber-500' },
  { key: 'isHypertensive', label: 'Hipertenso', initial: 'H', dot: 'bg-red-500' }
]
```

- [ ] **Step 3: Remove now-unused icon imports**

In the import on line 3, remove `SunLight, HalfMoon, Sparks` (they are only used by the old `SCHEDULE_CONFIG`). The line becomes:

```js
import { Plus, Search, Trash, Refresh } from 'iconoir-react'
```

(Verify with a quick search that `SunLight`/`HalfMoon`/`Sparks` are not referenced elsewhere in the file before removing.)

- [ ] **Step 4: Drop "Tier" word from the photo overlay**

In `ClientCard`, change the tier overlay (line 263) from:

```jsx
            Tier {client.cognitiveLevel}
```
to:
```jsx
            {client.cognitiveLevel}
```

- [ ] **Step 5: Replace the contact block + days/shift row with the new layout**

Replace the entire active-client `<>...</>` fragment (currently lines 289-328 — the "Contacto" block plus the days/shift `flex` row) with:

```jsx
            <>
              {(() => {
                const flags = MEDICAL_FLAGS.filter(f => client.medicalInfo?.[f.key])
                if (flags.length === 0) return null
                return (
                  <div className="flex items-center gap-2 mt-3">
                    {flags.map(f => (
                      <div key={f.key} className="relative group/flag flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${f.dot}`}></span>
                        <span className="text-xs font-medium text-gray-600">{f.initial}</span>
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-gray-900 text-white rounded whitespace-nowrap opacity-0 group-hover/flag:opacity-100 transition-opacity pointer-events-none z-10">
                          {f.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              <div className="flex items-center gap-2 mt-4">
                <div className="flex gap-1.5">
                  {WEEK_DAYS.map((day, index) => {
                    const isAssigned = client.plan.assignedDays.includes(day.key)
                    return (
                      <span
                        key={index}
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
                  <div className="relative group/schedule ml-auto">
                    <div className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 border border-gray-200 text-xs font-semibold">
                      {SCHEDULE_CONFIG[client.plan.schedule].badge}
                    </div>
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-gray-900 text-white rounded whitespace-nowrap opacity-0 group-hover/schedule:opacity-100 transition-opacity pointer-events-none z-10">
                      {SCHEDULE_CONFIG[client.plan.schedule].label}
                    </span>
                  </div>
                )}
              </div>
            </>
```

Note: `WEEK_DAYS` now has two `'M'` labels, so the map key changes from `day.key` to `index` (keys must be unique; `day.key` is still unique but `index` is unambiguous here — either works since `key` values are still distinct, but use `index` to avoid confusion). The `ml-auto` on the shift badge pushes it to the right edge of the row.

- [ ] **Step 6: Recompile Tailwind**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: completes without errors. (New utility classes like `bg-blue-500`, `bg-amber-500`, `group/flag` get picked up.)

- [ ] **Step 7: Verify the card visually**

In the running app, open `/clientes`.
Expected per card:
- No "Contacto"/phone row.
- Name + age only in the header text block.
- A medical row (`●D ●C ●H` with colored dots) appears only when the client has conditions; absent otherwise.
- Weekday chips show `L M M J V` (assigned = purple, not = gray).
- Shift badge shows `AM`/`PM`/`TD` on the right, tooltip shows the long label on hover.
- Tier overlay on the photo shows just the letter (no "Tier").

- [ ] **Step 8: Commit**

```bash
git add src/pages/Clients/ClientList.jsx src/tailwind.output.css
git commit -m "feat(clients): redesign client card (days, shift, tier, medical flags)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Create a client with conditions**

In the app, create a new client via the wizard, checking "Diabético" and "Hipertenso" in Step 3. Save.
Expected: redirect to list/detail without error.

- [ ] **Step 2: Verify persistence in DB**

Run via `mcp__supabase__execute_sql` (replace name as needed):

```sql
SELECT is_diabetic, is_celiac, is_hypertensive
FROM medical_info mi
JOIN clients c ON c.id = mi.client_id
WHERE c.first_name = '<the test first name>'
ORDER BY mi.created_at DESC LIMIT 1;
```
Expected: `is_diabetic = true`, `is_celiac = false`, `is_hypertensive = true`.

- [ ] **Step 3: Verify card + detail render**

On `/clientes`, the test client's card shows `●D ●H` (blue and red dots) and no `C`. The detail medical tab shows "Diabético" and "Hipertenso" chips.

- [ ] **Step 4: Verify uncheck persists (false, not stale)**

Edit the test client, uncheck "Diabético", save. Re-run the SQL from Step 2.
Expected: `is_diabetic = false`. The card no longer shows `●D`.

- [ ] **Step 5: Verify empty state**

Confirm a client with no conditions renders no medical row on its card and `-` in the detail medical tab.

---

## Self-review notes

- **Spec coverage:** migration columns/view/RPCs (Task 1), transformers both directions (Task 2), wizard edit (Task 3), detail display (Task 4), card redesign incl. days/shift/tier/flags/contact-removal (Task 5), uncheck-persists + empty-state (Task 6). All spec sections covered.
- **Type consistency:** flag keys are `isDiabetic`/`isCeliac`/`isHypertensive` (frontend) ↔ `is_diabetic`/`is_celiac`/`is_hypertensive` (DB) ↔ `p_med_is_*` (RPC params) consistently across all tasks.
- **Booleans vs COALESCE:** frontend always sends booleans on edit, so `COALESCE(p_med_is_*, ...)` persists `false` correctly; the NULL default only guards partial RPC calls that omit the flags.
