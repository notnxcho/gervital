# Reintegro con fecha y plan + modelo de períodos de inactividad

Fecha: 2026-07-23

## Problema

Cuando un cliente dado de baja se reintegra, el flujo actual (`reactivate_client`)
simplemente **borra** `clients.deactivation_date` y los demás campos de baja. No se
guarda ninguna información del período en que el cliente estuvo inactivo.

Consecuencias (bug grave):

1. **Calendario.** `getDayStatus` en `ClientDetail.jsx` deriva la asistencia por fecha:
   cualquier día asignado, pasado, sin registro de asistencia cae al fallback
   `attended` (línea ~953). El único guard que suprimía esto era
   `client.deactivationDate` (línea ~947). Al reintegrar se pone en NULL, así que
   **todos los días asignados entre la baja y hoy se muestran como "asistió"** (verde).
2. **Facturación.** `calculate_month_billing` topea el fin del mes con
   `deactivation_date - 1`. Con `deactivation_date` NULL, los meses del gap vuelven a
   facturarse completos.

Además, hoy el reintegro no permite elegir **fecha** (puede ser retroactiva o futura)
ni **plan** (puede volver con un plan distinto al que tenía).

## Requisitos (confirmados)

- El reintegro debe permitir elegir una **fecha de reintegro**. Puede ser **retroactiva**
  (pasada), hoy, o **futura/programada**. Siempre debe ser posterior a la fecha de baja.
- El reintegro puede ser con **otro plan**. El modal incluye selección de plan,
  **preseleccionado con el plan que tenía el cliente al momento de la baja**.
- Los días entre la baja y el reintegro **no** se cobran ni se marcan como asistidos.
- Cuando el reintegro cae a mitad de mes, ese mes se **prorratea por día** desde la
  fecha de reintegro.

## Enfoque elegido (Approach A)

Un cliente reintegrado **no** es "alguien que nunca se fue": tiene un **gap de
inactividad durable** `[from_date, to_date)` que debe quedar excluido del calendario y
la facturación para siempre, incluso después de volver a estar activo y aunque vuelva a
darse de baja más adelante.

Se introduce una tabla `client_inactivity_periods` como **fuente de verdad de los gaps**.
`clients.deactivation_date` / `deleted_at` se conservan como **caché de estado actual**
denormalizado, para no tocar los ~15 filtros dispersos (`deleted_at IS NULL/NOT NULL`)
en billing, churn, cobranza, dashboard y transporte.

Descartados:
- **B — columna `reactivation_date` sin historial:** solo recuerda el último gap; una
  segunda baja lo pisa y el calendario/billing de gaps pasados se rompe de nuevo.
- **C — segmentos de enrollment derivando estado por fecha en todas partes:**
  conceptualmente más limpio y resuelve la transición futura sin cron, pero reescribe
  ~15 queries. Riesgo/alcance excesivo por ahora.

## Modelo de datos

```
client_inactivity_periods (
  id              uuid PK DEFAULT gen_random_uuid()
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE
  from_date       date NOT NULL        -- primer día inactivo (= corte de baja, semántica exclusiva)
  to_date         date                 -- primer día activo de nuevo (reintegro); NULL = inactivo, sin reintegro
  reason          text                 -- copiado de la baja
  notes           text
  deactivated_by  uuid
  reactivated_by  uuid
  reactivated_at  timestamptz
  created_at      timestamptz NOT NULL DEFAULT now()
)
```

**Regla de inactividad:** un cliente está inactivo el día `D` ⇔ existe un período con
`D >= from_date AND (to_date IS NULL OR D < to_date)`. Misma semántica de corte exclusivo
que `deactivation_date` hoy (último día activo = `from_date - 1`; primer día activo de
nuevo = `to_date`).

Restricciones:
- `CHECK (to_date IS NULL OR to_date > from_date)`.
- Índice único parcial: a lo sumo **un** período abierto (`to_date IS NULL`) por cliente.
- Índice `(client_id, from_date)`.
- RLS: SELECT para todo usuario autenticado (igual que la visibilidad del calendario).
  Escrituras solo vía RPCs `SECURITY DEFINER`.

## Cambios en RPCs

### `deactivate_client(...)`
Comportamiento actual + **INSERT** de un período abierto
`(client_id, from_date = deactivation_date, reason, notes, deactivated_by, to_date = NULL)`.

### `reactivate_client(p_client_id, p_reactivation_date, [p_frequency, p_schedule, p_has_transport, p_assigned_days, p_distance_range])`
Atómico:
1. Cierra el período abierto: `to_date = R`, `reactivated_by`, `reactivated_at = now()`.
2. Si `R <= CURRENT_DATE`: limpia columnas de baja de `clients` + `deleted_at = NULL`
   (activo ya). Si `R > CURRENT_DATE`: deja las columnas de `clients` como están (sigue
   figurando dado de baja); el calendario/billing ya tratan `>= R` como activo por fecha.
