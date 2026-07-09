# Motivo de falta con tooltip en calendario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar un motivo de texto libre opcional al marcar una falta y mostrarlo en el tooltip del calendario del cliente.

**Architecture:** La columna `attendance_records.notes` y su exposición en `attendance_view`/`getClientAttendance` ya existen. Solo falta que el RPC `mark_day_absent` acepte y escriba el motivo, que el modal lo capture con un flujo seleccionar→confirmar, y que el calendario lo muestre en el tooltip.

**Tech Stack:** React 19, Supabase (Postgres RPC), Tailwind. Sin librerías nuevas.

## Global Constraints

- Variables y código en inglés; textos de UI en español.
- No usar `;` en JS/JSX cuando no es obligatorio.
- No tocar la lógica de crédito de recupero ni la facturación.
- Migración nueva = número `054`, archivo en `supabase/migrations/`.
- Firma actual del RPC (verificada en DB): `mark_day_absent(uuid, date, boolean, text)` — única sobrecarga.

---

### Task 1: RPC `mark_day_absent` acepta y escribe `notes`

**Files:**
- Create: `supabase/migrations/054_absence_notes.sql`

**Interfaces:**
- Produces: `mark_day_absent(p_client_id uuid, p_date date, p_is_justified boolean DEFAULT false, p_created_by text DEFAULT NULL, p_notes text DEFAULT NULL)` que escribe `attendance_records.notes = NULLIF(TRIM(p_notes), '')` en insert y update.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/054_absence_notes.sql`:

```sql
-- 054_absence_notes.sql
-- mark_day_absent gana p_notes: motivo de texto libre opcional persistido en
-- attendance_records.notes (columna ya existente, expuesta por attendance_view).
-- La columna y la vista NO cambian; solo la función. Se dropea la firma vieja de 4
-- params porque agregar un param con default crea una sobrecarga nueva (no reemplaza)
-- y dejaría dos funciones -> "function is not unique". Firma actual verificada en DB:
-- mark_day_absent(uuid, date, boolean, text).

DROP FUNCTION IF EXISTS public.mark_day_absent(uuid, date, boolean, text);

CREATE OR REPLACE FUNCTION public.mark_day_absent(
  p_client_id uuid,
  p_date date,
  p_is_justified boolean DEFAULT false,
  p_created_by text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
BEGIN
  INSERT INTO attendance_records (client_id, date, status, is_justified, notes)
  VALUES (p_client_id, p_date, 'absent', p_is_justified, NULLIF(TRIM(p_notes), ''))
  ON CONFLICT (client_id, date) DO UPDATE SET
    status='absent',
    is_justified=EXCLUDED.is_justified,
    notes=NULLIF(TRIM(EXCLUDED.notes), ''),
    updated_at=NOW()
  RETURNING id INTO v_record_id;
  IF p_is_justified THEN
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, grant_attendance_id, created_by_name)
    VALUES (p_client_id, p_date, p_date + 30, 'justified_absence', v_record_id, p_created_by)
    RETURNING id INTO v_credit_id;
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
    VALUES (p_client_id, p_date, 1, 'justified_absence', v_record_id, v_new_balance, p_created_by, v_credit_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'recordId', v_record_id);
END;
$function$;
```

- [ ] **Step 2: Aplicar la migración**

Aplicar vía Supabase MCP `apply_migration` (name: `054_absence_notes`, query = contenido del archivo).

- [ ] **Step 3: Verificar la nueva firma y el comportamiento**

Ejecutar por SQL contra un cliente de prueba real (ver un `client_id` con `SELECT id FROM clients LIMIT 1`):

```sql
-- firma nueva presente y única
SELECT pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='mark_day_absent';
-- esperado: una sola fila con "..., p_notes text"

-- escribe notes (usar un client_id y una fecha pasada de un día asignado)
SELECT mark_day_absent('<client_id>'::uuid, '2026-06-02'::date, false, 'test', 'Turno médico');
SELECT notes FROM attendance_records WHERE client_id='<client_id>' AND date='2026-06-02';
-- esperado: 'Turno médico'

