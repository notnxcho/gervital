# Colapso de caja de promociones en Cobranza — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la Cobranza del dashboard atribuya el cash al mes de la fecha de pago (`paid_date`) — colapsando los meses prepagados de una promo en el mes de pago — y muestre un badge `X/Y` de avance de promo por cliente, sin tocar la Facturación (que sigue mensual).

**Architecture:** Enfoque A (todo en SQL). Se modifican dos funciones RPC del dashboard (`get_dashboard_finance_series` para el agregado y `get_month_collection_panel` para el panel por cliente); el frontend solo mapea campos nuevos y pinta el badge + monto. Sin cambio de esquema.

**Tech Stack:** PostgreSQL (Supabase, migración SQL), React 19, `dashboardService`, `CollectionPanel`.

**Spec:** `docs/superpowers/specs/2026-07-08-promo-cash-collapse-design.md`

**Convenciones:** variables/código en inglés, UI en español, sin `;` en JS/JSX. `monthly_invoices.month` es 0-11.

---

## Contexto de datos (verificado en la DB viva)

- `get_dashboard_finance_series(p_from_year, p_from_month, p_to_year, p_to_month)`: serie mensual. CTE `live` (previsto, plan-derived, filtra `client_type='regular'`), CTE `paid` (cobrado snapshot, HOY agrupado por `mi.year, mi.month`), CTE `exp`.
- `get_month_collection_panel(p_year, p_month)`: una fila por cliente activo del mes; incluye `payment_status`, `paid_amount`, `paid_date`, `invoice_*`. Filtra `client_type='regular'`.
- `monthly_invoices` tiene `paid_date date`, `paid_amount numeric`, `discount_percent numeric`, `attendance_chargeable_net/gross`, `transport_chargeable_net/gross`, `year int`, `month int` (0-11).
- Ambas funciones son `SECURITY INVOKER`; se recrean con `CREATE OR REPLACE`.
- Helper de mes atribuido (mes de cobro): `COALESCE(paid_date, make_date(year, month+1, 1))` (month+1 porque `make_date` usa 1-12). Para volver a 0-11: `EXTRACT(MONTH FROM ...)::int - 1`.

---

## Task 1: Migración 051 — atribución de caja por fecha de pago + X/Y de promo

**Files:**
- Create: `supabase/migrations/051_cobranza_cash_by_paid_date.sql`
- Apply: vía `mcp__supabase__apply_migration` (name `cobranza_cash_by_paid_date`)

- [ ] **Step 1: Escribir el archivo de migración**