3. Si se pasan campos de plan **y difieren del plan vigente**: `set_client_plan_version(
   client, date_trunc('month', R), plan, by)`. Si no difieren, no se crea versión nueva.
4. Recalcula `monthly_invoices` del rango de meses afectado (meses del gap → $0, mes de
   reintegro → prorrateado). Vía `ensure_client_months` + recompute existente.

Nota de firma: `reactivate_client` hoy es `(p_client_id)`. Se agrega una **nueva
sobrecarga** con los parámetros nuevos; se hace `DROP` de la firma vieja para evitar
"function is not unique" (lección de overloads de RPC).

### `apply_due_reactivations()` (nueva, self-heal)
No existe cron. Para cada cliente con `deleted_at IS NOT NULL`, sin período abierto, cuyo
período más reciente tenga `to_date <= CURRENT_DATE`: limpia columnas de baja +
`deleted_at = NULL`. Idempotente. Se invoca barato en la carga de `ChurnBoard` y
`ClientList`.

**Tradeoff aceptado:** el *flag de estado* de un reintegro futuro recién se voltea en la
próxima carga de página posterior a la fecha; pero el **calendario y la facturación son
correctos por fecha de inmediato**.

## Calendario (`ClientDetail.jsx`)

- El guard único `deactDate` en `getDayStatus` (~línea 947) y en el preview de billing
  (~líneas 893–901) se reemplazan por un chequeo de períodos: **si el día cae dentro de
  cualquier período de inactividad → `not_scheduled`** (gris/vacío, como los días
  previos al ingreso). Esto elimina el fallthrough a `attended`.
- Helper puro nuevo `src/services/clients/inactivityPeriods.js` con
  `isInactiveOn(dateStr, periods)` y `dayInAnyPeriod`, con tests unitarios.
- Los períodos vienen de `clients_full` (ver abajo).

## Facturación (`calculate_month_billing`)

Reemplazar el tope `LEAST(deactivation_date - 1, month_end)` (versión vigente en
`031_deterministic_daily_rate.sql`) por exclusión por día: contar los días asignados del
mes **menos** los que caen dentro de cualquier período `[from_date, to_date)` del cliente.
Da prorrateo por día correcto tanto para el mes parcial de la baja como para el mes
parcial del reintegro, y $0 para meses totalmente dentro del gap.

## Vista `clients_full`

- Exponer `inactivityPeriods` (JSON agregado de la tabla) para el calendario.
- Exponer `scheduledReactivationDate` (el `to_date` futuro del período abierto/cerrado
  reciente) para el banner de baja.
- Mantener `deactivationDate`.
- **Re-asertar `ALTER VIEW clients_full SET (security_invoker = on)`** (gotcha conocido:
  `CREATE OR REPLACE VIEW` lo pierde).

## Modal de reintegro (`src/pages/Clients/ReactivateClientModal.jsx`)

Reemplaza los dos `window.confirm` actuales (en `ChurnCardModal` y `ClientDetail`).
- **Fecha**: default hoy; `min = deactivation_date + 1`; futura permitida. Muestra nota si
  la fecha elegida es retroactiva o futura.
- **Plan**: pre-cargado con el plan **vigente a la fecha de baja** (frecuencia, horario,
  días asignados, transporte, rango de distancia) — reutilizando los campos del editor de
  plan existente; el operador puede cambiar cualquiera.
- Confirmar → llama a `reactivate_client` extendido (servicio `reactivateClient`).

## Migración / backfill

- Backfill de períodos abiertos para clientes actualmente dados de baja
  (`deleted_at IS NOT NULL`) desde sus columnas de `clients`
  (`from_date = deactivation_date`, `to_date = NULL`, reason, notes, deactivated_by).
- **Limitación conocida (documentada, fuera de alcance):** los clientes ya reintegrados
  *antes* de esta feature perdieron su gap (nunca se guardó fecha de reintegro) y no se
  pueden reconstruir automáticamente. Mantienen el comportamiento actual hasta corrección
  manual. (Se puede agregar más adelante un "editar período de baja".)

## Testing

- Tests unitarios puros de `inactivityPeriods.js` (isInactiveOn, dayInAnyPeriod):
  día antes de la baja, día en el gap, día en/after reintegro, período abierto, múltiples
  períodos.
- Facturación verificada por el **flujo real** (node runner + auth, no SQL directo) sobre
  una **branch de Supabase**: mes de reintegro prorrateado, mes de gap en $0, cliente con
  dos ciclos baja/reintegro.
- Compilar Tailwind tras clases nuevas del modal; `npm run build`.

## Alcance de despliegue

- El código (frontend + archivos de migración) se commitea y pushea.
- Las migraciones se aplican y verifican primero en una **branch de Supabase**; el merge a
  producción se coordina en una ventana tranquila (no aplicar en pleno alta/baja/reintegro
  ni generación de facturas). Frontend y DB van juntos.
```
