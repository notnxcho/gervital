# Motivos de baja gestionables + columna "Pausa temporal"

**Fecha:** 2026-07-08
**Estado:** Aprobado

## Contexto

El módulo de Bajas (ruta `/bajas`, código en `src/pages/Churn/`) es un tablero kanban
donde las **columnas son etapas** del pipeline de recuperación. Los **motivos de baja**
(por qué se fue el cliente) hoy son un set fijo de 8 valores hardcodeados y duplicados en
3 lugares, sin descripción:

- `src/pages/Clients/DeactivateClientModal.jsx` → `DEACTIVATION_REASONS`
- `src/pages/Churn/churnConstants.js` → `REASON_CONFIG` (labels + colores)
- CHECK constraint en `supabase/migrations/016_client_soft_delete.sql`

El motivo se guarda como texto en `clients.deactivation_reason` y se snapshotea en
`churn_followups.reason` (text, sin CHECK). Etapas actuales (`STAGES` en `churnConstants.js`,
enforced por CHECK en `churn_followups.stage`): `new`, `contacting`, `negotiating`,
`recovered`, `lost`.

## Objetivo

1. Convertir los motivos de baja en **datos gestionables** (crear / editar / activar-desactivar)
   desde una pantalla, cada uno con **descripción visible en tooltip**.