Contenido exacto de `supabase/migrations/051_cobranza_cash_by_paid_date.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 051_cobranza_cash_by_paid_date.sql
-- Cobranza (cash) se atribuye al mes de paid_date (fallback: mes de la factura si
-- paid_date es NULL). Asi los meses prepagados de una promo (misma fecha) colapsan
-- en el mes de pago. Se recrean:
--   1. get_dashboard_finance_series: CTE `paid` agrupa por el mes atribuido.
--   2. get_month_collection_panel: agrega cash_collected (por mes atribuido) +
--      promo_index/promo_total (X/Y del rango contiguo de descuento) + promo_percent.
-- Facturacion NO cambia. month es 0-11. Ambas SECURITY INVOKER.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_dashboard_finance_series(
  p_from_year integer, p_from_month integer, p_to_year integer, p_to_month integer)
 RETURNS TABLE(year integer, month integer, att_net numeric, att_gross numeric,
   trans_net numeric, trans_gross numeric, paid_att_net numeric, paid_att_gross numeric,
   paid_trans_net numeric, paid_trans_gross numeric, expenses_total numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH bounds AS (
    SELECT p_from_year * 12 + p_from_month AS lo, p_to_year * 12 + p_to_month AS hi
  ),
  months AS (
    SELECT (i / 12) AS year, (i % 12) AS month FROM bounds, generate_series(bounds.lo, bounds.hi) AS i
  ),
  live AS (
    SELECT m.year, m.month,
      COALESCE(SUM((b->>'attendanceChargeableNet')::numeric), 0)   AS att_net,
      COALESCE(SUM((b->>'attendanceChargeableGross')::numeric), 0) AS att_gross,
      COALESCE(SUM((b->>'transportChargeableNet')::numeric), 0)    AS trans_net,
      COALESCE(SUM((b->>'transportChargeableGross')::numeric), 0)  AS trans_gross
    FROM months m
    JOIN clients c ON c.deleted_at IS NULL AND c.client_type = 'regular'
     AND date_trunc('month', c.start_date) <= make_date(m.year, m.month + 1, 1)
    CROSS JOIN LATERAL calculate_month_billing(c.id, m.year, m.month) AS b
    WHERE (b->>'error') IS NULL
    GROUP BY m.year, m.month
  ),
  -- Cobrado atribuido al mes de paid_date (fallback: mes de la factura).
  paid AS (
    SELECT pm.pyear AS year, pm.pmonth AS month,
      COALESCE(SUM(mi.attendance_chargeable_net), 0)   AS paid_att_net,
      COALESCE(SUM(mi.attendance_chargeable_gross), 0) AS paid_att_gross,
      COALESCE(SUM(mi.transport_chargeable_net), 0)    AS paid_trans_net,
      COALESCE(SUM(mi.transport_chargeable_gross), 0)  AS paid_trans_gross
    FROM monthly_invoices mi
    CROSS JOIN LATERAL (
      SELECT EXTRACT(YEAR  FROM COALESCE(mi.paid_date, make_date(mi.year, mi.month + 1, 1)))::int     AS pyear,
             EXTRACT(MONTH FROM COALESCE(mi.paid_date, make_date(mi.year, mi.month + 1, 1)))::int - 1 AS pmonth
    ) pm, bounds
    WHERE mi.payment_status = 'paid'
      AND pm.pyear * 12 + pm.pmonth BETWEEN bounds.lo AND bounds.hi
    GROUP BY pm.pyear, pm.pmonth
  ),
  exp AS (
    SELECT e.year, e.month, COALESCE(SUM(e.amount), 0) AS expenses_total
    FROM expenses e, bounds
    WHERE e.year * 12 + e.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY e.year, e.month
  )
  SELECT m.year, m.month,
    COALESCE(live.att_net, 0), COALESCE(live.att_gross, 0),
    COALESCE(live.trans_net, 0), COALESCE(live.trans_gross, 0),
    COALESCE(paid.paid_att_net, 0), COALESCE(paid.paid_att_gross, 0),
    COALESCE(paid.paid_trans_net, 0), COALESCE(paid.paid_trans_gross, 0),
    COALESCE(exp.expenses_total, 0)
  FROM months m
  LEFT JOIN live ON live.year = m.year AND live.month = m.month
  LEFT JOIN paid ON paid.year = m.year AND paid.month = m.month
  LEFT JOIN exp  ON exp.year  = m.year AND exp.month  = m.month
  ORDER BY 1, 2;
$function$;

GRANT EXECUTE ON FUNCTION get_dashboard_finance_series(INT, INT, INT, INT) TO authenticated;

-- Panel por cliente del mes: + cash_collected (por mes atribuido) + X/Y de promo.
DROP FUNCTION IF EXISTS public.get_month_collection_panel(integer, integer);
CREATE FUNCTION public.get_month_collection_panel(p_year integer, p_month integer)
 RETURNS TABLE(
   client_id uuid,
   attendance_net numeric, attendance_gross numeric,
   transport_net numeric, transport_gross numeric,
   payment_status text, invoice_status text, paid_amount numeric, paid_date date,
   invoice_number text, invoiced_at timestamptz, invoice_date date, invoiced_amount numeric,
   cash_collected numeric, promo_index int, promo_total int, promo_percent numeric
 )
 LANGUAGE sql
 STABLE
AS $function$
  SELECT c.id,
    (b->>'attendanceChargeableNet')::numeric, (b->>'attendanceChargeableGross')::numeric,
    (b->>'transportChargeableNet')::numeric, (b->>'transportChargeableGross')::numeric,
    COALESCE(mi.payment_status, 'pending'), COALESCE(mi.invoice_status, 'pending'),
    mi.paid_amount, mi.paid_date, mi.invoice_number, mi.invoiced_at, mi.invoice_date, mi.chargeable_amount,
    -- cash cobrado del cliente atribuido a (p_year, p_month) por mes de paid_date
    COALESCE((
      SELECT SUM(mi2.paid_amount)
      FROM monthly_invoices mi2
      WHERE mi2.client_id = c.id
        AND mi2.payment_status = 'paid'
        AND EXTRACT(YEAR  FROM COALESCE(mi2.paid_date, make_date(mi2.year, mi2.month + 1, 1)))::int     = p_year
        AND EXTRACT(MONTH FROM COALESCE(mi2.paid_date, make_date(mi2.year, mi2.month + 1, 1)))::int - 1 = p_month
    ), 0) AS cash_collected,
    promo.promo_index,
    promo.promo_total,
    mi.discount_percent AS promo_percent
  FROM clients c
  CROSS JOIN LATERAL calculate_month_billing(c.id, p_year, p_month) AS b
  LEFT JOIN monthly_invoices mi ON mi.client_id = c.id AND mi.year = p_year AND mi.month = p_month
  -- Rango contiguo de descuento (gaps-and-islands) que contiene (p_year, p_month).
  LEFT JOIN LATERAL (
    SELECT (p_year * 12 + p_month) - r.run_start + 1 AS promo_index,
           r.run_end - r.run_start + 1               AS promo_total
    FROM (
      SELECT MIN(g.ord) AS run_start, MAX(g.ord) AS run_end
      FROM (
        SELECT (mi3.year * 12 + mi3.month) AS ord,
               (mi3.year * 12 + mi3.month) - ROW_NUMBER() OVER (ORDER BY mi3.year * 12 + mi3.month) AS grp
        FROM monthly_invoices mi3
        WHERE mi3.client_id = c.id AND COALESCE(mi3.discount_percent, 0) > 0
      ) g
      GROUP BY g.grp
    ) r
    WHERE (p_year * 12 + p_month) BETWEEN r.run_start AND r.run_end
  ) promo ON true
  WHERE date_trunc('month', c.start_date) <= make_date(p_year, p_month + 1, 1)
    AND c.client_type = 'regular'
    AND (b->>'error') IS NULL
    AND (c.deleted_at IS NULL OR (b->>'totalChargeableGross')::numeric > 0);
$function$;

GRANT EXECUTE ON FUNCTION get_month_collection_panel(INT, INT) TO authenticated;
```

