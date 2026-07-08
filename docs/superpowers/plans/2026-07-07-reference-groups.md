# Grupos de referencia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Un grupo de referencia por (weekday, shift) que guarda layout + asignaciones y se aplica por copia reconciliada a un día concreto, en el módulo de Grupos.

**Architecture:** Tablas `reference_group_*` (espejan el árbol de grupos, keyed por weekday+shift) + 2 RPCs atómicos (`save_reference_group`, `apply_reference_group`). Servicio nuevo. Dos botones en DailyGroups (solo hoy, días de semana): Guardar / Aplicar (con confirmación). Reconciliación por `present_ids` que provee el frontend vía classifyDay.

**Tech Stack:** React 19, Supabase (PostgREST + RPC), @dnd-kit, Jest.

## Global Constraints

- UI en español, código en inglés; sin `;` innecesarios en JS/JSX.
- Migración vía Supabase MCP `apply_migration`; próxima es la **043**.
- Grupos = allow-all autenticado (todos los roles). Weekday ∈ monday..friday; shift ∈ morning/afternoon.
- Reconciliación en frontend (present_ids), RPC solo filtra.
- Commit termina con: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Migración 043 — tablas + RPCs

**Files:**
- Create: `supabase/migrations/043_reference_groups.sql`
- Apply: Supabase MCP `apply_migration` (name `reference_groups`)

**Interfaces:**
- Produces: tablas `reference_group_*`; RPCs `save_reference_group(date,text,text)→uuid`, `apply_reference_group(text,text,date,uuid[])→void`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 043_reference_groups.sql
CREATE TABLE reference_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weekday TEXT NOT NULL CHECK (weekday IN ('monday','tuesday','wednesday','thursday','friday')),
  shift   TEXT NOT NULL CHECK (shift IN ('morning','afternoon')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (weekday, shift)
);
CREATE TABLE reference_group_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_group_id UUID NOT NULL REFERENCES reference_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  time TIME NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reference_group_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_slot_id UUID NOT NULL REFERENCES reference_group_slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  responsible TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reference_group_activity_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_activity_id UUID NOT NULL REFERENCES reference_group_activities(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  UNIQUE (reference_activity_id, client_id)
);

CREATE INDEX idx_reference_group_slots_group ON reference_group_slots(reference_group_id);
CREATE INDEX idx_reference_group_activities_slot ON reference_group_activities(reference_slot_id);
CREATE INDEX idx_reference_group_activity_clients_activity ON reference_group_activity_clients(reference_activity_id);

CREATE TRIGGER update_reference_groups_updated_at
  BEFORE UPDATE ON reference_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reference_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_group_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_group_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_group_activity_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reference_groups all" ON reference_groups FOR ALL USING (is_authenticated()) WITH CHECK (is_authenticated());
CREATE POLICY "reference_group_slots all" ON reference_group_slots FOR ALL USING (is_authenticated()) WITH CHECK (is_authenticated());
CREATE POLICY "reference_group_activities all" ON reference_group_activities FOR ALL USING (is_authenticated()) WITH CHECK (is_authenticated());
CREATE POLICY "reference_group_activity_clients all" ON reference_group_activity_clients FOR ALL USING (is_authenticated()) WITH CHECK (is_authenticated());

-- Snapshot the current day (date, shift) into the reference group for (weekday, shift).
CREATE OR REPLACE FUNCTION save_reference_group(p_date date, p_shift text, p_weekday text)
RETURNS uuid AS $$
DECLARE
  v_ref_id uuid;
  v_slot RECORD;
  v_new_slot_id uuid;
  v_act RECORD;
  v_new_act_id uuid;
BEGIN
  DELETE FROM reference_groups WHERE weekday = p_weekday AND shift = p_shift;
  INSERT INTO reference_groups (weekday, shift) VALUES (p_weekday, p_shift) RETURNING id INTO v_ref_id;

  FOR v_slot IN
    SELECT * FROM group_time_slots WHERE date = p_date AND shift = p_shift ORDER BY position
  LOOP
    INSERT INTO reference_group_slots (reference_group_id, name, time, position)
    VALUES (v_ref_id, v_slot.name, v_slot.time, v_slot.position)
    RETURNING id INTO v_new_slot_id;

    FOR v_act IN
      SELECT * FROM group_activities WHERE time_slot_id = v_slot.id ORDER BY position
    LOOP
      INSERT INTO reference_group_activities (reference_slot_id, name, responsible, position)
      VALUES (v_new_slot_id, v_act.name, v_act.responsible, v_act.position)
      RETURNING id INTO v_new_act_id;

      INSERT INTO reference_group_activity_clients (reference_activity_id, client_id)
      SELECT v_new_act_id, a.client_id
      FROM group_activity_assignments a
      WHERE a.activity_id = v_act.id;
    END LOOP;
  END LOOP;

  RETURN v_ref_id;
END;
$$ LANGUAGE plpgsql;

