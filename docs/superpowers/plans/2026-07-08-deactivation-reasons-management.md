# Motivos de baja gestionables + columna "Pausa temporal" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir los motivos de baja en datos gestionables (CRUD con descripción/tooltip) y agregar "Pausa temporal no retomada" como motivo Y columna del kanban de Bajas.

**Architecture:** Nueva tabla `deactivation_reasons` (slug estable) reemplaza los motivos hardcodeados; `clients.deactivation_reason`/`churn_followups.reason` siguen guardando el key como texto (se elimina el CHECK). Nueva etapa `temporary_pause` en el kanban. Servicio + modal de gestión (superadmin). Frontend consume motivos desde DB en vez de arrays estáticos.

**Tech Stack:** React 19, Supabase (PostgreSQL + RLS), @dnd-kit, Tailwind (compilación manual).

## Global Constraints

- Variables y código en inglés; textos de UI en español.
- No usar `;` innecesarios en JS/JSX.
- Servicios: named exports, mapear snake_case → camelCase; re-export desde `src/services/api.js` si aplica.
- Compilar Tailwind si se agregan clases nuevas: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.
- Spec de referencia: `docs/superpowers/specs/2026-07-08-deactivation-reasons-management-design.md`.
- Migración aplicada vía Supabase MCP (`apply_migration`) además de guardar el `.sql`.

---

### Task 1: Migración DB — tabla, seed, mapeo, etapa, RPC

**Files:**
- Create: `supabase/migrations/044_deactivation_reasons.sql`
- Aplicar con MCP `apply_migration` (name `deactivation_reasons`).

**Interfaces:**
- Produces: tabla `deactivation_reasons(id, key, label, description, color, sort_order, is_active, is_system, created_at, updated_at)`; etapa `temporary_pause` válida en `churn_followups.stage`; RPC `get_churn_board` auto-provisiona reason `temporary_pause_not_resumed` → etapa `temporary_pause`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 044_deactivation_reasons.sql
-- Motivos de baja gestionables + etapa "Pausa temporal" en el kanban de churn.