-- notes vacío -> NULL
SELECT mark_day_absent('<client_id>'::uuid, '2026-06-02'::date, false, 'test', '   ');
SELECT notes FROM attendance_records WHERE client_id='<client_id>' AND date='2026-06-02';
-- esperado: NULL
```

Limpiar el registro de prueba al terminar: `DELETE FROM attendance_records WHERE client_id='<client_id>' AND date='2026-06-02';` (y el crédito/ledger no se tocó porque se usó `is_justified=false`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/054_absence_notes.sql
git commit -m "feat(asistencia): mark_day_absent persiste motivo de falta en notes"
```

---

### Task 2: Servicio `markDayAbsent` pasa `notes`

**Files:**
- Modify: `src/services/attendance/attendanceService.js:75-85`

**Interfaces:**
- Consumes: RPC `mark_day_absent` con `p_notes` (Task 1).
- Produces: `markDayAbsent(clientId, date, isJustified, userName, notes)` — 5º parámetro `notes` opcional, enviado como `p_notes`.

- [ ] **Step 1: Modificar la firma y el body**

En `src/services/attendance/attendanceService.js`, reemplazar la función `markDayAbsent`:

```javascript
/**
 * Mark a past assigned day as absent
 * @param {string} clientId
 * @param {string} date - YYYY-MM-DD
 * @param {boolean} isJustified
 * @param {string} userName
 * @param {string|null} notes - Optional free-text reason
 */
export async function markDayAbsent(clientId, date, isJustified, userName, notes = null) {
  const { data, error } = await supabase.rpc('mark_day_absent', {
    p_client_id: clientId,
    p_date: date,
    p_is_justified: isJustified,
    p_created_by: userName,
    p_notes: notes
  })
  if (error) throw new Error(error.message)
  if (!data.success) throw new Error(data.error || 'Error al marcar falta')
  return data
}
```

- [ ] **Step 2: Verificar compilación**

Run: `npx eslint src/services/attendance/attendanceService.js`
Expected: sin errores (o solo warnings preexistentes).

- [ ] **Step 3: Commit**

```bash
git add src/services/attendance/attendanceService.js
git commit -m "feat(asistencia): markDayAbsent acepta motivo opcional"
```

---