- [ ] **Step 2: Aplicar la migración**

Aplicar con `mcp__supabase__apply_migration` (name `cobranza_cash_by_paid_date`, query = contenido del archivo). Cargar tool: ToolSearch "select:mcp__supabase__apply_migration,mcp__supabase__execute_sql". Expected: sin error.

- [ ] **Step 3: Verificar colapso de caja en un cliente de promo prepagada**

Con `mcp__supabase__execute_sql`, buscar un cliente que tenga ≥2 meses con `discount_percent>0` y `payment_status='paid'` con el MISMO `paid_date` (o crear el escenario en un cliente de prueba). Query de diagnóstico:
```sql
SELECT client_id,
       to_char(paid_date,'YYYY-MM') AS paid_month,
       array_agg(year*12+month ORDER BY year*12+month) AS invoice_ords,
       SUM(paid_amount) AS total_cash
FROM monthly_invoices
WHERE payment_status='paid' AND discount_percent>0 AND paid_date IS NOT NULL
GROUP BY client_id, to_char(paid_date,'YYYY-MM')
HAVING count(*) >= 2
LIMIT 5;
```
Para uno de esos clientes, con `paid_date` en (Yp, Mp0) (Mp0 = mes 0-11 de la fecha de pago) y meses de factura Ma, Mb, Mc:
```sql
-- Mes de pago: cash colapsado; badge X/Y
SELECT client_id, cash_collected, promo_index, promo_total, promo_percent
FROM get_month_collection_panel(<Yp>, <Mp0>) WHERE client_id = '<id>';
-- Un mes posterior del rango (no el de pago): cash 0, badge avanzado
SELECT client_id, cash_collected, promo_index, promo_total
FROM get_month_collection_panel(<Yp>, <Mp0 + 1>) WHERE client_id = '<id>';
```
Expected: en el mes de pago, `cash_collected` = suma de los prepagos y `promo_index/promo_total` = posición/largo del rango; en el mes siguiente del rango, `cash_collected = 0` y `promo_index` = anterior+1, mismo `promo_total`. Pegar los outputs.