-- Apply the reference group for (weekday, shift) onto (date, shift), overwriting.
-- Only assigns clients whose id is in p_present_ids (frontend reconciliation).
CREATE OR REPLACE FUNCTION apply_reference_group(p_weekday text, p_shift text, p_date date, p_present_ids uuid[])
RETURNS void AS $$
DECLARE
  v_ref_id uuid;
  v_slot RECORD;
  v_new_slot_id uuid;
  v_act RECORD;
  v_new_act_id uuid;
BEGIN
  SELECT id INTO v_ref_id FROM reference_groups WHERE weekday = p_weekday AND shift = p_shift;
  IF v_ref_id IS NULL THEN RETURN; END IF;

  DELETE FROM group_time_slots WHERE date = p_date AND shift = p_shift;

  FOR v_slot IN
    SELECT * FROM reference_group_slots WHERE reference_group_id = v_ref_id ORDER BY position
  LOOP
    INSERT INTO group_time_slots (date, shift, name, time, position)
    VALUES (p_date, p_shift, v_slot.name, v_slot.time, v_slot.position)
    RETURNING id INTO v_new_slot_id;

    FOR v_act IN
      SELECT * FROM reference_group_activities WHERE reference_slot_id = v_slot.id ORDER BY position
    LOOP
      INSERT INTO group_activities (time_slot_id, name, responsible, position)
      VALUES (v_new_slot_id, v_act.name, v_act.responsible, v_act.position)
      RETURNING id INTO v_new_act_id;

      INSERT INTO group_activity_assignments (activity_id, client_id)
      SELECT v_new_act_id, rac.client_id
      FROM reference_group_activity_clients rac
      WHERE rac.reference_activity_id = v_act.id
        AND rac.client_id = ANY(p_present_ids);
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Verificar helpers** — confirmar que existen `update_updated_at_column`, `is_authenticated`, `gen_random_uuid`:
```sql
SELECT proname FROM pg_proc WHERE proname IN ('update_updated_at_column','is_authenticated','gen_random_uuid');
```
Expected: los tres presentes. (Nota: los grupos usan `gen_random_uuid()`, no `uuid_generate_v4()`, ver migración 014.)

- [ ] **Step 3: Aplicar** vía `apply_migration` (name `reference_groups`). Expected: sin error.

- [ ] **Step 4: Verificar tablas + funciones**:
```sql
SELECT count(*) FROM reference_groups;
SELECT proname FROM pg_proc WHERE proname IN ('save_reference_group','apply_reference_group');
```
Expected: 0 filas; 2 funciones.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/043_reference_groups.sql
git commit -m "feat(groups): migración 043 grupos de referencia (tablas + RPCs save/apply)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Servicio referenceGroupService + re-export

**Files:**
- Create: `src/services/groups/referenceGroupService.js`
- Modify: `src/services/api.js` (re-export)

**Interfaces:**
- Produces: `saveReferenceGroup(dateStr, shift, weekday)`, `applyReferenceGroup(weekday, shift, dateStr, presentIds)`, `getReferenceGroupInfo(weekday, shift)`.

- [ ] **Step 1: Crear el servicio**

```js
import { supabase } from '../supabase/client'

// Snapshot the current day (dateStr, shift) as the reference group for (weekday, shift).
export async function saveReferenceGroup(dateStr, shift, weekday) {
  const { data, error } = await supabase.rpc('save_reference_group', {
    p_date: dateStr, p_shift: shift, p_weekday: weekday
  })
  if (error) throw new Error(error.message)
  return data
}

// Apply the reference group for (weekday, shift) onto (dateStr, shift), overwriting.
// Only clients in presentIds get assigned.
export async function applyReferenceGroup(weekday, shift, dateStr, presentIds) {
  const { error } = await supabase.rpc('apply_reference_group', {
    p_weekday: weekday, p_shift: shift, p_date: dateStr, p_present_ids: presentIds
  })
  if (error) throw new Error(error.message)
}

// Existence + last-updated for a (weekday, shift) reference group.
export async function getReferenceGroupInfo(weekday, shift) {
  const { data, error } = await supabase
    .from('reference_groups')
    .select('updated_at')
    .eq('weekday', weekday)
    .eq('shift', shift)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return { exists: !!data, updatedAt: data?.updated_at || null }
}
```

- [ ] **Step 2: Re-export en api.js** — agregar tras el bloque de `./groups/groupService` (buscar `from './groups/groupService'`):
```js
export {
  saveReferenceGroup,
  applyReferenceGroup,
  getReferenceGroupInfo
} from './groups/referenceGroupService'
```

- [ ] **Step 3: Verificar imports** — `CI=true npx craco test src/services --watchAll=false`. Expected: PASS (142).