### Task 3: AbsenceModal con flujo seleccionar → confirmar + campo motivo

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx:1471-1506` (componente `AbsenceModal`)
- Modify: `src/pages/Clients/ClientDetail.jsx:1194-1202` (uso de `AbsenceModal`, `onConfirm`)

**Interfaces:**
- Consumes: `markDayAbsent(clientId, date, isJustified, userName, notes)` (Task 2).
- Produces: `AbsenceModal` llama `onConfirm(isJustified, notes)` donde `notes` es `string|null`.

- [ ] **Step 1: Reescribir el componente `AbsenceModal`**

Reemplazar la función `AbsenceModal` completa (líneas ~1471-1506) por:

```jsx
function AbsenceModal({ isOpen, onClose, date, onConfirm }) {
  const [selected, setSelected] = useState(null) // null | true (justified) | false
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset on open/close
  useEffect(() => {
    if (isOpen) {
      setSelected(null)
      setReason('')
      setSubmitting(false)
    }
  }, [isOpen])

  const handleConfirm = async () => {
    if (selected === null) return
    setSubmitting(true)
    try {
      await onConfirm(selected, reason.trim() || null)
    } finally {
      setSubmitting(false)
    }
  }

  // Static Tailwind classes only — the JIT does NOT detect interpolated class names
  // like `border-${color}-400`, so both variants are written out in full.
  const baseOption = 'w-full p-4 rounded-lg border text-left transition-colors'
  const justifiedClass = selected === true
    ? `${baseOption} border-green-400 bg-green-50 ring-1 ring-green-300`
    : `${baseOption} border-gray-200 hover:bg-green-50`
  const unjustifiedClass = selected === false
    ? `${baseOption} border-red-400 bg-red-50 ring-1 ring-red-300`
    : `${baseOption} border-gray-200 hover:bg-red-50`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Registrar falta — ${date ? format(new Date(date), "d 'de' MMMM", { locale: es }) : ''}`}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">El cliente no asistió. ¿Fue una falta justificada?</p>
        <button
          type="button"
          onClick={() => setSelected(true)}
          disabled={submitting}
          className={justifiedClass}
        >
          <p className="font-medium text-gray-900 flex items-center gap-1.5">
            {selected === true && <Check className="w-4 h-4 text-green-600" />}
            Justificada
          </p>
          <p className="text-sm text-gray-500 mt-0.5">El cliente gana 1 día de recupero</p>
        </button>
        <button
          type="button"
          onClick={() => setSelected(false)}
          disabled={submitting}
          className={unjustifiedClass}
        >
          <p className="font-medium text-gray-900 flex items-center gap-1.5">
            {selected === false && <Check className="w-4 h-4 text-red-600" />}
            No justificada
          </p>
          <p className="text-sm text-gray-500 mt-0.5">Sin crédito de recupero</p>
        </button>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Motivo (opcional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo de la falta..."
            rows={2}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selected === null || submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Guardando...' : 'Confirmar falta'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

Todas las clases usadas (`border-green-400`, `bg-green-50`, `ring-green-300`, `border-red-400`, `bg-red-50`, `ring-red-300`) son estáticas y se recompilan en Task 5.

- [ ] **Step 2: Asegurar imports `useEffect` y `Check`**

Verificar en la cabecera de `ClientDetail.jsx`:
- `Check` ya está importado de `iconoir-react` (línea 4). Confirmar; si no, agregarlo.
- `useEffect` debe estar en el import de React. Revisar `import ... from 'react'` al inicio del archivo y agregar `useEffect` si falta.

Run: `grep -n "from 'react'" src/pages/Clients/ClientDetail.jsx`
Si `useEffect` no aparece en esa línea, agregarlo al destructuring.

- [ ] **Step 3: Actualizar el `onConfirm` en el uso de `AbsenceModal`**

En el JSX (líneas ~1195-1202), cambiar el `onConfirm` para pasar `notes`:

```jsx
      <AbsenceModal
        isOpen={modal === 'absence'}
        onClose={closeModal}
        date={selectedDate}
        onConfirm={(isJustified, notes) =>
          withProcessing(() => markDayAbsent(client.id, selectedDate, isJustified, user?.name, notes))
        }
      />
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(clientes): campo de motivo en modal de falta (seleccionar y confirmar)"
```

---

### Task 4: Tooltip del calendario muestra tipo + motivo

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx:114-121` (`getDayTooltip`)
- Modify: `src/pages/Clients/ClientDetail.jsx:919-933` (`getDayStatus`)
- Modify: `src/pages/Clients/ClientDetail.jsx:1114-1151` (render del día)

**Interfaces:**
- Consumes: `attendance` records con `notes` (ya provisto por `getClientAttendance`).
- Produces: `getDayTooltip(status, isJustified, notes)` devuelve `{ type: string, reason: string|null }` para faltas con motivo, o string para el resto — ver decisión abajo. Se elige devolver un objeto siempre para uniformidad.

- [ ] **Step 1: Reescribir `getDayTooltip` para separar tipo y motivo**

Reemplazar `getDayTooltip` (líneas ~114-121):

```javascript
// Returns { title, reason } — title is the status label, reason is the optional
// free-text absence note (null when absent). Empty title => no tooltip.
function getDayTooltip(status, isJustified, notes) {
  let title = ''
  if (status === 'attended') title = 'Asistió'
  else if (status === 'absent') title = isJustified ? 'Falta justificada (+1 recupero)' : 'Falta no justificada'
  else if (status === 'vacation') title = 'Vacaciones'
  else if (status === 'recovery') title = 'Día recuperado'
  else if (status === 'scheduled') title = 'Programado'
  const reason = status === 'absent' && notes ? notes : null
  return { title, reason }
}
```

- [ ] **Step 2: Exponer `notes` en `getDayStatus`**

En `getDayStatus` (líneas ~919-933), agregar `notes` al retorno del caso con registro. Solo la rama `if (rec)` necesita el motivo:

```javascript
    if (rec) return { status: rec.status, isJustified: rec.isJustified ?? false, isAssigned: true, notes: rec.notes ?? null }
```

Las otras ramas devuelven implícitamente `notes: undefined`, lo cual es aceptable (getDayTooltip lo trata como sin motivo). Para consistencia de shape, no es necesario tocarlas.

- [ ] **Step 3: Actualizar el render del día para usar el nuevo shape**

En el render (líneas ~1114-1151):

1. En el destructuring: `const { status, isJustified, isAssigned, notes } = getDayStatus(day)`
2. Reemplazar la construcción del tooltip:

```jsx
              const tip = getDayTooltip(status, isJustified, notes)
              const isRecoverable = status === 'not_scheduled' && !isWeekend
              const nativeTitle = isStartDate
                ? 'Primer día'
                : isRecoverable
                  ? 'Recuperar día'
                  : tip.title
                    ? (tip.reason ? `${tip.title}\n${tip.reason}` : tip.title)
                    : ''
```

3. Cambiar el atributo `title` del `<button>` a `title={nativeTitle}`.

4. Reemplazar el `<span>` del tooltip custom por uno que muestre tipo + motivo y envuelva texto largo:

```jsx
                  {tip.title && (
                    <span className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-gray-900 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 ${tip.reason ? 'max-w-[200px] whitespace-normal text-left' : 'whitespace-nowrap'}`}>
                      <span className="font-medium block">{tip.title}</span>
                      {tip.reason && <span className="block text-gray-300 mt-0.5">{tip.reason}</span>}
                    </span>
                  )}