- [ ] **Step 4: Verificar la serie agregada atribuye por fecha de pago**

```sql
-- Comparar cobrado por mes de factura (viejo) vs por mes de pago (nuevo) en el rango del cliente
SELECT year, month, paid_att_gross + paid_trans_gross AS cobrado_gross
FROM get_dashboard_finance_series(<Yp>, <Mp0>, <Yp>, <Mp0 + 2>)
ORDER BY year, month;
```
Expected: el cobrado se concentra en el mes de `paid_date` (Mp0) y da 0 en los meses siguientes del rango prepagado. Pegar el output.

- [ ] **Step 5: Verificar no-regresión (cliente sin promo, pago normal)**

```sql
-- Un cliente pagado en su propio mes debe verse igual que antes (cash en su mes, sin promo)
SELECT client_id, cash_collected, promo_index, promo_total
FROM get_month_collection_panel(<year>, <month0>)
WHERE payment_status='paid' AND promo_total IS NULL
LIMIT 5;
```
Expected: `cash_collected` = `paid_amount` de su propio mes, `promo_index/promo_total` NULL. Pegar el output.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/051_cobranza_cash_by_paid_date.sql
git commit -m "feat(db): cobranza atribuida por fecha de pago + X/Y de promo (migracion 051)"
```

---

## Task 2: Frontend — mapear campos nuevos y pintar badge + monto colapsado

**Files:**
- Modify: `src/services/dashboard/dashboardService.js` (función `getMonthInvoicePanel`)
- Modify: `src/pages/Dashboard/CollectionPanel.jsx`

- [ ] **Step 1: Mapear los campos nuevos en el service**

En `src/services/dashboard/dashboardService.js`, dentro del `.map(row => ({ ... }))` de `getMonthInvoicePanel` (el objeto que hoy termina en `invoicedAmount: Number(row.invoiced_amount || 0)`), agregar estas cuatro claves:

```javascript
      cashCollected: Number(row.cash_collected || 0),
      promoIndex: row.promo_index != null ? Number(row.promo_index) : null,
      promoTotal: row.promo_total != null ? Number(row.promo_total) : null,
      promoPercent: row.promo_percent != null ? Number(row.promo_percent) : null
```
(Agregar una coma al final de la clave anterior `invoicedAmount: ...` si hace falta para que quede válido.)

- [ ] **Step 2: Usar `cashCollected` como monto de la tab "Cobrados"**

En `src/pages/Dashboard/CollectionPanel.jsx`, la función `rowAmount` hoy es:
```javascript
  const rowAmount = (r) => (tab === 'emitidas' ? r.invoicedAmount : tab === 'cobrados' ? r.paidAmount : r.amount)
```
Cambiar SOLO la rama `cobrados` para usar el cash atribuido al mes:
```javascript
  const rowAmount = (r) => (tab === 'emitidas' ? r.invoicedAmount : tab === 'cobrados' ? r.cashCollected : r.amount)
