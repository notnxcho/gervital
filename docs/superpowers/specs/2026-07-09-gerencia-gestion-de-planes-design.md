# Gerencia — Gestión de planes (precios versionados por mes)

**Fecha:** 2026-07-09
**Estado:** Diseño aprobado (pendiente revisión de spec)

## Objetivo

Renombrar la sección "Accesos" a **Gerencia** y agregar dentro una segunda pestaña,
**Gestión de planes**, donde el superadmin ve y edita los precios de planes de asistencia y
de transporte (con y sin IVA). La edición se aplica desde un **mes de vigencia** elegible
(mes actual por defecto; solo mes actual o futuros). El cambio es de escritura inmediata
(no es un job programado): se persiste una nueva versión de precios efectiva desde ese mes.
Los meses ya **cobrados o facturados** conservan su precio (no se actualizan).

## Decisiones tomadas (brainstorming)

1. **Versionado por mes**: el precio nuevo rige desde el mes elegido en adelante; meses
   anteriores mantienen el precio viejo; meses cobrados/facturados usan su snapshot.
2. **Ingreso con IVA**: el usuario escribe el precio con IVA (gross); el neto se calcula
   `ROUND(gross / 1.22)`.
3. **Editar toda la tabla a la vez** con un único mes de vigencia por guardado.
4. **Solo superadmin** puede ver/usar la vista Gerencia (feature `users`).
5. Selector de vigencia: dropdown de **mes actual + próximos 12 meses**.

## Contexto de código relevante

- `plan_pricing` y `transport_pricing` hoy son **planos** (sin dimensión temporal):
  - `plan_pricing(frequency 1..5, schedule, price_net, price_gross)`, `UNIQUE(frequency, schedule)`.
  - `transport_pricing(frequency 1..5, distance_range, price_net, price_gross)`, `UNIQUE(frequency, distance_range)`.
- Lectura de precios:
  - **Backend**: `calculate_month_billing(p_client_id, p_year, p_month)` (RPC, migración 015)
    hace `SELECT price_net, price_gross FROM plan_pricing WHERE frequency=... AND schedule=...`
    e idéntico para transporte. Se usa en emisión y en `mark_month_paid`.
  - **Frontend (preview live)**: `getPlanPricing()` / `getTransportPricing()` traen la tabla plana;
    `getPlanPriceSync(data, freq, schedule)` / `getTransportPriceSync(data, freq, distance)` resuelven.
    Call-sites: `ClientDetail.jsx` (MonthCard, tiene year/month), `AddClient.jsx`, `PlanCalculatorModal.jsx`.
- Snapshot de meses finalizados:
  - Mes **pago**: `ClientDetail` muestra `invoice.paidAmount ?? invoice.chargeableAmount` (snapshot, no live).
  - Mes **facturado no pago**: hoy `ClientDetail` recalcula **live** (`liveChargeableAmount`). ← se ajusta.
- RLS actual de `plan_pricing`/`transport_pricing` (migración 015): `USING(true)` para cualquier
  authenticated tanto en SELECT como en modificación.
- `Tabs` (`src/components/ui/Tabs.jsx`): API `{ tabs:[{id,label}], activeTab, onChange }`.
- Ruta actual: `<Route element={<RequireRole feature="users" />}><Route path="accesos" element={<AccessList/>}/></Route>`.

## Diseño

### 1. Navegación y estructura

- `Navbar.jsx`: ítem `{ to: '/accesos', label: 'Accesos', icon: Settings }` →
  `{ to: '/gerencia', label: 'Gerencia', icon: Settings }` (mismo icono, mismo `access: 'users'`).
- `App.js`: renombrar la ruta protegida `accesos` → `gerencia`, `element={<Gerencia/>}`.
- Nueva página `src/pages/Management/Gerencia.jsx`:
  - Usa `Tabs` con `[{id:'accesos', label:'Accesos'}, {id:'planes', label:'Gestión de planes'}]`.
  - Estado local `activeTab` (default `'accesos'`).
  - Renderiza `<AccessList/>` (tab accesos) o `<PlanPricingManager/>` (tab planes).
