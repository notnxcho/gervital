# Cambios de plan no retroactivos — Diseño

**Fecha:** 2026-06-04
**Estado:** Aprobado (pendiente de revisión final del spec)

## Problema

Cuando un cliente cambia su plan (frecuencia, turno, transporte, días asignados o
distancia), el cambio se refleja **retroactivamente** en su asistencia y facturación.

### Causa raíz (arquitectónica)

El plan vive como **una sola fila por cliente** en `client_plans`
(`frequency`, `schedule`, `has_transport`, `assigned_days`), **sin fecha de vigencia
ni historial**. Todo se deriva en vivo de ese plan actual:

1. **Facturación** — `calculate_month_billing(client, year, month)` recorre los días de
   *cualquier* mes y consulta `assigned_days` / `frequency` / `schedule` del plan
   **actual**. No hay snapshot por mes.
2. **Calendario** — `ClientDetail.jsx` (~líneas 656-707) deriva los "días asignados /
   planificados" y el turno de cada mes desde el `assignedDays` **actual**.
3. **Transporte** — la tarifa usa `frequency` (del plan) + `distance_range` (de
   `client_addresses`), ambos valores actuales.

Consecuencia: al editar el plan se recalculan **todos los meses no pagados** (incluido el
pasado). Los meses pagados quedan congelados porque `mark_month_paid` snapshotea los
montos en columnas de `monthly_invoices`.

## Objetivo

Que un cambio de plan rija **solo hacia adelante** desde un mes elegible, sin afectar
meses anteriores. El plan debe volverse **consciente del tiempo**.

## Decisiones de producto

| Decisión | Valor |
|---|---|
| Granularidad de vigencia | Por **mes** (siempre 1° de mes) |
| Fecha de vigencia al editar | **Elegible**, default = **mes en curso** |
| Piso de la fecha de vigencia | **Primer mes no pagado** (los pagados se protegen) |
| Historial de planes | **Visible** en la UI del detalle del cliente |
| Alcance del versionado | Plan **+ distancia** (`distance_range`) |

## Enfoque elegido: plan versionado por vigencia

`client_plans` pasa de "una fila por cliente" a **una fila por período de vigencia**.
Mantiene la arquitectura de cálculo en vivo, solo la hace consciente del tiempo. El
historial sale gratis (es la propia tabla). Fuente única de verdad: el "plan vigente hoy"
se resuelve con la versión efectiva del mes actual mediante un join — sin columna espejo
ni job de rollover.

Alternativas descartadas:
- **Snapshot del plan en `monthly_invoices`**: historial implícito y difícil de mostrar;
  reglas de snapshot poco claras; más bolt-on.
- **`client_plans` actual + tabla de overrides**: más piezas, sin ventaja sobre el
  versionado.

## 1. Modelo de datos

`client_plans` (versionado):

```
client_plans
├─ id              uuid
├─ client_id       uuid  (FK clients)
├─ effective_from  date  ← 1° del mes desde que rige        [NUEVO]
├─ frequency       int
├─ schedule        text
├─ has_transport   bool
├─ assigned_days   text[]
├─ distance_range  text  ← snapshot de la distancia         [NUEVO]
├─ created_at      timestamptz
├─ created_by      text  (opcional, ya existe el patrón)
└─ UNIQUE (client_id, effective_from)   ← reemplaza UNIQUE(client_id)
```

- `distance_range` se **copia** desde `client_addresses` al crear cada versión. La
  dirección conserva su valor actual (para el form de domicilio); al cambiar, dispara una
  nueva versión.
- Índice: `(client_id, effective_from DESC)`.
- `effective_from NOT NULL` (tras backfill).

## 2. Resolución (qué plan aplica)

- **Plan de un mes M** = versión con `effective_from` máximo ≤ primer día de M.
- **"Plan vigente hoy"** (cards / listas / `clients_full`) = versión efectiva para el mes
  actual, resuelta por join lateral (sin espejo).

Como la vigencia es por mes, cada mes mapea a **exactamente una** versión → sin mezcla
intra-mes; la facturación sigue siendo mensual limpia.

## Invariante de proración (mes de ingreso)

La proración *dentro de un mes* se rige por `client.start_date` y **solo** aplica al mes
de ingreso. Los días asignados en/después del ingreso cuentan, **inclusive el día de
ingreso**.

- Ej.: 1×/sem jueves, alta el **primer jueves** → `full_month_days = 4`,
  `planned_days = 4` → factor 1.0 → **cobro completo**.
- Ej.: alta el 3° jueves → `planned = 2` de 4 → cobra la mitad.