2. Reemplazar los 8 motivos actuales por los **7 estandarizados** (+ "Pausa temporal no
   retomada" como 8º), migrando los datos existentes.
3. Agregar **"Pausa temporal no retomada"** como **columna del kanban Y motivo de baja**.

## Decisiones tomadas

- **Modelo:** slug estable (no FK uuid). Se mantiene `deactivation_reason`/`reason` como texto (key).
- **Pausa temporal:** es motivo **y** etapa.
- **Orden columnas:** `Nueva baja → En seguimiento → En negociación → Pausa temporal → Recuperado → Perdido`.
- **Color columna Pausa temporal:** violeta `#7c3aed`.
- **Pantalla de gestión:** modal "Gestionar motivos" desde el tablero `/bajas` (no se agrega ítem al nav).
- **Permisos:** gestionar motivos = **superadmin**; leer/usar = todos los roles.
- **Borrado:** soft-delete (`is_active=false`). Motivos `is_system` (death, other, pausa) no borrables.
- **Datos existentes:** hay 5 clientes dados de baja (`other` x2, `health_decline` x2,
  `transfer_to_other_center` x1). Se migran por mapeo.

## Modelo de datos

Nueva tabla `deactivation_reasons`:

```sql
CREATE TABLE deactivation_reasons (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         text NOT NULL UNIQUE,          -- slug estable
  label       text NOT NULL,                 -- nombre visible
  description text,                          -- texto del tooltip
  color       text NOT NULL DEFAULT '#64748b',
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true, -- soft-delete
  is_system   boolean NOT NULL DEFAULT false,-- no borrable (protege RPC + fallback)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

- Trigger `updated_at` con la función global existente `update_updated_at_column()`
  (patrón de migración 037/038).
- RLS: SELECT para autenticados (`USING (true)`); INSERT/UPDATE/DELETE con
  `is_superadmin()` (helper existente de migración 003).
- `deactivation_reasons_key` sirve como conjunto de valores válidos → se **elimina** el
  CHECK `clients_deactivation_reason_check` de la migración 016. No se agrega FK dura para
  no romper snapshots históricos si un motivo se desactiva.

### Seed (8 motivos)

| sort | key | label | is_system | description |
|---|---|---|---|---|
| 1 | `death` | Fallecimiento | ✅ | Fallecimiento del usuario. |
| 2 | `institutionalization` | Institucionalización | | El usuario pasa a un residencial o cuidado permanente fuera del hogar. |
| 3 | `health_decline` | Deterioro de salud | | Agrupa tanto el evento agudo (fractura, cirugía, internación) como el deterioro progresivo. |
| 4 | `adaptation_motivation` | Adaptación / motivación | | Dificultad de adaptación al grupo/centro y motivos anímicos. Depresión, angustia, desgano o rechazo a participar, sin que medie necesariamente una causa médica aguda. |
| 5 | `financial` | Motivo económico | | La familia no puede sostener el costo. |
| 6 | `logistical_family` | Motivo logístico-familiar | | Viajes, mudanzas, conflictos de agenda laboral o de quien traslada al usuario, pausas "de vacaciones" que nunca se retoman. |
| 7 | `temporary_pause_not_resumed` | Pausa temporal no retomada | ✅ | El usuario o su familia avisa que se ausentará por un período determinado (vacaciones, viaje, un mes puntual) con intención declarada de volver en una fecha específica, pero luego no se reintegra ni comunica un motivo concreto de baja. |
| 8 | `other` | Otro / sin especificar | ✅ | Motivo no contemplado o sin especificar. |

Colores sugeridos (reutilizar de `REASON_CONFIG` donde exista, elegir para los nuevos).

### Mapeo de datos viejos → nuevos (migración)

Aplicar sobre `clients.deactivation_reason` y `churn_followups.reason`:

| viejo | nuevo |
|---|---|
| `death` | `death` (sin cambio) |
| `transfer_to_other_center` | `institutionalization` |
| `relocation` | `logistical_family` |
| `health_decline` | `health_decline` (sin cambio) |
| `family_decision` | `other` |
| `financial` | `financial` (sin cambio) |
| `service_dissatisfaction` | `adaptation_motivation` |
| `other` | `other` (sin cambio) |

(En datos reales solo cambia `transfer_to_other_center`→`institutionalization`, 1 fila.)

## Etapas del kanban

- Agregar `temporary_pause` a `STAGES` en `churnConstants.js`, ubicada **antes de `recovered`**:
  `new → contacting → negotiating → temporary_pause → recovered → lost`.
  Label "Pausa temporal", color `#7c3aed`.
- Actualizar el CHECK de `churn_followups.stage` para incluir `temporary_pause`.
- **Auto-provisión** en el RPC `get_churn_board`: un cliente con
  `reason = temporary_pause_not_resumed` aterriza en la etapa `temporary_pause`
  (extensión de la lógica actual `death → lost`, resto `→ new`).
- El drag&drop a `temporary_pause` no tiene lógica especial (a diferencia de `recovered`,
  que reactiva). Es una etapa más.

## Capa de servicio

Nuevo `src/services/churn/deactivationReasonService.js`:

- `getReasons({ includeInactive = false })` → lista ordenada por `sort_order`.
- `createReason({ key?, label, description, color, sortOrder })` → si no viene `key`, se
  genera slug desde `label`. Devuelve la fila creada.
- `updateReason(id, patch)` → label/description/color/sortOrder/isActive.
- `setReasonActive(id, isActive)` → soft delete / restaurar.
- `reorderReasons(orderedIds)` → actualiza `sort_order`.

Mapear snake_case → camelCase igual que el resto de servicios. Exponer desde `api.js`
si el patrón lo requiere.

## UI

### 1. DeactivateClientModal

- Reemplazar `DEACTIVATION_REASONS` estático por fetch de motivos activos
  (`getReasons()`), ordenados por `sort_order`.
- Al elegir un motivo, mostrar su **descripción** como texto de ayuda debajo del selector.
- Ícono info por opción / tooltip donde sea razonable.

### 2. ChurnBoard / ChurnColumn / ChurnCard

- `ChurnBoard`: agregar la columna `temporary_pause` en el orden definido; cargar el mapa
  de motivos (key → {label, description, color}) para resolver labels/colores/tooltips
  (en vez de leer `REASON_CONFIG` estático).
- `ChurnCard`: el badge de motivo muestra la **descripción en tooltip** al hover
  (atributo `title` o tooltip existente).
- Botón **"Gestionar motivos"** (visible solo a superadmin) que abre `ReasonsManagerModal`.

### 3. ReasonsManagerModal (nuevo, `src/pages/Churn/ReasonsManagerModal.jsx`)

- Lista de motivos (activos + inactivos) con label, descripción, color, estado.
- Crear motivo (label, descripción, color).
- Editar label/descripción/color.
- Activar/desactivar (soft delete). Los `is_system` no muestran acción de borrar.
- Reordenar (drag o flechas — simple; flechas si es más barato).
- Solo superadmin (gating con `hasAccess`/rol).

## Archivos afectados

- **Nuevo:** `supabase/migrations/044_deactivation_reasons.sql`
- **Nuevo:** `src/services/churn/deactivationReasonService.js`
- **Nuevo:** `src/pages/Churn/ReasonsManagerModal.jsx`
- **Modificar:** `src/pages/Churn/churnConstants.js` (STAGES + quitar/derivar REASON_CONFIG)
- **Modificar:** `src/pages/Churn/ChurnBoard.jsx`, `ChurnColumn.jsx`, `ChurnCard.jsx`
- **Modificar:** `src/pages/Clients/DeactivateClientModal.jsx`
- **Modificar (RPC):** `get_churn_board` (auto-provisión pausa) — dentro de la migración nueva.
- **Modificar:** `src/services/api.js` si re-exporta servicios.

## Testing / verificación

- Migración aplica sin error; seed presente; datos viejos mapeados (verificar
  `transfer_to_other_center` desaparece).
- Tablero muestra la columna Pausa temporal en el orden correcto; cliente con reason pausa
  cae ahí.
- DeactivateClientModal lista los 7+1 motivos con descripción visible.
- CRUD de motivos funciona (crear/editar/desactivar) solo para superadmin; operador/admin
  no ven "Gestionar motivos".
- Badges de motivo en las cards muestran label correcto y tooltip con descripción.
- Compilar Tailwind si hubo clases nuevas.

## Fuera de alcance (YAGNI)

- No se convierten las **etapas** en gestionables (siguen en código).
- No se agrega FK dura ni se normaliza a `reason_id`.
- No se agrega ítem al nav ni ruta dedicada para gestión de motivos.