- `AccessList` se mantiene tal cual (se importa dentro de la nueva página). Su `<h1>Accesos</h1>`
  interno se conserva o se simplifica; no es bloqueante.

### 2. Migración SQL — versionado por mes de vigencia

Nueva migración `055_versioned_pricing.sql`:

- Agregar a `plan_pricing` y `transport_pricing`:
  - `effective_year INTEGER NOT NULL DEFAULT 2000`
  - `effective_month INTEGER NOT NULL DEFAULT 0` (0-indexed, como `monthly_invoices`)
- Backfill: filas existentes quedan en `(2000, 0)` (aplican a todo mes histórico).
- Reemplazar constraints UNIQUE:
  - `plan_pricing`: `UNIQUE(frequency, schedule, effective_year, effective_month)`.
  - `transport_pricing`: `UNIQUE(frequency, distance_range, effective_year, effective_month)`.
- Regla de resolución: "precio para el mes objetivo M" = la fila de cada combinación con
  `(effective_year, effective_month)` **máximo que sea ≤ M**, comparando por
  `effective_year*12 + effective_month`.
- RLS: mantener SELECT para authenticated; restringir INSERT/UPDATE/DELETE a superadmin
  (reusar helper `is_admin_or_superadmin()`? No — se requiere superadmin estricto; usar chequeo
  de rol superadmin, consistente con feature `users`). El RPC de escritura además valida rol.

### 3. RPC de escritura — `set_pricing`

```
set_pricing(
  p_effective_year INTEGER,
  p_effective_month INTEGER,       -- 0-indexed
  p_plan_prices JSONB,             -- [{frequency, schedule, price_gross}]
  p_transport_prices JSONB         -- [{frequency, distance_range, price_gross}]
) RETURNS JSONB
```

- `SECURITY DEFINER`. Verifica que el llamador sea **superadmin** (si no, `RETURN {success:false, error:...}`).
- Valida que `(p_effective_year, p_effective_month)` no sea anterior al mes actual del servidor.
- Por cada item: `net = ROUND(gross / 1.22)`; `INSERT ... ON CONFLICT (frequency, schedule,
  effective_year, effective_month) DO UPDATE SET price_gross, price_net, updated_at`.
  (idempotente: re-guardar el mismo mes pisa esa versión, no crea duplicados.)
- Devuelve `{success:true}` o `{success:false, error}`.

### 4. Lectura versionada en billing

- `calculate_month_billing`: cambiar los dos `SELECT` de precio para elegir la versión vigente
  del mes `(p_year, p_month)`:
  ```
  SELECT price_net, price_gross INTO ...
  FROM plan_pricing
  WHERE frequency = v_plan.frequency AND schedule = v_plan.schedule
    AND (effective_year*12 + effective_month) <= (p_year*12 + p_month)
  ORDER BY (effective_year*12 + effective_month) DESC
  LIMIT 1;
  ```
  (análogo para `transport_pricing`.) El mensaje de error "precio no encontrado" se mantiene si
  no hay ninguna versión ≤ mes.

### 5. Lectura versionada en el frontend (preview live)

- `getPlanPricing()` / `getTransportPricing()`: agregar `effective_year`, `effective_month` al
  SELECT y al objeto mapeado (`effectiveYear`, `effectiveMonth`). Devuelven **todas las versiones**.
- `getPlanPriceSync(data, freq, schedule, year, month)` y
  `getTransportPriceSync(data, freq, distanceRange, year, month)`: filtran por combinación,
  eligen la versión con `effYm` máximo `≤ year*12+month`. Si se llama sin `year/month`
  (retrocompat de call-sites que aún no lo pasen), usar el mes actual como default.
- Actualizar call-sites:
  - `ClientDetail.jsx` MonthCard: pasar `year, month` del card.
  - `AddClient.jsx`: pasar el mes de cada mes calculado (o mes actual para el preview mensual).
  - `PlanCalculatorModal.jsx`: pasar el mes calculado.

### 6. Regla "no se actualiza si ya está cobrado/facturado"