El `effective_from` de la versión **solo decide qué versión aplica a cada mes**; **nunca
prorratea**. Como las versiones siempre arrancan el 1° de mes, **ningún cambio de plan
prorratea** — el único mes que prorratea es el de ingreso. La proración debe seguir
usando `start_date`, no `effective_from`.

## 3. Facturación — `calculate_month_billing`

Cambio de fondo: resolver la **versión del mes objetivo** en lugar del plan único.

```sql
SELECT * INTO v_plan
FROM client_plans
WHERE client_id = p_client_id
  AND effective_from <= make_date(p_year, p_month + 1, 1)   -- month es 0-indexed
ORDER BY effective_from DESC
LIMIT 1;
```

- El transporte usa **`v_plan.distance_range`** (snapshot de la versión), no
  `client_addresses`. `transport_pricing` se busca con `v_plan.frequency +
  v_plan.distance_range`.
- La lógica de proración por `start_date` queda **igual**.
- Guarda: si no hay versión para ese mes, devuelve "sin plan" (no debería ocurrir, porque
  la versión 1 arranca el mes de ingreso).

## 4. Calendario — `ClientDetail.jsx`

- Cargar la lista de versiones del cliente una vez; helper `getPlanForMonth(year, month)`
  devuelve la versión aplicable.
- Los días asignados / turno / proración de cada mes mostrado usan esa versión, no el
  plan "actual".
- Verificar que el conteo del **día de ingreso** sea **inclusivo** igual que el backend.
- `clients_full` devuelve el **plan vigente hoy** (cards/listas). `ClientDetail` además
  trae la lista completa vía nuevo `getClientPlanVersions(clientId)`.

## 5. Edición + fecha de vigencia

- El form de plan suma un **selector de mes de vigencia**: default = mes en curso, piso =
  primer mes no pagado (no deja elegir antes).
- Cualquier cambio en `{frequency, schedule, has_transport, assigned_days,
  distance_range}` crea/actualiza una versión en el mes elegido, snapshoteando los 5
  campos. Un único selector gobierna el guardado.
- Backend:
  - Nuevo RPC `set_client_plan_version(p_client_id, p_effective_from, p_frequency,
    p_schedule, p_has_transport, p_assigned_days, p_distance_range, p_created_by)` con
    `ON CONFLICT (client_id, effective_from) DO UPDATE` (re-editar el mismo mes pisa la
    versión).
  - `update_client_full` **deja de tocar el plan**: maneja solo datos personales,
    contacto, médicos y dirección (incluida la distancia "actual" del address).
  - `create_client_full` crea la **versión 1** con `effective_from = date_trunc('month',
    start_date)` y `distance_range` de la dirección.

## 6. Historial en UI

- Sección en el detalle del cliente que lista las versiones: mes de vigencia, frecuencia,
  turno, transporte, días asignados, distancia (solo lectura).
- **Nice-to-have (fuera del alcance base):** eliminar una versión futura aún no vigente
  para cancelar un cambio programado.

## 7. Migración (021)

`021_versioned_client_plans.sql`:

1. `ALTER TABLE client_plans ADD COLUMN effective_from date`, `ADD COLUMN distance_range
   text`.
2. Backfill:
   - `effective_from = date_trunc('month', c.start_date)` desde `clients c`.
   - `distance_range = a.distance_range` desde `client_addresses a`.
   (Hoy no hay clientes → no-op, pero queda correcto.)
3. `effective_from SET NOT NULL`.
4. Drop `UNIQUE(client_id)`; add `UNIQUE(client_id, effective_from)`; index
   `(client_id, effective_from DESC)`.
5. Redefinir: `calculate_month_billing`, vista `clients_full`, `create_client_full`,
   `update_client_full`; crear `set_client_plan_version`.

Verificar advisors de Supabase (RLS/security) tras los cambios de vista/funciones, y que
`clients_full` mantenga el comportamiento de seguridad existente.

## 8. Casos borde

- **Meses pagados**: nunca se recalculan (congelados en `monthly_invoices`); la versión
  solo se usa para mostrar.
- **Piso de vigencia**: la UI impide elegir un mes ≤ último mes pagado.
- **Día asignado eliminado con registro previo** (vacación/recupero) en un mes futuro
  afectado: raro; el registro persiste aunque el día deje de ser "asignado". Aceptable
  (posible warning futuro).
- **`has_transport = false`** en una versión → ese mes no cobra transporte aunque la
  dirección tenga distancia.

## Fuera de alcance

- Eliminación/edición avanzada de versiones desde la UI (más allá del nice-to-have).
- Cambios intra-mes (la vigencia es siempre a 1° de mes por diseño).
