# Grupos de referencia

## Contexto

El módulo de Grupos (`src/pages/Groups/DailyGroups.jsx`) organiza, por **(fecha, turno)**, una
jerarquía **time slot → activity → assignment(client_id)**. Un "grupo" en la UI es una
*activity* (personas agrupadas bajo una actividad dentro de un time slot). Solo **"hoy"** es
editable (los otros días son read-only). Ya existe un sistema de **Plantillas**
(`group_templates`): layout con nombre + turno, sin personas, aplicado por delete+recreate.

Se agregan **grupos de referencia**: un layout guardado (time slots + activities, por copia)
**+ asignaciones de personas** (client_id → activity), **único por (weekday, shift)** (ej.
martes-tarde). Se aplica por copia a un día concreto, reconciliando contra quién asiste ese día.

### Decisiones (confirmadas con el usuario)

1. **Aplicación**: solo por **botón manual** ("Aplicar grupo de referencia"). Sin auto-apply.
2. **Al aplicar**: **sobreescribe todo** el layout y asignaciones del día/turno (con confirmación).
3. **Plantillas**: **coexisten** (no se tocan); grupos de referencia es un concepto aparte.

### Reglas de reconciliación

- Personas en la referencia que **no asisten** ese día (falta/vacaciones/cambio de plan) → **no
  se asignan** y **nada se muestra** reflejándolo.
- Personas que **asisten** ese día pero **no están** en la referencia → quedan **en el pool sin
  asignar** (asistente normal). El pool ya es la lista `present`, así que esto es automático.
- La lista `present` se calcula en el frontend con `classifyDay` (existente) y se pasa al RPC.

## Modelo de datos (migración 043)

Espeja el árbol de grupos, keyed por weekday+shift:

```sql
reference_groups (
  id UUID PK,
  weekday TEXT NOT NULL CHECK (weekday IN ('monday','tuesday','wednesday','thursday','friday')),
  shift   TEXT NOT NULL CHECK (shift IN ('morning','afternoon')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (weekday, shift)
)
reference_group_slots (
  id UUID PK, reference_group_id UUID FK→reference_groups CASCADE,
  name TEXT NOT NULL, time TIME NOT NULL, position INT NOT NULL DEFAULT 0
)
reference_group_activities (
  id UUID PK, reference_slot_id UUID FK→reference_group_slots CASCADE,
  name TEXT NOT NULL, responsible TEXT, position INT NOT NULL DEFAULT 0
)
reference_group_activity_clients (
  id UUID PK, reference_activity_id UUID FK→reference_group_activities CASCADE,
  client_id UUID FK→clients CASCADE,
  UNIQUE (reference_activity_id, client_id)
)
```

- RLS: allow-all autenticado (mismo patrón que `group_time_slots` etc. → todos los roles).
- `updated_at` trigger en `reference_groups` (reusar `update_updated_at_column`).
- Weekday usa los mismos nombres que `plan.assignedDays` / `DAY_NAMES` ('monday'..'friday').

## RPCs (atómicos, SECURITY DEFINER no requerido; allow-all RLS)

- **`save_reference_group(p_date date, p_shift text, p_weekday text)`**: borra la referencia
  previa de `(weekday, shift)` y la recrea snapshoteando el día actual `(date, shift)`:
  copia `group_time_slots`→`reference_group_slots`, `group_activities`→`reference_group_activities`,
  `group_activity_assignments`→`reference_group_activity_clients` (todo tal cual está hoy).
  Actualiza `updated_at`. Devuelve el `reference_groups.id`.
- **`apply_reference_group(p_weekday text, p_shift text, p_date date, p_present_ids uuid[])`**:
  borra los `group_time_slots` de `(date, shift)` (cascada) y copia el layout de la referencia;
  de las asignaciones, **solo inserta** las de `client_id = ANY(p_present_ids)`. Idempotente
  respecto a re-aplicar (siempre parte de cero para ese día/turno).

Ambos RPCs no reconstruyen lógica de asistencia: la reconciliación se limita a filtrar por
`p_present_ids` que provee el frontend.

## Servicio `src/services/groups/referenceGroupService.js`

- `saveReferenceGroup(dateStr, shift, weekday)` → `supabase.rpc('save_reference_group', ...)`.
- `applyReferenceGroup(weekday, shift, dateStr, presentIds)` → `supabase.rpc('apply_reference_group', ...)`.
- `getReferenceGroupInfo(weekday, shift)` → consulta `reference_groups` por (weekday, shift);
  devuelve `{ exists: boolean, updatedAt: string|null }`.

Re-export en `src/services/api.js`.

## UI en `DailyGroups.jsx`

- Solo visible en **día editable (hoy)** y **días de semana** (no fin de semana), junto al botón
  "Plantillas".
- **"Guardar grupo de referencia"**: snapshotea el día actual `(date, activeShift)` como
  referencia de `(dayName, activeShift)`. Si ya existe una referencia, confirma sobreescritura.
  Tras guardar, refresca el info (updatedAt).
- **"Aplicar grupo de referencia"**: deshabilitado si no hay referencia para `(dayName,
  activeShift)`. Si el día ya tiene time slots, confirma que **sobreescribe todo**. Calcula
  `presentIds = shiftClients.map(c => c.id)` y llama al RPC; luego recarga los slots.
- Estado nuevo: `referenceInfo` (por shift) cargado al cambiar fecha/turno; recargado tras guardar.
- Modales de confirmación reutilizando el patrón existente (o `window.confirm`, como ya usa el módulo).

## Testing / verificación

- Verificación en BD (execute_sql, con cleanup): crear un día con slots+activities+assignments,
  `save_reference_group`, confirmar filas en tablas de referencia; borrar el día, `apply_reference_group`
  con un subconjunto de present_ids y confirmar que solo se asignan esos; re-aplicar y confirmar overwrite.
- `npm run build` compila.
- Manual: guardar hoy como referencia, cambiar asignaciones, aplicar y ver que se reconstruye
  reconciliado; verificar que un ausente en la referencia no se asigna y un presente nuevo queda en el pool.

## Fuera de alcance

- No se toca Plantillas (`group_templates`).
- Solo Mon-Fri / morning-afternoon.
- Días read-only (no hoy) no muestran los botones.
