# Dashboard Redesign v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard` from scratch with a month-over-month Ingresos vs Gastos hero chart and a 5-card KPI row (both fully built), plus styled placeholder cards reserving the layout below for facturación/cobranza, turnos, and transporte.

**Architecture:** A SQL RPC aggregates persisted invoice/expense data per month; a JS service merges in client-side-computed monthly salaries; pure selector/KPI functions derive what the UI shows based on toggles (Previsto/Cobrado, con/sin IVA, series on/off). The chart is pure SVG/CSS (no new dependency). Financial regions are gated to superadmin via `hasAccess('dashboard_financials')`.

**Tech Stack:** React 19, Supabase (Postgres RPC), date-fns, Tailwind (manual compile), Jest via `craco test`.

**Spec:** `docs/superpowers/specs/2026-06-13-dashboard-redesign-design.md`

**Decisions locked from spec §7:**
- Expenses have no net/gross split → treated as-stored; IVA toggle affects income only (tooltip note).
- Charting = pure SVG/CSS, no new lib.
- Salaries computed client-side; historical months approximate roster (no termination modeling).
- Non-superadmin: financial regions hidden, placeholders shown; routing unchanged.
- Currency = UYU (Uruguayan pesos).

---

## File Structure

**Create:**
- `supabase/migrations/027_dashboard_finance_series.sql` — monthly aggregation RPC
- `src/services/dashboard/financeSeries.js` — pure functions: salary monthlyization, series merge, selectors, KPI derivation
- `src/services/dashboard/financeSeries.test.js` — unit tests for the above
- `src/services/dashboard/format.js` — currency + compact-number formatting (UYU)
- `src/services/dashboard/format.test.js` — unit tests for formatting
- `src/pages/Dashboard/MonthlyFinanceChart.jsx` — hero chart with controls (SVG/CSS)
- `src/pages/Dashboard/KpiRow.jsx` — 5 KPI cards with deltas
- `src/pages/Dashboard/PlaceholderCard.jsx` — reusable placeholder card

**Modify:**
- `src/services/dashboard/dashboardService.js` — add `getDashboardFinanceSeries`
- `src/pages/Dashboard/Dashboard.jsx` — rebuild composition (header + hero + KPIs + placeholders)

**Note on `getDashboardMetrics`:** the existing function and its consumers in the old Dashboard are replaced. Leave `getDashboardMetrics` exported (harmless) but the new Dashboard will not call it. Do not delete it in this plan.

---

## Task 1: SQL RPC — monthly finance series

**Files:**
- Create: `supabase/migrations/027_dashboard_finance_series.sql`

Aggregates `monthly_invoices` (income, persisted net/gross/transport split + paid) and `expenses` (devengado) per `(year, month)` over an inclusive range. `month` is 0-indexed in both tables. Function is SECURITY INVOKER (default) so existing RLS on `monthly_invoices` keeps operadores at 0 rows.

- [ ] **Step 1: Confirm 027 is the next migration number**

Run: `ls supabase/migrations/ | sort | tail -3`
Expected: highest is `026_employee_salaries.sql` (so `027_...` is next). If higher exists, rename the new file to the next free number.

- [ ] **Step 2: Write the migration**

```sql
-- 027_dashboard_finance_series.sql
-- Monthly aggregation for the dashboard hero chart + KPIs.
-- Income (previsto = all invoices, cobrado = paid invoices) with attendance/transport
-- split and net/gross (IVA) columns, plus devengado expenses. Salaries are added
-- client-side. month is 0-indexed. SECURITY INVOKER → RLS on base tables applies.

CREATE OR REPLACE FUNCTION get_dashboard_finance_series(
  p_from_year  INT,
  p_from_month INT,
  p_to_year    INT,
  p_to_month   INT
)
RETURNS TABLE (
  year             INT,
  month            INT,
  att_net          NUMERIC,
  att_gross        NUMERIC,
  trans_net        NUMERIC,
  trans_gross      NUMERIC,
  paid_att_net     NUMERIC,
  paid_att_gross   NUMERIC,
  paid_trans_net   NUMERIC,
  paid_trans_gross NUMERIC,
  expenses_total   NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT p_from_year * 12 + p_from_month AS lo,
           p_to_year   * 12 + p_to_month   AS hi
  ),
  inv AS (
    SELECT mi.year, mi.month,
      COALESCE(SUM(mi.attendance_chargeable_net), 0)   AS att_net,
      COALESCE(SUM(mi.attendance_chargeable_gross), 0) AS att_gross,
      COALESCE(SUM(mi.transport_chargeable_net), 0)    AS trans_net,
      COALESCE(SUM(mi.transport_chargeable_gross), 0)  AS trans_gross,
      COALESCE(SUM(CASE WHEN mi.payment_status = 'paid' THEN mi.attendance_chargeable_net  ELSE 0 END), 0) AS paid_att_net,
      COALESCE(SUM(CASE WHEN mi.payment_status = 'paid' THEN mi.attendance_chargeable_gross ELSE 0 END), 0) AS paid_att_gross,
      COALESCE(SUM(CASE WHEN mi.payment_status = 'paid' THEN mi.transport_chargeable_net   ELSE 0 END), 0) AS paid_trans_net,
      COALESCE(SUM(CASE WHEN mi.payment_status = 'paid' THEN mi.transport_chargeable_gross ELSE 0 END), 0) AS paid_trans_gross
    FROM monthly_invoices mi, bounds
    WHERE mi.year * 12 + mi.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY mi.year, mi.month
  ),
  exp AS (
    SELECT e.year, e.month, COALESCE(SUM(e.amount), 0) AS expenses_total
    FROM expenses e, bounds
    WHERE e.year * 12 + e.month BETWEEN bounds.lo AND bounds.hi
    GROUP BY e.year, e.month
  )
  SELECT
    COALESCE(inv.year,  exp.year)  AS year,
    COALESCE(inv.month, exp.month) AS month,
    COALESCE(inv.att_net, 0),
    COALESCE(inv.att_gross, 0),
    COALESCE(inv.trans_net, 0),
    COALESCE(inv.trans_gross, 0),
    COALESCE(inv.paid_att_net, 0),
    COALESCE(inv.paid_att_gross, 0),
    COALESCE(inv.paid_trans_net, 0),
    COALESCE(inv.paid_trans_gross, 0),
    COALESCE(exp.expenses_total, 0)
  FROM inv
  FULL OUTER JOIN exp ON inv.year = exp.year AND inv.month = exp.month
  ORDER BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_finance_series(INT, INT, INT, INT) TO authenticated;
```

