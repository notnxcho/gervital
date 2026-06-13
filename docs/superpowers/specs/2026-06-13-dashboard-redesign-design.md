# Dashboard Redesign — Design Spec

**Date:** 2026-06-13
**Status:** Draft for review
**Scope:** Rebuild `/dashboard` from scratch (superadmin financial command center)

---

## 1. Goal

A single screen where the **superadmin** runs the month: sees the business trend
at a glance, manages monthly billing & collection, and checks today's operational
pulse (turnos + transporte).

Composition, top to bottom:

1. **Hero chart** — ingresos vs gastos, month over month (the centerpiece)
2. **KPI row** — 5 cards with deltas vs the previous month
3. **Facturación & cobranza** — actionable client list for the selected month (main column)
4. **Turnos de hoy** + **Transporte de hoy** — daily operational summaries (right rail)

The current dashboard is discarded entirely; this design is uninfluenced by it.

---

## 2. Accounting model (the foundation)

These definitions drive the hero, the KPIs, and the billing panel.

### Income ("ingreso")
- **Billing runs collection-before-invoicing.** Clients are charged in advance
  (vencimiento día 10); the electronic invoice (Biller) is emitted afterward.
  Therefore the chart's income axis is **"previsto"** — everything that should come
  in that month — **independent of payment or invoice status**.
- **Default basis = Previsto** = sum of `chargeableAmount` for the month
  (cobrado + no cobrado). Alternate basis = **Cobrado** = sum of `paidAmount`.
- **Income = asistencia + transporte**, summed by default, **disaggregable** into two
  series. Transport is **a bundled component of the monthly charge**, not separately
  billed — and it is already stored decomposed (see §4).
- **IVA toggle (con / sin IVA).** "Ingreso real" is **net (sin IVA)** — the IVA on
  plans and transport is remitted to the fisco, so it is not real income. Net is the
  default; gross is available via toggle. Both values are persisted (no rate math).

### Expenses ("gastos")
- **Devengados**: all expenses of the month, **paid + pending** (reflects true monthly cost).
- Includes **Sueldos** by default, **disaggregable** as its own series.
- Salaries are *derived* (not `expenses` rows): monthlyized recurring cost +
  extraordinary costs dated in the month (see §4).

### Margin
- **Margen = Ingreso − Gastos** for the month (respects the active IVA/basis toggles
  on the income side; expenses have no net/gross split — see §4 open item).

---

## 3. Layout (validated via mockup)

```
┌───────────────────────────────────────────────────────────────┐
│ Dashboard            ‹  junio 2026  ›       [ Facturar el mes ] │
├───────────────────────────────────────────────────────────────┤
│ HERO — Ingresos vs Gastos                                       │
│ [6M|12M|24M|Año] [Previsto|Cobrado] [Con|Sin IVA] [barras|líneas]│
│ chips: ◼Asistencia ◼Transporte ◼Gastos ◻Sueldos ◼Margen         │
│ ▮▮ grouped bars per month + margin line · hover/click           │
├───────────────────────────────────────────────────────────────┤
│ [Ingreso previsto] [Cobrado] [Gastos] [Margen] [Tasa de cobro]  │  ← KPI row
├───────────────────────────────────┬───────────────────────────┤
│ FACTURACIÓN & COBRANZA — junio     │ TURNOS DE HOY             │
│ client rows: chip · monto · acción │ mañana/tarde/completo …   │
│ (Cobrar / Facturar)                ├───────────────────────────┤
│                                    │ TRANSPORTE DE HOY         │
│                                    │ autos · viajes · por auto │
└───────────────────────────────────┴───────────────────────────┘
```

Mockups: `.superpowers/brainstorm/.../layout-v1.html`, `hero-controls-v2.html`.

---

## 4. Data layer

### What already exists (no schema change)
`monthly_invoices` (since migration 015) and `invoices_view` persist per invoice:
- `attendanceChargeableNet` / `attendanceChargeableGross`
- `transportChargeableNet` / `transportChargeableGross`
- `chargeableAmount` (total gross previsto), `paidAmount`
- `paymentStatus`, `invoiceStatus`, `invoiceNumber`, `invoiceUrl`

This gives the chart everything for income: asistencia/transporte split, net/gross,
previsto/cobrado — all readable per `(year, month)`.

### What is new: a monthly aggregation layer
A new `dashboardService` function builds the month-over-month series:

- **Income & collection** — aggregate `invoices_view` grouped by `(year, month)` over the
  selected range. Per month, sum: attendance net/gross, transport net/gross, paid_amount.
  *(Implementation: a `get_dashboard_finance_series(p_from, p_to)` SQL RPC for clean
  server-side aggregation — preferred over fetching all invoice rows client-side.)*
- **Expenses** — aggregate `expenses.amount` grouped by `(year, month)` (devengado = all
  statuses). Included in the same RPC.
