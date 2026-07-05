# Costs Module Overhaul — Design

**Date:** 2026-07-05
**Status:** Approved (design)

## Goal

Rework the "Proveedores y Gastos" module into a **Costos** module:

- Rename the tab/section from "Proveedores" to "Costos".
- Replace expense types `recurring`/`extraordinary` with **fijos** (fixed) and **variables** (variable).
- Remove payment status (`pending`/`paid`) entirely — too much operational overhead.
- Fixed expenses are **recurring templates** with a selectable payment periodicity
  (mensual, bimestral, trimestral, cuatrimestral, semestral, anual). They impact the
  dashboard chart at their real payment cadence (cash), but are **monthlyized** in
  per-month cost KPIs.
- Add **custom expense categories** with a name + description, managed via CRUD.
- Suppliers survive as an optional secondary directory; category moves onto the expense.

## Decisions (from brainstorming)

1. **Suppliers:** kept, optional. An expense may link a supplier, but the meaningful
   classification is the expense **category**. Suppliers become a secondary directory.
2. **Fixed expense entry:** **template model** — defined once (amount + periodicity +
   start), the system derives which months it hits (cash) and monthlyizes automatically.
3. **Dashboard split:** month-over-month chart shows **cash** (fixed expense lands fully
   in its payment month); KPI cards for per-month cost use the **monthlyized** value.
   Salaries stay monthlyized in both (unchanged, existing behavior).
4. **Categories:** global editable list (CRUD) with **name + description**, seeded with
   the 10 categories below. Only used for expenses; the supplier form keeps its existing
   hardcoded `SUPPLIER_CATEGORIES`.

### Seed categories (`expense_categories`)

| name | description |
|---|---|
| Impuestos y cargas fiscales | Tributos, Saneamiento, Primaria, Comercio |
| Servicios básicos | Energía, agua, conectividad |
| Alimentación | Insumos alimentarios de los usuarios |
| Mantenimiento e higiene del local | Edificio, jardín, limpieza, ambientación |
| Seguros y cobertura médica | BSE, SEMM |
| Tecnología y software | Suscripciones y sistemas |
| Vehículo | Todo lo de la H1 como centro de costo |
| Personal - beneficios | Uniformes, regalos, gift cards |
| Administración y financieros | Papelería, comisiones, publicidad, varios |
| Actividades y equipamiento terapéutico | Fungibles de talleres, reposición de equipamiento y ayudas técnicas |

## Data model — migration `036_costs_overhaul.sql`

### New table `expense_categories`
```
id           UUID PK
name         TEXT NOT NULL UNIQUE
description  TEXT
created_at   TIMESTAMPTZ DEFAULT NOW()
```
Seeded with the 10 rows above.

### New table `fixed_expenses` (recurring templates)
```
id            UUID PK
description   TEXT NOT NULL
category_id   UUID REFERENCES expense_categories(id) ON DELETE SET NULL
supplier_id   UUID REFERENCES suppliers(id) ON DELETE SET NULL   -- optional
amount        NUMERIC(12,2) NOT NULL     -- amount PER PAYMENT (not monthly)
period_months INT NOT NULL CHECK (period_months IN (1,2,3,4,6,12))
start_year    INT NOT NULL
start_month   INT NOT NULL CHECK (start_month BETWEEN 0 AND 11)  -- first payment; anchors phase
end_year      INT                        -- optional (contract ended)
end_month     INT CHECK (end_month BETWEEN 0 AND 11)
notes         TEXT
created_at    TIMESTAMPTZ DEFAULT NOW()
updated_at    TIMESTAMPTZ DEFAULT NOW()
```

### Table `expenses` (now "variable" / one-off)
- ADD `category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL`
- DROP `status`, `paid_at` (no payment status)
- DROP `type` (all remaining rows are variable; fixed lives in its own table)
- Existing rows are preserved as historical variable expenses.

### RLS
`expense_categories` and `fixed_expenses` mirror the current `expenses`/`suppliers`
policies: `is_authenticated()` for SELECT/INSERT/UPDATE/DELETE (all three roles).

### Views
- `expenses_view`: drop `status`/`paidAt`, add `category_id` (+ joined category name).
- New `fixed_expenses_view`: templates + joined category/supplier names.

### Cleanup
- DROP FUNCTION `get_expenses_summary` (dead code — never called by the UI).
- `get_dashboard_finance_series` keeps its signature; its `expenses_total` now sums the
  (variable-only) `expenses` table. No RPC change beyond that being implicit.