```
Esto hace que el total del mes (`totalPending = list.reduce((s, r) => s + rowAmount(r), 0)`) y el monto por fila usen el cash colapsado (81.000 en el mes de pago; 0 en los meses posteriores del rango).

- [ ] **Step 3: Pintar el badge de promo en la fila (dominio Cobranza)**

En `CollectionPanel.jsx`, localizar el render de cada fila (donde se muestra el nombre del cliente y `rowAmount(r)`; buscar `formatCurrency(rowAmount(r))`). Agregar, junto al nombre/subtítulo de la fila, un chip que aparezca cuando `r.promoTotal` no es null. Importar un ícono de `iconoir-react` ya usado en el repo (verificá cuál existe; p.ej. `Gift` o `Percentage` o `PriceTag`) y agregar:

```jsx
{r.promoTotal != null && (
  <span
    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700"
    title={`Promoción ${r.promoPercent != null ? r.promoPercent + '% · ' : ''}mes ${r.promoIndex} de ${r.promoTotal}`}
  >
    <PriceTag width={12} height={12} />
    {r.promoIndex}/{r.promoTotal}
  </span>
)}
```
Ubicarlo de forma coherente con el layout existente de la fila (al lado del nombre o del monto). Ajustar el nombre del ícono al que exista realmente en `iconoir-react` (revisá los imports actuales del archivo o de otro componente del dashboard). Mostrar el badge en el dominio Cobranza (tanto en `pagos` como en `cobrados`), NO en Facturación/`emitidas`. Si el render de fila es compartido entre dominios, condicionar el badge además a `domain === 'cobranza'`.

- [ ] **Step 4: Verificar compilación y estilos**

Run:
```bash
npx eslint src/services/dashboard/dashboardService.js src/pages/Dashboard/CollectionPanel.jsx
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
CI=true npm run build 2>&1 | tail -6
```
Expected: eslint limpio; Tailwind sin error; "Compiled successfully."

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboard/dashboardService.js src/pages/Dashboard/CollectionPanel.jsx src/tailwind.output.css
git commit -m "feat(dashboard): cobranza colapsada por fecha de pago + badge de promo X/Y"
```

---

## Task 3: Verificación integral

**Files:** (ninguno — verificación)

- [ ] **Step 1: Suite de tests completa**

Run: `CI=true npx craco test --watchAll=false 2>&1 | tail -15`
Expected: todas las suites pasan (esta feature no agrega tests unitarios; la lógica X/Y y el colapso están en SQL y se verifican por consulta en Task 1).

- [ ] **Step 2: Build de producción**

Run: `CI=true npm run build 2>&1 | tail -6`
Expected: "Compiled successfully."

- [ ] **Step 3: Verificación en la app (admin/superadmin)**

Arrancar (`npm start` o skill `run`). En Dashboard → Finanzas, con un cliente que prepagó una promo de ≥2 meses con la misma fecha:
1. Ir al mes de la fecha de pago → panel Cobranza / tab Cobrados: el cliente aparece con el monto colapsado y badge `1/Y`; "Cobrado del mes" refleja el total.
2. Ir al mes siguiente del rango → el cliente aparece con `$0` y badge `2/Y`.
3. El chart/KPI "Cobrado" muestra el pico en el mes de pago y 0 en los meses posteriores del rango.
4. Dominio Facturación / Emitidas: sigue mensual (montos por mes, sin colapsar).
5. Como operador: el panel financiero sigue gated (sin cambios de acceso).

- [ ] **Step 4: Commit final (si Tailwind cambió y no se commiteó antes)**

```bash
git status --short
# Si src/tailwind.output.css quedó sin commitear:
git add src/tailwind.output.css && git commit -m "chore(dashboard): recompilar tailwind (badge promo)"
```

---

## Notas de riesgo / gotchas

- **Preservar `client_type='regular'`**: ambas funciones filtran clientes no facturables (charity/trial). El SQL de este plan ya lo mantiene — no quitarlo.
- **Ventana de la serie**: el filtro `BETWEEN bounds.lo AND bounds.hi` en la CTE `paid` ahora es sobre el **mes atribuido** (paid_date), no el mes de la factura — correcto para caja.
- **`SECURITY INVOKER`**: ambas funciones se recrean con `CREATE OR REPLACE`/`CREATE` sin `SECURITY DEFINER`; la RLS de `monthly_invoices` (admin/superadmin) sigue aplicando → para operador el panel financiero no expone montos igual que hoy.
- **Edge no cubierto (documentado)**: si un cliente paga SOLO meses futuros dejando el mes en curso impago, la fila del mes en curso tiene `payment_status='pending'` pero `cash_collected>0`; la tab "Cobrados" filtra por `paymentStatus==='paid'` y no la mostraría. Fuera de alcance (el caso real es prepago del rango completo, con el mes en curso pagado). No romper: `cash_collected` igual se computa bien; solo su visibilidad en esa tab queda para un follow-up si aparece.
- **Gaps-and-islands**: el rango de promo se reconstruye por corridas contiguas de `discount_percent>0`; descuentos separados por un mes sin descuento son promos distintas.
```