- Sale del snapshot + un ajuste en `ClientDetail` MonthCard:
  - Hoy: `displayAmount = isPaid ? snapshot : liveChargeableAmount`.
  - Nuevo: `const isFinalized = isPaid || isInvoiced;`
    `displayAmount = isFinalized ? snapshotAmount : liveChargeableAmount`.
  - `snapshotAmount` para pago = `invoice.paidAmount ?? invoice.chargeableAmount`;
    para facturado-no-pago = `invoice.chargeableAmount` (snapshot de emisión, migración 023).
- Resultado: editar el precio del mes corriente actualiza solo a clientes **pendientes** de ese mes;
  los ya cobrados/facturados quedan intactos. Meses futuros toman la versión correspondiente.

### 7. UI — `PlanPricingManager.jsx`

- Carga `getPlanPricing()` + `getTransportPricing()`; resuelve la versión vigente del **mes actual**
  para mostrar por defecto.
- Dos tablas:
  - **Planes de asistencia**: filas = frecuencia (1..5), columnas por horario (mañana / tarde /
    día completo), cada celda muestra precio con IVA y (chico, gris) sin IVA.
  - **Transporte**: filas = frecuencia, columnas por rango de distancia (0–2 / 2–5 / 5–10 km).
- Botón **Editar**: convierte celdas en inputs (se ingresa **con IVA**; el sin IVA se recalcula
  en vivo `round(gross/1.22)` para feedback). Aparece:
  - Selector **Mes de vigencia** (dropdown mes actual + próximos 12; default mes actual).
  - Botones **Guardar** (llama `setPricing(...)`) y **Cancelar**.
- Al guardar con éxito: recargar precios y salir de modo edición. Mostrar error inline si falla.
- Nota de contexto visible: "Rige desde <mes vigencia>. Los meses ya cobrados o facturados no cambian."

### 8. Servicio de escritura

- `pricingService.js`: `setPricing(effectiveYear, effectiveMonth, planPrices, transportPrices)`
  que invoca `supabase.rpc('set_pricing', {...})`. Re-export desde `api.js`.

## Archivos afectados

**Nuevos**
- `supabase/migrations/055_versioned_pricing.sql`
- `src/pages/Management/Gerencia.jsx`
- `src/pages/Management/PlanPricingManager.jsx`

**Modificados**
- `src/components/Layout/Navbar.jsx` (label + ruta)
- `src/App.js` (ruta `gerencia`)
- `src/services/pricing/pricingService.js` (versiones + `getPlanPriceSync` con mes + `setPricing`)
- `src/services/pricing/transportPricingService.js` (versiones + `getTransportPriceSync` con mes)
- `src/services/api.js` (re-export `setPricing`)
- `src/pages/Clients/ClientDetail.jsx` (pasar year/month a `*PriceSync`; `isFinalized` para displayAmount)
- `src/pages/Clients/AddClient.jsx` (pasar mes a `*PriceSync`)
- `src/pages/Clients/PlanCalculatorModal.jsx` (pasar mes a `*PriceSync`)

## Verificación

- Migración: aplicar; verificar backfill `(2000,0)` y que `calculate_month_billing` de un mes
  cualquiera devuelve los mismos montos que antes (sin edición nueva).
- Editar precios con vigencia mes actual → cliente **pendiente** del mes ve el precio nuevo;
  cliente **pago/facturado** del mes NO cambia; meses pasados no cambian.
- Editar con vigencia mes futuro → meses anteriores al elegido no cambian; desde el mes elegido, sí.
- Re-guardar el mismo mes → pisa la versión (sin duplicar filas).
- Permisos: usuario no-superadmin no ve Gerencia; `set_pricing` rechaza si no es superadmin.
- Compilar Tailwind si hay clases nuevas: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.

## Fuera de alcance (YAGNI)

- Historial/timeline visual de versiones de precio.
- Editar precios por fila individual o con vigencias distintas por celda.
- Edición de neto a mano.
- Programación diferida real (cron): la escritura es inmediata con semántica "efectivo desde".