- [ ] **Step 3: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool with name `027_dashboard_finance_series` and the SQL above (or run against the project per the repo's migration process in `supabase/README.md`).

- [ ] **Step 4: Verify it returns rows**

Run via Supabase MCP `execute_sql`:
```sql
SELECT * FROM get_dashboard_finance_series(2025, 6, 2026, 5);
```
Expected: one row per month that has invoices or expenses, with non-negative numeric columns, ordered by year/month. No error.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/027_dashboard_finance_series.sql
git commit -m "feat(dashboard): RPC get_dashboard_finance_series for monthly chart"
```

---

## Task 2: Currency & compact-number formatting

**Files:**
- Create: `src/services/dashboard/format.js`
- Test: `src/services/dashboard/format.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// src/services/dashboard/format.test.js
import { formatCurrency, formatCompact } from './format'

describe('formatCurrency', () => {
  test('formats UYU with no decimals', () => {
    expect(formatCurrency(1284000)).toBe('$ 1.284.000')
  })
  test('handles zero', () => {
    expect(formatCurrency(0)).toBe('$ 0')
  })
})

describe('formatCompact', () => {
  test('renders thousands with k', () => {
    expect(formatCompact(500000)).toBe('500k')
  })
  test('renders millions with M and one decimal', () => {
    expect(formatCompact(1200000)).toBe('1,2M')
  })
  test('small numbers unchanged', () => {
    expect(formatCompact(0)).toBe('0')
    expect(formatCompact(850)).toBe('850')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx craco test src/services/dashboard/format.test.js`
Expected: FAIL — `formatCurrency`/`formatCompact` not exported.

- [ ] **Step 3: Implement**

```javascript
// src/services/dashboard/format.js

// Uruguayan peso, no decimals. Uses es-UY grouping (1.284.000) with the $ symbol.
export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: 'UYU',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0
  }).format(amount || 0)
}

// Compact axis/legend labels: 850 → "850", 500000 → "500k", 1200000 → "1,2M".
export function formatCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000) {
    const v = (n / 1_000_000).toFixed(1).replace(/\.0$/, '').replace('.', ',')
    return `${v}M`
  }
  if (abs >= 1_000) {
    return `${Math.round(n / 1_000)}k`
  }
  return String(Math.round(n))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CI=true npx craco test src/services/dashboard/format.test.js`
Expected: PASS. If `formatCurrency` output differs in symbol/spacing on the runner's ICU, adjust the expected strings to match `Intl` output (capture actual with a quick `console.log`) — the implementation is canonical, tests follow it.

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboard/format.js src/services/dashboard/format.test.js
git commit -m "feat(dashboard): UYU currency + compact number formatting"
```

---

## Task 3: Salary monthlyization (pure)

**Files:**
- Create: `src/services/dashboard/financeSeries.js`
- Test: `src/services/dashboard/financeSeries.test.js`

Computes the monthlyized salary cost for a given `(year, month)` summed over employees hired by then. Reuses `salaryCalc` (`currentSalary`, `costoAnualMensualizado`) — which already amortizes aguinaldo, salario vacacional, and trailing-12-month extraordinarios, so extras are **not** added separately (avoids double counting).

- [ ] **Step 1: Write the failing tests**

```javascript
// src/services/dashboard/financeSeries.test.js
import { salaryCostForMonth } from './financeSeries'

const emp = (over = {}) => ({
  adjustments: [{ nominal: 1200, liquido: 1000, effectiveDate: '2026-01-01' }],
  extraCosts: [],
  ...over
})

describe('salaryCostForMonth', () => {
  test('zero when no employees', () => {
    expect(salaryCostForMonth([], 2026, 5)).toBe(0)
    expect(salaryCostForMonth(undefined, 2026, 5)).toBe(0)
  })

  test('zero before the employee was hired', () => {
    // hired 2026-01, ask for 2025-12 (month 11)
    expect(salaryCostForMonth([emp()], 2025, 11)).toBe(0)
  })

  test('after hire = monthlyized cost (nominal*12 + aguinaldo + vacacional)/12', () => {
    // costoAnual = 1200*12 + 1200 + (1000/30*20) + 0 = 14400 + 1200 + 666.6667
    // /12 ≈ 1355.5556
    const v = salaryCostForMonth([emp()], 2026, 5) // junio 2026, month 5
    expect(v).toBeCloseTo((14400 + 1200 + (1000 / 30) * 20) / 12, 2)
  })

  test('extraordinary cost in trailing 12m increases the monthly cost', () => {
    const withExtra = emp({ extraCosts: [{ amount: 12000, date: '2026-03-15' }] })
    const base = salaryCostForMonth([emp()], 2026, 5)
    const bumped = salaryCostForMonth([withExtra], 2026, 5)
    expect(bumped).toBeCloseTo(base + 12000 / 12, 2)
  })

  test('uses the salary in effect at that month, not a later raise', () => {
    const raised = emp({
      adjustments: [
        { nominal: 1200, liquido: 1000, effectiveDate: '2026-01-01' },
        { nominal: 2400, liquido: 2000, effectiveDate: '2026-07-01' }
      ]
    })
    // junio 2026 (month 5) is before the July raise → uses 1200 nominal
    const v = salaryCostForMonth([raised], 2026, 5)
    expect(v).toBeCloseTo((14400 + 1200 + (1000 / 30) * 20) / 12, 2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx craco test src/services/dashboard/financeSeries.test.js`
Expected: FAIL — `salaryCostForMonth` not exported.

- [ ] **Step 3: Implement**

```javascript
// src/services/dashboard/financeSeries.js
import { currentSalary, costoAnualMensualizado } from '../salaries/salaryCalc'

// Last calendar day of a 0-indexed month as 'YYYY-MM-DD' (UTC-safe).
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)
}

// Monthlyized salary cost for (year, month): sum over employees hired by then.
// Historical approximation — does not model terminations (see spec §7).
export function salaryCostForMonth(employees, year, month) {
  if (!employees || employees.length === 0) return 0
  const asOf = lastDayOfMonth(year, month)
  let total = 0
  for (const emp of employees) {
    const hiredBy = (emp.adjustments || []).filter(a => a.effectiveDate <= asOf)
    const sal = currentSalary(hiredBy)
    if (!sal) continue // not yet hired this month
    total += costoAnualMensualizado(
      { nominal: sal.nominal, liquido: sal.liquido, extraCosts: emp.extraCosts },
      asOf
    )
  }
  return total
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CI=true npx craco test src/services/dashboard/financeSeries.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboard/financeSeries.js src/services/dashboard/financeSeries.test.js
git commit -m "feat(dashboard): salaryCostForMonth monthlyization"
```

---

## Task 4: Series merge + selectors + KPI derivation (pure)

**Files:**
- Modify: `src/services/dashboard/financeSeries.js`
- Test: `src/services/dashboard/financeSeries.test.js`

`mergeFinanceSeries` turns raw RPC rows + employees into UI-ready month objects. Selectors pick income/expenses/margin per the active toggles. `deriveKpis` computes the 5 KPIs for the selected month plus deltas vs the previous month in the series.

- [ ] **Step 1: Write the failing tests (append to existing test file)**

```javascript
// append to src/services/dashboard/financeSeries.test.js
import {
  mergeFinanceSeries,
  selectIncome,
  selectExpensesTotal,
  selectMargin,
  deriveKpis
} from './financeSeries'

const rpcRow = (over = {}) => ({
  year: 2026, month: 5,
  att_net: 1000, att_gross: 1220,
  trans_net: 200, trans_gross: 244,
  paid_att_net: 500, paid_att_gross: 610,
  paid_trans_net: 100, paid_trans_gross: 122,
  expenses_total: 300,
  ...over
})

describe('mergeFinanceSeries', () => {
  test('coerces numbers and adds salaries per month', () => {
    const out = mergeFinanceSeries([rpcRow()], []) // no employees → salaries 0
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      year: 2026, month: 5,
      attendanceNet: 1000, attendanceGross: 1220,
      transportNet: 200, transportGross: 244,
      paidAttendanceNet: 500, paidTransportNet: 100,
      expenses: 300, salaries: 0
    })
  })
})

describe('selectors', () => {
  const row = mergeFinanceSeries([rpcRow()], [])[0]
  test('previsto net = attendance+transport net', () => {
    expect(selectIncome(row, { basis: 'previsto', withIva: false })).toBe(1200)
  })
  test('previsto gross = attendance+transport gross', () => {
    expect(selectIncome(row, { basis: 'previsto', withIva: true })).toBe(1464)
  })
  test('cobrado net = paid attendance+transport net', () => {
    expect(selectIncome(row, { basis: 'cobrado', withIva: false })).toBe(600)
  })
  test('expenses total = expenses + salaries', () => {
    expect(selectExpensesTotal({ ...row, salaries: 50 })).toBe(350)
  })
  test('margin = income − (expenses+salaries)', () => {
    expect(selectMargin({ ...row, salaries: 50 }, { basis: 'previsto', withIva: false })).toBe(1200 - 350)
  })
})

describe('deriveKpis', () => {
  const series = [
    mergeFinanceSeries([rpcRow({ month: 4, att_net: 800, trans_net: 100, paid_att_net: 800, paid_trans_net: 100, expenses_total: 200 })], [])[0],
    mergeFinanceSeries([rpcRow({ month: 5 })], [])[0]
  ]
  test('returns null when selected month not present', () => {
    expect(deriveKpis(series, 2026, 11, {})).toBeNull()
  })
  test('computes KPIs and delta vs previous month', () => {
    const k = deriveKpis(series, 2026, 5, { withIva: false })
    expect(k.ingresoPrevisto).toBe(1200)   // 1000+200
    expect(k.cobrado).toBe(600)            // 500+100
    expect(k.gastos).toBe(300)             // expenses 300 + salaries 0
    expect(k.margen).toBe(900)             // 1200 - 300
    expect(k.tasaCobro).toBeCloseTo(50, 5) // 600/1200
    expect(k.deltas.ingresoPrevisto).toBe(1200 - 900) // prev month previsto = 800+100
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx craco test src/services/dashboard/financeSeries.test.js`
Expected: FAIL — new exports not defined.

- [ ] **Step 3: Implement (append to financeSeries.js)**

```javascript
// append to src/services/dashboard/financeSeries.js

// Raw RPC rows + employees → UI-ready month objects (salaries computed per month).
export function mergeFinanceSeries(rpcRows, employees) {
  return (rpcRows || []).map(r => ({
    year: r.year,
    month: r.month,
    attendanceNet: Number(r.att_net) || 0,
    attendanceGross: Number(r.att_gross) || 0,
    transportNet: Number(r.trans_net) || 0,
    transportGross: Number(r.trans_gross) || 0,
    paidAttendanceNet: Number(r.paid_att_net) || 0,
    paidAttendanceGross: Number(r.paid_att_gross) || 0,
    paidTransportNet: Number(r.paid_trans_net) || 0,
    paidTransportGross: Number(r.paid_trans_gross) || 0,
    expenses: Number(r.expenses_total) || 0,
    salaries: salaryCostForMonth(employees, r.year, r.month)
  }))
}

// Income for a month row given basis ('previsto'|'cobrado') and IVA toggle.
export function selectIncome(row, { basis = 'previsto', withIva = false } = {}) {
  if (basis === 'cobrado') {
    return withIva
      ? row.paidAttendanceGross + row.paidTransportGross
      : row.paidAttendanceNet + row.paidTransportNet
  }
  return withIva
    ? row.attendanceGross + row.transportGross
    : row.attendanceNet + row.transportNet
}

// Total monthly expenses = devengado expenses + monthlyized salaries.
export function selectExpensesTotal(row) {
  return (row.expenses || 0) + (row.salaries || 0)
}

export function selectMargin(row, opts) {
  return selectIncome(row, opts) - selectExpensesTotal(row)
}

// KPIs for the selected (year, month) + deltas vs the previous month in the series.
export function deriveKpis(series, year, month, opts = {}) {
  const idx = (series || []).findIndex(r => r.year === year && r.month === month)
  if (idx < 0) return null
  const cur = series[idx]
  const prev = idx > 0 ? series[idx - 1] : null

  const ingresoPrevisto = selectIncome(cur, { ...opts, basis: 'previsto' })
  const cobrado = selectIncome(cur, { ...opts, basis: 'cobrado' })
  const gastos = selectExpensesTotal(cur)
  const margen = ingresoPrevisto - gastos
  const tasaCobro = ingresoPrevisto > 0 ? (cobrado / ingresoPrevisto) * 100 : 0

  const prevPrevisto = prev ? selectIncome(prev, { ...opts, basis: 'previsto' }) : null
  const prevGastos = prev ? selectExpensesTotal(prev) : null

  return {
    ingresoPrevisto,
    cobrado,
    gastos,
    margen,
    tasaCobro,
    deltas: {
      ingresoPrevisto: prevPrevisto == null ? null : ingresoPrevisto - prevPrevisto,
      gastos: prevGastos == null ? null : gastos - prevGastos
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CI=true npx craco test src/services/dashboard/financeSeries.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboard/financeSeries.js src/services/dashboard/financeSeries.test.js
git commit -m "feat(dashboard): finance series merge, selectors, KPI derivation"
```

---

## Task 5: dashboardService.getDashboardFinanceSeries

**Files:**
- Modify: `src/services/dashboard/dashboardService.js`

Wires the RPC + employees + merge into one call the page consumes. No unit test (it's I/O glue over Supabase); verified in the app at Task 9.

- [ ] **Step 1: Add the function (append to dashboardService.js)**

```javascript
// append to src/services/dashboard/dashboardService.js
import { getEmployees } from '../salaries/salaryService'
import { mergeFinanceSeries } from './financeSeries'

/**
 * Month-over-month finance series for the dashboard hero + KPIs.
 * Inclusive range. Months are 0-indexed.
 * @param {number} fromYear
 * @param {number} fromMonth - 0-indexed
 * @param {number} toYear
 * @param {number} toMonth - 0-indexed
 * @returns {Promise<Array>} merged month objects (see mergeFinanceSeries)
 */
export async function getDashboardFinanceSeries(fromYear, fromMonth, toYear, toMonth) {
  const [seriesRes, employees] = await Promise.all([
    supabase.rpc('get_dashboard_finance_series', {
      p_from_year: fromYear,
      p_from_month: fromMonth,
      p_to_year: toYear,
      p_to_month: toMonth
    }),
    getEmployees().catch(() => []) // operador lacks salary access → empty, never throws
  ])

  if (seriesRes.error) throw new Error(seriesRes.error.message)
  return mergeFinanceSeries(seriesRes.data || [], employees)
}
```

Note: `supabase` is already imported at the top of `dashboardService.js`. Place the two new `import` lines with the existing imports at the top of the file rather than mid-file if your linter prefers; functionally either works in ESM/CRA.

- [ ] **Step 2: Verify it compiles**

Run: `CI=true npx craco test src/services/dashboard/financeSeries.test.js`
Expected: PASS (unchanged) — confirms no syntax error was introduced in the shared dir. Full app verification happens in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/services/dashboard/dashboardService.js
git commit -m "feat(dashboard): getDashboardFinanceSeries (RPC + salaries merge)"
```

---

## Task 6: PlaceholderCard component

**Files:**
- Create: `src/pages/Dashboard/PlaceholderCard.jsx`

A styled, clearly-labeled placeholder reserving layout space for the deferred regions (facturación, turnos, transporte).

- [ ] **Step 1: Implement**

```jsx
// src/pages/Dashboard/PlaceholderCard.jsx
import Card from '../../components/ui/Card'

export default function PlaceholderCard({ title, hint, minHeight = 200 }) {
  return (
    <Card className="border-dashed">
      <div
        className="flex flex-col items-center justify-center text-center px-6 py-8"
        style={{ minHeight }}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {title}
        </span>
        <p className="text-sm text-gray-400 mt-2 max-w-xs">{hint}</p>
        <span className="mt-3 text-[11px] font-medium text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full">
          próximamente
        </span>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Confirm `Card` accepts `className`**

Run: `grep -n "className" src/components/ui/Card.jsx`
Expected: `Card` spreads/merges a `className` prop onto its root. If it does not, pass styling via a wrapping `div` instead of `className` on `Card`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Dashboard/PlaceholderCard.jsx
git commit -m "feat(dashboard): PlaceholderCard for deferred regions"
```

---

## Task 7: KpiRow component

**Files:**
- Create: `src/pages/Dashboard/KpiRow.jsx`

Renders the 5 KPI cards from a `kpis` object (output of `deriveKpis`) honoring the active IVA toggle for display.

- [ ] **Step 1: Implement**

```jsx
// src/pages/Dashboard/KpiRow.jsx
import Card, { CardContent } from '../../components/ui/Card'
import { formatCurrency } from '../../services/dashboard/format'

function Delta({ value }) {
  if (value == null) return <p className="text-xs text-gray-400 mt-1">sin mes anterior</p>
  const up = value >= 0
  return (
    <p className={`text-xs font-semibold mt-1 ${up ? 'text-green-600' : 'text-red-600'}`}>
      {up ? '▲' : '▼'} {formatCurrency(Math.abs(value))} vs mes ant.
    </p>
  )
}

function Kpi({ label, value, colorClass = 'text-gray-900', children }) {
  return (
    <Card className="flex-1 min-w-0">
      <CardContent className="py-5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 truncate">{label}</p>
        <p className={`text-2xl font-bold ${colorClass} truncate`}>{value}</p>
        {children}
      </CardContent>
    </Card>
  )
}

export default function KpiRow({ kpis }) {
  if (!kpis) {
    return (
      <div className="flex gap-4 flex-wrap">
        {[0, 1, 2, 3, 4].map(i => (
          <Card key={i} className="flex-1 min-w-0">
            <CardContent className="py-5">
              <div className="h-3 w-24 bg-gray-100 rounded mb-3" />
              <div className="h-6 w-28 bg-gray-100 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const collectionPct = kpis.ingresoPrevisto > 0
    ? Math.round((kpis.cobrado / kpis.ingresoPrevisto) * 100)
    : 0

  return (
    <div className="flex gap-4 flex-wrap">
      <Kpi label="Ingreso previsto" value={formatCurrency(kpis.ingresoPrevisto)}>
        <Delta value={kpis.deltas.ingresoPrevisto} />
      </Kpi>
      <Kpi label="Cobrado" value={formatCurrency(kpis.cobrado)} colorClass="text-green-700">
        <p className="text-xs text-gray-400 mt-1">{collectionPct}% del previsto</p>
      </Kpi>
      <Kpi label="Gastos" value={formatCurrency(kpis.gastos)} colorClass="text-red-700">
        <Delta value={kpis.deltas.gastos} />
      </Kpi>
      <Kpi
        label="Margen"
        value={formatCurrency(kpis.margen)}
        colorClass={kpis.margen >= 0 ? 'text-green-700' : 'text-red-700'}
      >
        <p className="text-xs text-gray-400 mt-1">Ingreso − Gastos</p>
      </Kpi>
      <Kpi
        label="Tasa de cobro"
        value={`${kpis.tasaCobro.toFixed(0)}%`}
        colorClass={kpis.tasaCobro >= 80 ? 'text-green-700' : kpis.tasaCobro >= 50 ? 'text-amber-700' : 'text-red-700'}
      >
        <p className="text-xs text-gray-400 mt-1">Cobrado / Previsto</p>
      </Kpi>
    </div>
  )
}
```

- [ ] **Step 2: Confirm `Card`/`CardContent` exports match the import**

Run: `grep -n "export" src/components/ui/Card.jsx`
Expected: default export `Card` and named export `CardContent` (the old Dashboard imported them this way). If names differ, adjust the import.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Dashboard/KpiRow.jsx
git commit -m "feat(dashboard): KpiRow with deltas"
```

---

## Task 8: MonthlyFinanceChart component

**Files:**
- Create: `src/pages/Dashboard/MonthlyFinanceChart.jsx`

Pure SVG/CSS hero chart. Owns its own control state (range/basis/IVA/type/series toggles) but **lifts the IVA + basis selection up** via `onOptionsChange` so the KPI row reflects the same toggles, and calls `onSelectMonth` when a bar is clicked. Receives the full `series` and the `selected` month.

- [ ] **Step 1: Implement**

```jsx
// src/pages/Dashboard/MonthlyFinanceChart.jsx
import { useState, useMemo, useEffect } from 'react'
import Card from '../../components/ui/Card'
import { formatCurrency, formatCompact } from '../../services/dashboard/format'
import { selectIncome, selectExpensesTotal, selectMargin } from '../../services/dashboard/financeSeries'

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const RANGES = [{ id: 6, label: '6M' }, { id: 12, label: '12M' }, { id: 24, label: '24M' }]

const SERIES_KEYS = [
  { key: 'asistencia', label: 'Asistencia', color: '#34d399' },
  { key: 'transporte', label: 'Transporte', color: '#10b981' },
  { key: 'gastos', label: 'Gastos', color: '#f87171' },
  { key: 'sueldos', label: 'Sueldos', color: '#a78bfa' },
  { key: 'margen', label: 'Margen', color: '#6366f1' }
]

function incomePart(row, part, withIva, basis) {
  const net = basis === 'cobrado'
    ? (part === 'asistencia' ? row.paidAttendanceNet : row.paidTransportNet)
    : (part === 'asistencia' ? row.attendanceNet : row.transportNet)
  const gross = basis === 'cobrado'
    ? (part === 'asistencia' ? row.paidAttendanceGross : row.paidTransportGross)
    : (part === 'asistencia' ? row.attendanceGross : row.transportGross)
  return withIva ? gross : net
}

export default function MonthlyFinanceChart({ series, selected, onSelectMonth, onOptionsChange }) {
  const [range, setRange] = useState(12)
  const [basis, setBasis] = useState('previsto')
  const [withIva, setWithIva] = useState(false)
  const [type, setType] = useState('bars')
  const [active, setActive] = useState({ asistencia: true, transporte: true, gastos: true, sueldos: false, margen: true })

  // Keep KPI row in sync with the income toggles.
  useEffect(() => {
    onOptionsChange?.({ basis, withIva })
  }, [basis, withIva, onOptionsChange])

  const opts = { basis, withIva }
  const data = useMemo(() => (series || []).slice(-range), [series, range])

  const maxVal = useMemo(() => {
    let m = 1
    for (const row of data) {
      m = Math.max(m, selectIncome(row, opts), selectExpensesTotal(row))
    }
    return m
  }, [data, basis, withIva])

  const H = 170 // chart body px
  const y = v => Math.max(2, (v / maxVal) * H)

  const toggleSeries = k => setActive(a => ({ ...a, [k]: !a[k] }))

  // Margin line points (only when margen active)
  const marginPts = data.map((row, i) => {
    const x = (i + 0.5) / data.length * 100
    const yy = H - y(selectMargin(row, opts))
    return `${x},${yy}`
  }).join(' ')

  return (
    <Card>
      {/* header + controls */}
      <div className="flex items-start justify-between gap-4 flex-wrap px-6 pt-5">
        <div>
          <h2 className="text-base font-bold text-gray-900">Ingresos vs Gastos</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            últimos {range} meses · pesos uruguayos · {withIva ? 'con IVA' : 'sin IVA'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented options={RANGES.map(r => ({ id: r.id, label: r.label }))} value={range} onChange={setRange} />
          <Segmented options={[{ id: 'previsto', label: 'Previsto' }, { id: 'cobrado', label: 'Cobrado' }]} value={basis} onChange={setBasis} />
          <Segmented options={[{ id: false, label: 'Sin IVA' }, { id: true, label: 'Con IVA' }]} value={withIva} onChange={setWithIva} />
          <Segmented options={[{ id: 'bars', label: 'Barras' }, { id: 'lines', label: 'Líneas' }]} value={type} onChange={setType} />
        </div>
      </div>

      {/* series chips */}
      <div className="flex gap-2 flex-wrap px-6 pt-3">
        {SERIES_KEYS.map(s => (
          <button
            key={s.key}
            onClick={() => toggleSeries(s.key)}
            className={`inline-flex items-center gap-2 text-xs font-semibold rounded-full border px-3 py-1.5 transition-opacity ${active[s.key] ? 'opacity-100' : 'opacity-40'} border-gray-100 bg-gray-50 text-gray-700`}
          >
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>

      {/* chart body */}
      <div className="relative px-6 pt-6 pb-4">
        <div className="flex items-end gap-3 relative" style={{ height: H + 24 }}>
          {/* margin line overlay */}
          {active.margen && (
            <svg className="absolute left-0 right-0 pointer-events-none" style={{ top: 0, height: H }} viewBox="0 0 100 170" preserveAspectRatio="none">
              <polyline points={marginPts} fill="none" stroke="#6366f1" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
          )}

          {data.map((row, i) => {
            const isSel = selected && row.year === selected.year && row.month === selected.month
            const asis = active.asistencia ? incomePart(row, 'asistencia', withIva, basis) : 0
            const trans = active.transporte ? incomePart(row, 'transporte', withIva, basis) : 0
            const income = asis + trans
            const exp = active.gastos ? row.expenses : 0
            const sue = active.sueldos ? row.salaries : 0
            const expTotal = exp + sue
            return (
              <button
                key={`${row.year}-${row.month}`}
                onClick={() => onSelectMonth?.({ year: row.year, month: row.month })}
                className="flex-1 flex flex-col items-center gap-1.5 group"
                title={`${MONTH_LABELS[row.month]} ${row.year}\nIngreso: ${formatCurrency(selectIncome(row, opts))}\nGastos: ${formatCurrency(selectExpensesTotal(row))}\nMargen: ${formatCurrency(selectMargin(row, opts))}`}
              >
                <div className="flex items-end gap-1" style={{ height: H }}>
                  {/* income bar: stacked asistencia + transporte */}
                  <div className="w-3.5 flex flex-col justify-end">
                    <div style={{ height: y(trans), background: '#10b981' }} className="rounded-t-sm" />
                    <div style={{ height: y(asis), background: '#34d399' }} />
                  </div>
                  {/* expense bar: stacked gastos + sueldos */}
                  <div className="w-3.5 flex flex-col justify-end">
                    <div style={{ height: y(sue), background: '#a78bfa' }} className="rounded-t-sm" />
                    <div style={{ height: y(exp), background: '#f87171' }} />
                  </div>
                </div>
                <span className={`text-[11px] ${isSel ? 'text-indigo-600 font-bold' : 'text-gray-400'}`}>
                  {MONTH_LABELS[row.month]}
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Clic en un mes para verlo en los KPIs. IVA aplica a ingresos; los gastos se muestran como registrados.
        </p>
      </div>
    </Card>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
      {options.map(o => (
        <button
          key={String(o.id)}
          onClick={() => onChange(o.id)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${String(value) === String(o.id) ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

Note on `type`/lines: v1 ships the barras view as primary; the `Líneas` toggle is wired in state and may render bars until a line view is added. This is acceptable for v1 — do not block on it. (If trivial, render the margin line + hide bars when `type === 'lines'`.)

- [ ] **Step 2: Commit**

```bash
git add src/pages/Dashboard/MonthlyFinanceChart.jsx
git commit -m "feat(dashboard): MonthlyFinanceChart (SVG/CSS hero with controls)"
```

---

## Task 9: Rebuild Dashboard.jsx

**Files:**
- Modify: `src/pages/Dashboard/Dashboard.jsx` (full rewrite)

Composes: header (title + month nav + "Facturar el mes" bulk modal preserved from the old dashboard) → hero chart → KPI row → placeholder cards. Financial regions gated by `hasAccess('dashboard_financials')`.

- [ ] **Step 1: Rewrite the file**

```jsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { format, addMonths, subMonths, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowLeft, NavArrowRight } from 'iconoir-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import MonthlyFinanceChart from './MonthlyFinanceChart'
import KpiRow from './KpiRow'
import PlaceholderCard from './PlaceholderCard'
import { getDashboardFinanceSeries } from '../../services/dashboard/dashboardService'
import { deriveKpis } from '../../services/dashboard/financeSeries'
import { getClients, calculateMonthBilling, emitInvoice } from '../../services/api'
import { useAuth } from '../../context/AuthContext'

const RANGE_MONTHS = 24 // fetch a generous window; the chart slices to 6/12/24

export default function Dashboard() {
  const { hasAccess } = useAuth()
  const showFinancials = hasAccess('dashboard_financials')

  const [selected, setSelected] = useState(() => {
    const d = startOfMonth(new Date())
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [kpiOpts, setKpiOpts] = useState({ basis: 'previsto', withIva: false })

  // Bulk monthly emission (preserved from old dashboard)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkRows, setBulkRows] = useState([])
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: [] })

  const load = useCallback(async () => {
    if (!showFinancials) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const to = selected
      const fromDate = subMonths(new Date(selected.year, selected.month, 1), RANGE_MONTHS - 1)
      const data = await getDashboardFinanceSeries(
        fromDate.getFullYear(), fromDate.getMonth(), to.year, to.month
      )
      setSeries(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [selected, showFinancials])

  useEffect(() => { load() }, [load])

  const kpis = useMemo(
    () => deriveKpis(series, selected.year, selected.month, kpiOpts),
    [series, selected, kpiOpts]
  )

  const currentDate = new Date(selected.year, selected.month, 1)
  const monthLabel = format(currentDate, 'MMMM yyyy', { locale: es })
  const goBack = () => setSelected(s => { const d = subMonths(new Date(s.year, s.month, 1), 1); return { year: d.getFullYear(), month: d.getMonth() } })
  const goNext = () => setSelected(s => { const d = addMonths(new Date(s.year, s.month, 1), 1); return { year: d.getFullYear(), month: d.getMonth() } })

  // --- bulk emission (unchanged behavior) ---
  const openBulk = async () => {
    setBulkOpen(true); setBulkLoading(true); setBulkProgress({ done: 0, total: 0, failed: [] })
    try {
      const clients = await getClients()
      const rows = await Promise.all(clients.map(async (c) => {
        let amount = 0, reason = null
        try { amount = (await calculateMonthBilling(c.id, selected.year, selected.month)).totalChargeableGross }
        catch (_) { reason = 'sin plan' }
        const status = !c.documentNumber ? 'sin CI' : reason ? reason : amount <= 0 ? 'monto 0' : 'listo'
        return { id: c.id, name: `${c.firstName} ${c.lastName}`, amount, status, selected: status === 'listo' }
      }))
      setBulkRows(rows)
    } catch (e) { window.alert(`Error cargando clientes: ${e.message}`) }
    finally { setBulkLoading(false) }
  }
  const runBulk = async () => {
    const targets = bulkRows.filter(r => r.selected && r.status === 'listo')
    if (!targets.length) return
    setBulkRunning(true); setBulkProgress({ done: 0, total: targets.length, failed: [] })
    const failed = []
    for (let i = 0; i < targets.length; i++) {
      try { await emitInvoice(targets[i].id, selected.year, selected.month) }
      catch (e) { failed.push({ name: targets[i].name, error: e.message }) }
      setBulkProgress({ done: i + 1, total: targets.length, failed: [...failed] })
      if (i < targets.length - 1) await new Promise(res => setTimeout(res, 1100))
    }
    setBulkRunning(false); load()
  }
  const selectedCount = bulkRows.filter(r => r.selected && r.status === 'listo').length

  return (
    <div className="-mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8 min-h-full bg-gray-50">
      {/* header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={goBack}><NavArrowLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-medium text-gray-700 capitalize w-36 text-center">{monthLabel}</span>
          <Button variant="secondary" size="sm" onClick={goNext}><NavArrowRight className="w-4 h-4" /></Button>
          {hasAccess('billing') && (
            <Button size="sm" onClick={openBulk} className="ml-2">Facturar el mes</Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Error al cargar datos: {error}
        </div>
      )}

      <div className="space-y-6">
        {showFinancials && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-32 text-gray-400 text-sm">Cargando métricas…</div>
            ) : (
              <>
                <MonthlyFinanceChart
                  series={series}
                  selected={selected}
                  onSelectMonth={setSelected}
                  onOptionsChange={setKpiOpts}
                />
                <KpiRow kpis={kpis} />
              </>
            )}
          </>
        )}

        {/* deferred regions — placeholders (spec §5.3–§5.5) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <PlaceholderCard
              title="Facturación & cobranza"
              hint="Lista accionable de cobranza y facturación del mes. Diseño en definición."
              minHeight={280}
            />
          </div>
          <div className="space-y-4">
            <PlaceholderCard title="Turnos de hoy" hint="Resumen de asistencia del día." minHeight={130} />
            <PlaceholderCard title="Transporte de hoy" hint="Resumen de viajes y autos del día." minHeight={130} />
          </div>
        </div>
      </div>

      {/* bulk emission modal (preserved) */}
      <Modal isOpen={bulkOpen} onClose={() => { if (!bulkRunning) setBulkOpen(false) }} title={`Emitir facturas — ${monthLabel}`} size="xl">
        {bulkLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Calculando montos…</div>
        ) : (
          <div className="space-y-4">
            {bulkProgress.total > 0 && (
              <div className="text-sm text-gray-700">
                Emitidas {bulkProgress.done}/{bulkProgress.total}
                {bulkProgress.failed.length > 0 && <span className="text-red-600"> · {bulkProgress.failed.length} fallidas</span>}
              </div>
            )}
            <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {bulkRows.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-400">No hay clientes</div>
              ) : bulkRows.map((r) => (
                <label key={r.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${r.status === 'listo' ? 'cursor-pointer hover:bg-gray-50' : 'opacity-60'}`}>
                  <input type="checkbox" checked={r.selected} disabled={r.status !== 'listo' || bulkRunning}
                    onChange={(e) => setBulkRows(rows => rows.map(x => x.id === r.id ? { ...x, selected: e.target.checked } : x))} />
                  <span className="flex-1 text-gray-900">{r.name}</span>
                  <span className="text-gray-600">${r.amount.toLocaleString()}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${r.status === 'listo' ? 'bg-green-50 text-green-700' : r.status === 'sin CI' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
                </label>
              ))}
            </div>
            {bulkProgress.failed.length > 0 && (
              <div className="text-xs text-red-600 space-y-0.5 max-h-24 overflow-y-auto">
                {bulkProgress.failed.map((f, i) => <div key={i}>{f.name}: {f.error}</div>)}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={bulkRunning}>Cerrar</Button>
              <Button onClick={runBulk} loading={bulkRunning} disabled={bulkRunning || selectedCount === 0}>
                Emitir seleccionadas ({selectedCount})
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Compile Tailwind**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: completes without error (new utility classes like `border-dashed`, `rounded-sm`, `lg:col-span-2` are picked up).

- [ ] **Step 3: Run the app and verify in the browser**

Run: `npm start` (or the project's `/run` flow).
Verify as superadmin:
- Hero chart renders grouped bars per month; current month label is bold/indigo.
- Range toggle (6M/12M/24M) changes the number of bars.
- Previsto/Cobrado and Sin IVA/Con IVA toggles change bar heights, and the KPI values update in lockstep.
- Series chips dim/show their bars; Margen toggles the line overlay.
- Clicking a bar moves the selection → KPIs recompute for that month.
- KPI deltas show vs the previous month.
- "Facturar el mes" opens the bulk modal and lists clients with statuses.
- Three placeholder cards render below with "próximamente".

- [ ] **Step 4: Verify non-superadmin gating (optional if a test login exists)**

Log in as operador/admin: the hero + KPIs are hidden; placeholder cards still render; no errors in console.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard/Dashboard.jsx src/tailwind.output.css
git commit -m "feat(dashboard): rebuild with hero chart + KPIs + placeholders"
```

---

## Task 10: Full test + lint pass

- [ ] **Step 1: Run the full unit suite**

Run: `CI=true npx craco test`
Expected: all suites pass, including `format.test.js`, `financeSeries.test.js`, and the existing `salaryCalc.test.js`.

- [ ] **Step 2: Production build sanity**

Run: `npm run build`
Expected: build succeeds with no errors (warnings acceptable).

- [ ] **Step 3: Final commit (if build produced changes)**

```bash
git add -A
git commit -m "chore(dashboard): build verification" || echo "nothing to commit"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §2 accounting model → Tasks 1, 3, 4 (RPC components, salaries, selectors with previsto/cobrado + IVA). ✅
- §3 layout → Task 9 (header, hero, KPIs, placeholder grid). ✅
- §4 data layer (new aggregation) → Tasks 1 (RPC), 3 (salaries), 5 (service merge). ✅
- §5.1 hero + controls → Tasks 6–8 (chart). ✅
- §5.2 KPI row → Task 7. ✅
- §5.3–§5.5 placeholders → Tasks 6, 9. ✅
- §6 permissions → Task 9 (`hasAccess('dashboard_financials')`). ✅
- §7 open items → resolved in header decisions. ✅

**Type consistency:** RPC column names (`att_net`, `paid_trans_gross`, …) match `mergeFinanceSeries` reads; merged field names (`attendanceNet`, `paidTransportGross`, `expenses`, `salaries`) match selectors and `deriveKpis`; `deriveKpis` output (`ingresoPrevisto`, `cobrado`, `gastos`, `margen`, `tasaCobro`, `deltas`) matches `KpiRow` reads; chart props (`series`, `selected`, `onSelectMonth`, `onOptionsChange`) match Dashboard usage. ✅

**Placeholder scan:** no TBD/TODO in code steps; all code shown in full. The `Líneas` chart-type note is an explicit, bounded v1 allowance, not a hidden gap. ✅