```

- [ ] **Step 4: Verificar que no queden usos viejos de `getDayTooltip`**

Run: `grep -n "getDayTooltip" src/pages/Clients/ClientDetail.jsx`
Expected: solo la definición y los usos dentro del render del día (Step 3). No debe quedar ningún `getDayTooltip(status, isJustified)` de 2 args devolviendo string usado como texto directo.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(clientes): tooltip de falta muestra tipo y motivo"
```

---

### Task 5: Recompilar Tailwind y verificación end-to-end

**Files:**
- Modify: `src/tailwind.output.css` (generado)

- [ ] **Step 1: Recompilar Tailwind**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: compila sin error; el archivo se actualiza.

- [ ] **Step 2: Verificación en la app (skill `verify`)**

Levantar la app, entrar a un cliente, en el calendario:
1. Clic en un día pasado asignado → modal "Registrar falta".
2. Confirmar sin elegir tipo → botón deshabilitado (no hace nada).
3. Elegir "Justificada" → card resaltada verde; escribir motivo "Turno médico"; Confirmar.
4. Hover sobre el día → tooltip muestra "Falta justificada (+1 recupero)" y debajo "Turno médico".
5. Verificar en DB que `attendance_records.notes = 'Turno médico'` para ese día.
6. Marcar otra falta "No justificada" sin motivo → tooltip solo muestra el tipo, sin segunda línea.
7. Confirmar que el crédito de recupero de la justificada se otorgó (balance +1) — sin regresión.

- [ ] **Step 3: Commit**

```bash
git add src/tailwind.output.css
git commit -m "style(clientes): recompila Tailwind para modal y tooltip de falta"
```

---

## Notas de verificación final

- Falta justificada con motivo → tooltip tipo + motivo; `notes` en DB; crédito +1.
- Falta no justificada sin motivo → tooltip solo tipo; `notes` NULL.
- Reescribir una falta con otro motivo → `notes` se actualiza (rama `DO UPDATE`).
- `title` nativo funciona como fallback (tipo + motivo en dos líneas por `\n`).