## Service layer

- **New** `src/services/expenseCategories/expenseCategoryService.js`:
  `getCategories`, `createCategory`, `updateCategory`, `deleteCategory`.
- **New** `src/services/expenses/fixedExpenseService.js`:
  `getFixedExpenses`, `createFixedExpense`, `updateFixedExpense`, `deleteFixedExpense`.
- **New** `src/services/expenses/fixedExpenseCalc.js` (pure, mirrors `salaryCalc.js`):
  - `PERIODICITY_OPTIONS` = [{months:1,label:'Mensual'}, {2,'Bimestral'}, {3,'Trimestral'},
    {4,'Cuatrimestral'}, {6,'Semestral'}, {12,'Anual'}]
  - `hitsMonth(tpl, year, month)` → boolean. True when the month is within
    `[start, end]` and `((year*12+month) - (start_year*12+start_month)) % period_months === 0`.
  - `fixedCashForMonth(tpls, year, month)` → Σ `amount` of templates hitting that month.
  - `fixedMonthlyForMonth(tpls, year, month)` → Σ `amount / period_months` of templates
    active that month (within `[start, end]`).
  - `nextPayment(tpl, year, month)` → next occurrence ≥ (year, month), for UI display.
  - Unit tests for `fixedExpenseCalc`.
- **Modify** `src/services/expenses/expenseService.js`: add `category_id`; remove
  `status`/`markExpenseAsPaid`/`getExpensesSummary`.
- **Modify** `src/services/api.js`: re-export new services, drop removed exports.

## Dashboard integration

- `src/services/dashboard/financeSeries.js`:
  - `mergeFinanceSeries(rpcRows, employees, fixedExpenses)` — each row gains
    `variableExpenses` (from RPC `expenses_total`), `fixedCash`, `fixedMonthly`,
    `salaries` (unchanged).
  - `selectExpensesTotal(row, { fixedBasis = 'cash' } = {})` →
    `variableExpenses + (fixedBasis === 'cash' ? fixedCash : fixedMonthly) + salaries`.
  - Chart calls with `fixedBasis: 'cash'`; `deriveKpis` / KPI cards with `fixedBasis: 'monthly'`.
- `src/pages/Dashboard/Dashboard.jsx`: fetch fixed-expense templates alongside employees,
  pass into `mergeFinanceSeries`.
- Update `src/services/dashboard/financeSeries.test.js` for the new signature/fields.

## Costs page UI

- Route `/proveedores` → `/costos`; Navbar label "Proveedores" → "Costos".
- File `src/pages/Suppliers/SupplierList.jsx` → `src/pages/Costs/CostsPage.jsx`
  (update `App.js` import/route).
- Header buttons: **Categorías** (open manager) · **Gasto fijo** · **Gasto variable**.
- Month selector unchanged.
- Summary cards: Total del mes (cash = variable this month + fixed hitting this month) ·
  Gastos fijos (impacto este mes) · Gastos variables (este mes) · Fijos mensualizado (reference).
- Two columns:
  - **Gastos fijos** — all templates (not month-filtered). Each card: description,
    category badge, periodicity badge, amount/payment + monthlyized, next payment,
    a marker when it hits the selected month. Edit/Delete.
  - **Gastos variables** — this month's one-offs. Card: description, category, amount,
    date, optional supplier. Edit/Delete. No paid/pending UI.
- Section "Proveedores (directorio)" — secondary, relabeled. Salaries section unchanged
  (superadmin only).
- Modals: `FixedExpenseModal` (description, category select, supplier optional, amount,
  periodicity, start month/year, optional end, notes), `VariableExpenseModal`
  (description, category, supplier optional, amount, date, notes), `CategoryManagerModal`
  (list + create/edit/delete with name + description). `SupplierModal` unchanged.
- Remove `markExpenseAsPaid` handler, paid/pending badges, "Pendiente de pago" card.

## Rollout notes

- Existing `expenses` rows (any old type) are preserved as variable expenses; the user
  re-creates fixed templates manually (early-stage data volume is low).
- Recompile Tailwind after style changes:
  `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.
- No changes to the transport / invoices / salaries subsystems.

## Out of scope

- Migrating old `recurring` rows into `fixed_expenses` automatically.
- Supplier categories using the new `expense_categories` list.
- Transport-expense linkage.