- **Salaries** — computed **client-side** from `getEmployees()` using
  `salaryCalc.costoAnualMensualizado` per employee active in that month, plus
  `employee_extra_costs` dated in that month. (SQL-side salary math is intentionally
  avoided — the formula lives in `salaryCalc.js` and is unit-tested.)

The chart series for a month = `{ attendanceNet, attendanceGross, transportNet,
transportGross, paidNet, paidGross, expenses, salaries }`. The component the chart shows
depends on the active toggles (basis, IVA, which series are on).

### Daily summaries
- **Turnos de hoy** — `clients_full.plan` (assignedDays ∩ today's weekday, by schedule)
  for planned counts, joined with `attendance_view` for today to derive present / absent
  (justified vs unjustified) / recovery.
- **Transporte de hoy** — `getArrangementForDate(today)`: active cars, trips per car,
  total trips, unassigned pool.

---

## 5. Region detail

### 5.1 Hero — Ingresos vs Gastos
- **Chart**: grouped bars (verde = ingresos, rojo = gastos) per month + margin line overlay.
- **Controls**:
  1. Rango: `6M | 12M | 24M | Año`
  2. Base: `Previsto | Cobrado` (default Previsto)
  3. IVA: `Con IVA | Sin IVA` (default Sin IVA)
  4. Tipo: barras | líneas
  5. Series on/off chips: Asistencia, Transporte, Gastos, Sueldos, Margen
     (Asistencia+Transporte collapse into one "Ingresos" bar when both on; split when toggled)
- **Interaction**: hover → tooltip (per-month breakdown); click a month → dashboard
  navigates to that month (drives KPIs + billing panel + daily summaries).
- **Charting**: pure CSS/SVG bars (consistent with current no-new-lib approach), or a
  lightweight chart lib if justified — decide in the plan.

### 5.2 KPI row (5 cards, delta vs previous month)
1. **Ingreso previsto** — total chargeable (net, respects IVA toggle)
2. **Cobrado** — paid_amount, with "X% del previsto"
3. **Gastos** — devengados (incl. sueldos)
4. **Margen** — ingreso − gastos
5. **Tasa de cobro** — cobrado / previsto, color-graded; secondary: "N vencidas"

Deltas computed against the prior month from the same series.

### 5.3 Facturación & cobranza (main column)
Actionable list of the selected month's invoices (`invoices_view`).
- Per row: avatar · nombre · chip de cobranza (Cobrada / Pendiente / Vencida) ·
  chip de factura (Facturada / Sin factura) · monto · acción.
- **Two independent actions** (collection precedes invoicing):
  - **Cobrar** → `markMonthPaid` (register payment)
  - **Facturar** → emit Biller e-invoice (`emitInvoice` / `markMonthInvoiced`)
- **Header bulk action**: "Facturar el mes" (existing bulk emission flow, with the
  Biller 1 req/s rate limit and per-client readiness states: sin CI / sin plan / monto 0 / listo).
- Sort: vencidas → pendientes → listas; footer "ver los N clientes".

### 5.4 Turnos de hoy (right rail)
- Counts by shift: mañana / tarde / día completo.
- Presentes / planificados, faltas (justif. vs injust.), recuperos del día.
- Empty state when no schedule today (e.g., weekend).

### 5.5 Transporte de hoy (right rail)
- Autos activos, viajes totales, sin asignar.
- Per-car breakdown (color dot · nombre · viajes), matching transport module colors.
- Links to `/transporte` for the full board.

---

## 6. Permissions & scope

- The financial regions (hero, KPIs, billing panel) are **superadmin-only**, gated by
  `hasAccess('dashboard_financials')`, consistent with existing RLS on `monthly_invoices`
  / `plan_pricing` and `FEATURE_ROLES`.
- Daily summaries (turnos, transporte) are operational and may show for all roles —
  **decide in the plan** whether non-superadmin sees a reduced dashboard or is redirected.
- All billing/collection RPCs already enforce role via RLS.

---

## 7. Open items to resolve in planning

1. **Expenses IVA**: income has net/gross; `expenses` do not. For a clean net margin we
   either (a) treat expenses as-stored (gross) and accept a slight margin asymmetry, or
   (b) derive expense net. Recommendation: **(a)** for v1, note it in the UI tooltip.
2. **Charting approach**: CSS/SVG vs a small lib (e.g. for the margin line + tooltips).
3. **Salary monthlyization cost**: computing per-month salaries client-side over 24 months
   — verify performance with the real employee count (likely trivial).
4. **Non-superadmin view**: reduced dashboard vs redirect.

## 8. Out of scope (v1)

- Separate transport invoicing (transport remains a bundled component).
- Exportable reports, payment-due notifications, audit history.
- Editing planned days from the dashboard.