- [ ] **Step 4: Commit**
```bash
git add src/services/groups/referenceGroupService.js src/services/api.js
git commit -m "feat(groups): servicio de grupos de referencia

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: UI en DailyGroups — botones Guardar / Aplicar

**Files:**
- Modify: `src/pages/Groups/DailyGroups.jsx`

**Interfaces:**
- Consumes: `saveReferenceGroup`, `applyReferenceGroup`, `getReferenceGroupInfo`; vars existentes `selectedDate`, `dayName` (~:69), `activeShift` (~:49), `readOnly` (~:67), `isWeekend` (~:70), `shiftClients` (~:94), `dateStr`, `loadSlots` (~:136), `timeSlots` (~:54).

- [ ] **Step 1: Imports** — agregar a los imports desde `../../services/api` (o desde donde importa groupService): `saveReferenceGroup, applyReferenceGroup, getReferenceGroupInfo`. (Confirmar la fuente de imports de grupos en el archivo y sumar ahí.)

- [ ] **Step 2: Estado** — junto a los otros `useState`, agregar:
```jsx
  const [referenceInfo, setReferenceInfo] = useState({ exists: false, updatedAt: null })
  const [refBusy, setRefBusy] = useState(false)
```

- [ ] **Step 3: Cargar info al cambiar fecha/turno** — agregar un `useEffect` que corra cuando cambian `dayName`/`activeShift` y no sea fin de semana:
```jsx
  useEffect(() => {
    if (isWeekend) { setReferenceInfo({ exists: false, updatedAt: null }); return }
    let alive = true
    getReferenceGroupInfo(dayName, activeShift)
      .then(info => { if (alive) setReferenceInfo(info) })
      .catch(() => { if (alive) setReferenceInfo({ exists: false, updatedAt: null }) })
    return () => { alive = false }
  }, [dayName, activeShift, isWeekend])
```

- [ ] **Step 4: Handlers**:
```jsx
  const handleSaveReference = async () => {
    if (referenceInfo.exists && !window.confirm('Ya existe un grupo de referencia para este día y turno. ¿Sobrescribir con la configuración actual?')) return
    setRefBusy(true)
    try {
      await saveReferenceGroup(dateStr, activeShift, dayName)
      const info = await getReferenceGroupInfo(dayName, activeShift)
      setReferenceInfo(info)
    } catch (e) {
      alert('Error al guardar el grupo de referencia: ' + e.message)
    } finally {
      setRefBusy(false)
    }
  }

  const handleApplyReference = async () => {
    if (!referenceInfo.exists) return
    if (timeSlots.length > 0 && !window.confirm('Esto reemplaza todos los grupos y asignaciones de hoy con el grupo de referencia. ¿Continuar?')) return
    setRefBusy(true)
    try {
      const presentIds = shiftClients.map(c => c.id)
      await applyReferenceGroup(dayName, activeShift, dateStr, presentIds)
      await loadSlots(dateStr, activeShift, { silent: true })
    } catch (e) {
      alert('Error al aplicar el grupo de referencia: ' + e.message)
    } finally {
      setRefBusy(false)
    }
  }
```
(Confirmar la firma real de `loadSlots` — según el mapeo es `loadSlots(dateStr, shift, {silent})` ~:136-147; ajustar si difiere.)

- [ ] **Step 5: Botones** — junto al botón "Plantillas" (~:383-390), y solo cuando `!readOnly && !isWeekend`:
```jsx
              {!readOnly && !isWeekend && (
                <>
                  <button
                    onClick={handleSaveReference}
                    disabled={refBusy}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    title={referenceInfo.updatedAt ? `Última actualización: ${referenceInfo.updatedAt}` : 'Sin referencia guardada'}
                  >
                    Guardar grupo de referencia
                  </button>
                  <button
                    onClick={handleApplyReference}
                    disabled={refBusy || !referenceInfo.exists}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Aplicar grupo de referencia
                  </button>
                </>
              )}
```
(Ajustar clases al estilo real de los botones vecinos del header para consistencia visual.)

- [ ] **Step 6: Verificar build** — `CI=true npm run build 2>&1 | grep -E "Compiled|Failed"`. Expected: Compiled successfully.

- [ ] **Step 7: Commit**
```bash
git add src/pages/Groups/DailyGroups.jsx
git commit -m "feat(groups): botones guardar/aplicar grupo de referencia en DailyGroups

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verificación final (BD, con cleanup)

Con execute_sql, sobre un día/turno de prueba:
1. Insertar un `group_time_slots` (date X, shift) con 1 activity y 2 assignments (clientes A, B).
2. `SELECT save_reference_group(X, shift, weekday)` → verificar filas en `reference_group_*` (1 slot, 1 activity, 2 clients).
3. `DELETE FROM group_time_slots WHERE date=X AND shift=shift`.
4. `SELECT apply_reference_group(weekday, shift, X, ARRAY[A]::uuid[])` → verificar que el día X tiene el slot+activity y **solo** el assignment de A (B excluido por no estar en present_ids).
5. Re-aplicar y verificar overwrite (no duplica).
6. Limpiar: borrar el día X y `DELETE FROM reference_groups WHERE weekday=... AND shift=...`.

Build limpio. Confirmar que Plantillas sigue intacto.