-- 1. Tabla de motivos
CREATE TABLE IF NOT EXISTS deactivation_reasons (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text,
  color       text NOT NULL DEFAULT '#64748b',
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_deactivation_reasons_updated_at ON deactivation_reasons;
CREATE TRIGGER update_deactivation_reasons_updated_at
  BEFORE UPDATE ON deactivation_reasons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. RLS: lectura para todos; escritura solo superadmin
ALTER TABLE deactivation_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deactivation_reasons_select ON deactivation_reasons;
CREATE POLICY deactivation_reasons_select ON deactivation_reasons
  FOR SELECT USING (true);

DROP POLICY IF EXISTS deactivation_reasons_write ON deactivation_reasons;
CREATE POLICY deactivation_reasons_write ON deactivation_reasons
  FOR ALL USING (is_superadmin()) WITH CHECK (is_superadmin());

-- 3. Seed de los 8 motivos
INSERT INTO deactivation_reasons (key, label, description, color, sort_order, is_system) VALUES
  ('death', 'Fallecimiento', 'Fallecimiento del usuario.', '#64748b', 1, true),
  ('institutionalization', 'Institucionalización', 'El usuario pasa a un residencial o cuidado permanente fuera del hogar.', '#7c3aed', 2, false),
  ('health_decline', 'Deterioro de salud', 'Agrupa tanto el evento agudo (fractura, cirugía, internación) como el deterioro progresivo.', '#dc2626', 3, false),
  ('adaptation_motivation', 'Adaptación / motivación', 'Dificultad de adaptación al grupo/centro y motivos anímicos. Depresión, angustia, desgano o rechazo a participar, sin que medie necesariamente una causa médica aguda.', '#e11d48', 4, false),
  ('financial', 'Motivo económico', 'La familia no puede sostener el costo.', '#2563eb', 5, false),
  ('logistical_family', 'Motivo logístico-familiar', 'Viajes, mudanzas, conflictos de agenda laboral o de quien traslada al usuario, pausas "de vacaciones" que nunca se retoman.', '#0891b2', 6, false),
  ('temporary_pause_not_resumed', 'Pausa temporal no retomada', 'El usuario o su familia avisa que se ausentará por un período determinado (vacaciones, viaje, un mes puntual) con intención declarada de volver en una fecha específica, pero luego no se reintegra ni comunica un motivo concreto de baja.', '#d97706', 7, true),
  ('other', 'Otro / sin especificar', 'Motivo no contemplado o sin especificar.', '#94a3b8', 8, true)
ON CONFLICT (key) DO NOTHING;

-- 4. Mapeo de datos viejos → nuevos keys
UPDATE clients SET deactivation_reason = 'institutionalization'  WHERE deactivation_reason = 'transfer_to_other_center';
UPDATE clients SET deactivation_reason = 'logistical_family'     WHERE deactivation_reason = 'relocation';
UPDATE clients SET deactivation_reason = 'other'                 WHERE deactivation_reason = 'family_decision';
UPDATE clients SET deactivation_reason = 'adaptation_motivation' WHERE deactivation_reason = 'service_dissatisfaction';

UPDATE churn_followups SET reason = 'institutionalization'  WHERE reason = 'transfer_to_other_center';
UPDATE churn_followups SET reason = 'logistical_family'     WHERE reason = 'relocation';
UPDATE churn_followups SET reason = 'other'                 WHERE reason = 'family_decision';
UPDATE churn_followups SET reason = 'adaptation_motivation' WHERE reason = 'service_dissatisfaction';

-- 5. Quitar el CHECK viejo de motivos (los valores válidos ahora viven en deactivation_reasons)
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_deactivation_reason_check;

-- 6. Nueva etapa temporary_pause en churn_followups.stage
ALTER TABLE churn_followups DROP CONSTRAINT IF EXISTS churn_followups_stage_check;
ALTER TABLE churn_followups ADD CONSTRAINT churn_followups_stage_check
  CHECK (stage IN ('new','contacting','negotiating','temporary_pause','recovered','lost'));
```

- [ ] **Step 2: Actualizar el RPC `get_churn_board` para auto-provisión de la etapa pausa**

Leer la definición actual del RPC en `supabase/migrations/038_dashboard_analytics_and_churn.sql:152-212`. Copiar el `CREATE OR REPLACE FUNCTION get_churn_board()` completo dentro de esta migración y modificar SOLO la expresión que define el stage inicial al provisionar filas. Hoy es (aprox.):

```sql
-- viejo:  CASE WHEN c.deactivation_reason = 'death' THEN 'lost' ELSE 'new' END
-- nuevo:
CASE
  WHEN c.deactivation_reason = 'death' THEN 'lost'
  WHEN c.deactivation_reason = 'temporary_pause_not_resumed' THEN 'temporary_pause'
  ELSE 'new'
END
```

Mantener el resto del RPC idéntico (mismo `SECURITY DEFINER`, mismos returns/joins).

- [ ] **Step 3: Aplicar la migración**

Usar MCP `apply_migration` con `name: "deactivation_reasons"` y el SQL completo (steps 1+2).

- [ ] **Step 4: Verificar en DB**

```sql
SELECT key, label, is_system, sort_order FROM deactivation_reasons ORDER BY sort_order;
SELECT deactivation_reason, count(*) FROM clients WHERE deleted_at IS NOT NULL GROUP BY 1;
```
Expected: 8 motivos ordenados; ningún cliente con `transfer_to_other_center` (debe ser `institutionalization`), keys viejos ausentes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/044_deactivation_reasons.sql
git commit -m "feat(churn): tabla deactivation_reasons + etapa temporary_pause (migracion 044)"
```

---

### Task 2: Servicio `deactivationReasonService`

**Files:**
- Create: `src/services/churn/deactivationReasonService.js`
- Create: `src/services/churn/deactivationReasonService.test.js`
- Modify: `src/services/api.js` (re-export, seguir patrón existente)

**Interfaces:**
- Consumes: cliente Supabase de `../supabase/client`.
- Produces:
  - `slugify(label) -> string`
  - `getReasons({ includeInactive = false }) -> Promise<Reason[]>` (ordenado por `sortOrder`)
  - `createReason({ key?, label, description, color, sortOrder }) -> Promise<Reason>`
  - `updateReason(id, patch) -> Promise<Reason>` (patch: label/description/color/sortOrder/isActive)
  - `setReasonActive(id, isActive) -> Promise<Reason>`
  - `reorderReasons(orderedIds) -> Promise<void>`
  - Reason shape (camelCase): `{ id, key, label, description, color, sortOrder, isActive, isSystem }`

- [ ] **Step 1: Test de `slugify` (lógica pura)**

Seguir el patrón de tests existentes (`src/services/dashboard/commercialStats.test.js`).

```js
import { slugify } from './deactivationReasonService'

test('slugify normaliza a snake_case ascii', () => {
  expect(slugify('Pausa temporal no retomada')).toBe('pausa_temporal_no_retomada')
  expect(slugify('Institucionalización')).toBe('institucionalizacion')
  expect(slugify('  Otro / sin especificar ')).toBe('otro_sin_especificar')
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `CI=true npx react-scripts test src/services/churn/deactivationReasonService.test.js --watchAll=false`
Expected: FAIL (módulo/función no existe).

- [ ] **Step 3: Implementar el servicio**

```js
import { supabase } from '../supabase/client'

const TABLE = 'deactivation_reasons'

export function slugify(label) {
  return (label || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function fromRow(r) {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    description: r.description,
    color: r.color,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    isSystem: r.is_system
  }
}

export async function getReasons({ includeInactive = false } = {}) {
  let query = supabase.from(TABLE).select('*').order('sort_order', { ascending: true })
  if (!includeInactive) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(fromRow)
}

export async function createReason({ key, label, description = '', color = '#64748b', sortOrder = 0 }) {
  const payload = {
    key: key || slugify(label),
    label,
    description,
    color,
    sort_order: sortOrder
  }
  const { data, error } = await supabase.from(TABLE).insert(payload).select().single()
  if (error) throw error
  return fromRow(data)
}

export async function updateReason(id, patch) {
  const row = {}
  if (patch.label !== undefined) row.label = patch.label
  if (patch.description !== undefined) row.description = patch.description
  if (patch.color !== undefined) row.color = patch.color
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select().single()
  if (error) throw error
  return fromRow(data)
}

export async function setReasonActive(id, isActive) {
  return updateReason(id, { isActive })
}

export async function reorderReasons(orderedIds) {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from(TABLE).update({ sort_order: index + 1 }).eq('id', id)
    )
  )
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `CI=true npx react-scripts test src/services/churn/deactivationReasonService.test.js --watchAll=false`
Expected: PASS.

- [ ] **Step 5: Re-export en `api.js`**

Seguir el patrón del archivo (ver cómo re-exporta `churnService`). Agregar:
```js
export * from './churn/deactivationReasonService'
```
(o el estilo que use el archivo — revisar antes de editar).

- [ ] **Step 6: Commit**

```bash
git add src/services/churn/deactivationReasonService.js src/services/churn/deactivationReasonService.test.js src/services/api.js
git commit -m "feat(churn): deactivationReasonService (CRUD motivos)"
```

---

### Task 3: `churnConstants.js` — etapa Pausa temporal

**Files:**
- Modify: `src/pages/Churn/churnConstants.js`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `STAGES` incluye `{ key: 'temporary_pause', label: 'Pausa temporal', color: '#7c3aed' }` antes de `recovered`. `REASON_CONFIG` estático se elimina (los motivos vienen de DB); mantener `STAGE_LABEL`, `TIER_HEX`, `SCHEDULE_LABEL`, `planSubtitle` intactos.

- [ ] **Step 1: Editar STAGES (insertar antes de recovered)**

```js
export const STAGES = [
  { key: 'new', label: 'Nueva baja', color: '#e11d48' },
  { key: 'contacting', label: 'En seguimiento', color: '#d97706' },
  { key: 'negotiating', label: 'En negociación', color: '#2563eb' },
  { key: 'temporary_pause', label: 'Pausa temporal', color: '#7c3aed' },
  { key: 'recovered', label: 'Recuperado', color: '#059669' },
  { key: 'lost', label: 'Perdido', color: '#94a3b8' }
]
```

- [ ] **Step 2: Eliminar `REASON_CONFIG`**

Borrar el bloque `export const REASON_CONFIG = {...}` (líneas 12-22). Grep para asegurar que ningún import quede colgado (Task 5 reemplaza sus usos):
```bash
grep -rn "REASON_CONFIG" src/
```
Si aparece en `ChurnCard`/`ChurnBoard`, se resuelve en Task 5 (esos archivos pasan a usar el mapa de motivos de DB).

- [ ] **Step 3: Commit** (junto con Task 5 si hay imports colgados; si no, commit solo)

```bash
git add src/pages/Churn/churnConstants.js
git commit -m "feat(churn): etapa temporary_pause en el kanban"
```

---

### Task 4: `DeactivateClientModal` — motivos dinámicos + descripción

**Files:**
- Modify: `src/pages/Clients/DeactivateClientModal.jsx`

**Interfaces:**
- Consumes: `getReasons` de `deactivationReasonService`.
- Produces: exporta lo que hoy exporta (revisar: `DEACTIVATION_REASONS` se elimina; verificar quién lo importa con `grep -rn "DEACTIVATION_REASONS" src/` y limpiar esos usos).

- [ ] **Step 1: Reemplazar el array estático por fetch**

- Eliminar `export const DEACTIVATION_REASONS = [...]`.
- En el componente, `useState([])` para `reasons` y `useEffect` que llama `getReasons()` al montar (motivos activos, ordenados).
- El selector de motivo se llena con `reasons` (value=`key`, label=`label`).

- [ ] **Step 2: Mostrar la descripción del motivo elegido**

Debajo del selector, cuando hay un motivo seleccionado, mostrar su `description` como texto de ayuda (clase tipo `text-sm text-gray-500 mt-1`). Ejemplo:
```jsx
{selectedReason?.description && (
  <p className="mt-1 text-sm text-gray-500">{selectedReason.description}</p>
)}
```
donde `selectedReason = reasons.find(r => r.key === form.reason)`.

- [ ] **Step 3: Verificar imports colgados**

```bash
grep -rn "DEACTIVATION_REASONS" src/
```
Expected: sin resultados (o corregir los que queden — p.ej. si `ClientDetail`/`ClientList` lo importaban para resolver labels, que usen `getReasons` o el label ya persistido).

- [ ] **Step 4: Verificación manual**

Levantar la app, abrir el modal de dar de baja: deben listarse los 7+1 motivos; al elegir uno, aparece su descripción.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Clients/DeactivateClientModal.jsx
git commit -m "feat(clients): motivos de baja dinamicos con descripcion en el modal"
```

---

### Task 5: Kanban — columna, motivos dinámicos, tooltips, botón gestionar

**Files:**
- Modify: `src/pages/Churn/ChurnBoard.jsx`
- Modify: `src/pages/Churn/ChurnColumn.jsx` (si hace falta para la nueva columna — probablemente ya itera `STAGES`)
- Modify: `src/pages/Churn/ChurnCard.jsx` (badge de motivo → tooltip con descripción)

**Interfaces:**
- Consumes: `getReasons` de `deactivationReasonService`; `STAGES` (ya incluye `temporary_pause`).
- Produces: mapa `reasonsByKey` (key → {label, description, color}) pasado a las cards; botón "Gestionar motivos" (solo superadmin) que abre `ReasonsManagerModal` (Task 6).

- [ ] **Step 1: Cargar motivos en ChurnBoard**

- `useState({})` para `reasonsByKey`, `useEffect` que hace `getReasons({ includeInactive: true })` y arma `Object.fromEntries(list.map(r => [r.key, r]))` (incluir inactivos para resolver labels de bajas históricas).
- Verificar que las columnas se rendericen iterando `STAGES` (la nueva columna aparece sola). Si el ancho del board es fijo, ajustar para 6 columnas.

- [ ] **Step 2: Pasar el mapa a las cards y reemplazar `REASON_CONFIG`**

En `ChurnCard`, en vez de `REASON_CONFIG[reason]`, usar el objeto recibido por props `reasonsByKey[reason]` (fallback: `{ label: reason, color: '#94a3b8' }`). El badge:
```jsx
<span
  title={reasonInfo?.description || ''}
  style={{ backgroundColor: (reasonInfo?.color || '#94a3b8') + '22', color: reasonInfo?.color || '#64748b' }}
  className="..."
>
  {reasonInfo?.label || reason}
</span>
```
El `title` da el tooltip nativo con la descripción al hover.

- [ ] **Step 3: Botón "Gestionar motivos" (solo superadmin)**

En el header del board:
```jsx
{hasAccess && user?.role === 'superadmin' && (
  <Button variant="secondary" onClick={() => setManagerOpen(true)}>Gestionar motivos</Button>
)}
```
(usar el patrón real de rol del proyecto: `useAuth()` → `user.role === 'superadmin'`). Renderizar `<ReasonsManagerModal open={managerOpen} onClose={...} onSaved={reloadReasons} />`.

- [ ] **Step 4: Verificación manual**

- La columna "Pausa temporal" aparece antes de "Recuperado".
- Un cliente con motivo `temporary_pause_not_resumed` aparece en esa columna (verificable dando de baja un cliente de prueba con ese motivo, o moviéndolo).
- Los badges muestran los nuevos labels y el tooltip con descripción al hover.
- "Gestionar motivos" solo visible como superadmin.

- [ ] **Step 5: Compilar Tailwind si se agregaron clases**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`

- [ ] **Step 6: Commit**

```bash
git add src/pages/Churn/ChurnBoard.jsx src/pages/Churn/ChurnColumn.jsx src/pages/Churn/ChurnCard.jsx src/pages/Churn/churnConstants.js src/tailwind.output.css
git commit -m "feat(churn): columna Pausa temporal + motivos dinamicos con tooltip"
```

---

### Task 6: `ReasonsManagerModal` — CRUD de motivos (superadmin)

**Files:**
- Create: `src/pages/Churn/ReasonsManagerModal.jsx`

**Interfaces:**
- Consumes: `getReasons`, `createReason`, `updateReason`, `setReasonActive`, `reorderReasons` de `deactivationReasonService`; componentes UI de `src/components/ui/` (`Modal`, `Button`, `Input`).
- Produces: `<ReasonsManagerModal open onClose onSaved />` (default export el componente).

- [ ] **Step 1: Estructura del modal**

- Al abrir: `getReasons({ includeInactive: true })`, ordenar por `sortOrder`.
- Lista: cada motivo con `label`, `description` (visible), swatch de `color`, estado activo/inactivo.
- Acciones por fila: editar (label/description/color inline o sub-form), activar/desactivar. **No** mostrar desactivar/borrar en `isSystem` (death, other, temporary_pause_not_resumed).
- Reordenar: flechas ↑/↓ que llaman `reorderReasons` con el nuevo orden (simple; sin DnD).
- Crear: form al final (label requerido, description, color) → `createReason`, luego recargar.
- Al cerrar / tras guardar: llamar `onSaved()` para que el board recargue el mapa.

- [ ] **Step 2: Gating**

El modal se renderiza solo desde el board para superadmin; igual, defender: si `user.role !== 'superadmin'`, no renderizar acciones de escritura.

- [ ] **Step 3: Verificación manual**

Como superadmin: crear un motivo nuevo (aparece en el selector del modal de baja y en el board), editar label/descripción, desactivar uno no-system (desaparece del selector de nuevas bajas pero sigue resolviendo labels viejos), reordenar.

- [ ] **Step 4: Compilar Tailwind + commit**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
git add src/pages/Churn/ReasonsManagerModal.jsx src/tailwind.output.css
git commit -m "feat(churn): ReasonsManagerModal (CRUD de motivos, superadmin)"
```

---

## Self-Review

- **Cobertura del spec:** tabla+RLS+seed+mapeo+drop CHECK (T1), etapa+RPC auto-provisión (T1+T3), servicio CRUD (T2), modal baja con descripción (T4), columna+tooltips+dynamic reasons+botón (T5), pantalla gestión CRUD (T6). ✅
- **Placeholders:** SQL y servicio con código completo; UI con snippets concretos + verificación manual (patrón del repo: sin tests de componente, sí test de lógica pura en T2). ✅
- **Consistencia de tipos:** Reason camelCase `{id,key,label,description,color,sortOrder,isActive,isSystem}` usado igual en T2/T5/T6; keys de seed = keys del mapeo = key esperado por RPC (`temporary_pause_not_resumed`) y etapa (`temporary_pause`). ✅
- **Riesgo:** confirmar en T3/T4/T5 que no queden imports colgados de `REASON_CONFIG`/`DEACTIVATION_REASONS` (grep incluido). Confirmar el patrón real de rol en el board (`useAuth`).
