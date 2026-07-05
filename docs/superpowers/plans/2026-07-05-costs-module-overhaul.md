# Costs Module Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the "Proveedores y Gastos" module into a "Costos" module with fixed (recurring, periodicity-based, auto-monthlyized) and variable expenses, no payment status, and CRUD custom expense categories.

**Architecture:** New `expense_categories` and `fixed_expenses` tables; `expenses` repurposed as variable-only. Fixed-expense cash/monthlyized math lives in a pure JS module (mirrors `salaryCalc`) and is merged into the dashboard finance series client-side — chart uses cash, KPIs use monthlyized. UI is a rebuilt Costs page with three modals.

**Tech Stack:** React 19, Supabase (PostgreSQL + RLS), CRACO/Jest, Tailwind (manual compile).

**Spec:** `docs/superpowers/specs/2026-07-05-costs-module-overhaul-design.md`

**Branch:** `feat/costs-module-overhaul` (already created).

**Conventions:** Variables/code in English, UI text in Spanish, no semicolons in JS/JSX. Run a single test file with `CI=true npx craco test <path> --watchAll=false`.

---

## File Structure

- Create: `supabase/migrations/036_costs_overhaul.sql` — schema, seed, RLS, views, drop dead fn
- Create: `src/services/expenseCategories/expenseCategoryService.js` — categories CRUD
- Create: `src/services/expenses/fixedExpenseCalc.js` — pure periodicity math
- Create: `src/services/expenses/fixedExpenseCalc.test.js` — unit tests
- Create: `src/services/expenses/fixedExpenseService.js` — fixed-expense CRUD
- Modify: `src/services/expenses/expenseService.js` — add category, drop status/paid/summary
- Modify: `src/services/api.js` — re-exports
- Modify: `src/services/dashboard/financeSeries.js` — fixed cash/monthly split
- Modify: `src/services/dashboard/financeSeries.test.js` — new fields/signature
- Modify: `src/services/dashboard/dashboardService.js` — fetch + pass fixed expenses
- Modify: `src/pages/Dashboard/MonthlyFinanceChart.jsx` — cash-basis expenses
- Create: `src/pages/Costs/CostsPage.jsx` — rebuilt page (replaces SupplierList)
- Delete: `src/pages/Suppliers/SupplierList.jsx`
- Modify: `src/App.js` — route `/costos`
- Modify: `src/components/Layout/Navbar.jsx` — label "Costos", path `/costos`

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/036_costs_overhaul.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 036_costs_overhaul.sql
-- Costs module overhaul: custom expense categories, fixed-expense templates,
-- expenses become variable-only (no payment status). Drops dead summary fn.

-- 1. Expense categories (global, editable) --------------------------------
CREATE TABLE expense_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO expense_categories (name, description) VALUES
  ('Impuestos y cargas fiscales', 'Tributos, Saneamiento, Primaria, Comercio'),
  ('Servicios básicos', 'Energía, agua, conectividad'),
  ('Alimentación', 'Insumos alimentarios de los usuarios'),
  ('Mantenimiento e higiene del local', 'Edificio, jardín, limpieza, ambientación'),
  ('Seguros y cobertura médica', 'BSE, SEMM'),
  ('Tecnología y software', 'Suscripciones y sistemas'),
  ('Vehículo', 'Todo lo de la H1 como centro de costo'),
  ('Personal - beneficios', 'Uniformes, regalos, gift cards'),
  ('Administración y financieros', 'Papelería, comisiones, publicidad, varios'),
  ('Actividades y equipamiento terapéutico', 'Fungibles de talleres, reposición de equipamiento y ayudas técnicas');

-- 2. Fixed expenses (recurring templates) --------------------------------
CREATE TABLE fixed_expenses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  description   TEXT NOT NULL,
  category_id   UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  supplier_id   UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  amount        NUMERIC(12,2) NOT NULL,
  period_months INT NOT NULL CHECK (period_months IN (1,2,3,4,6,12)),
  start_year    INT NOT NULL,
  start_month   INT NOT NULL CHECK (start_month BETWEEN 0 AND 11),
  end_year      INT,
  end_month     INT CHECK (end_month BETWEEN 0 AND 11),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. expenses -> variable-only -------------------------------------------
-- expenses_view depends on status/paid_at, so drop it before dropping columns
-- (CREATE OR REPLACE VIEW cannot remove columns). Recreated in step 5.
DROP VIEW IF EXISTS expenses_view;
ALTER TABLE expenses ADD COLUMN category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL;
ALTER TABLE expenses DROP COLUMN IF EXISTS status;
ALTER TABLE expenses DROP COLUMN IF EXISTS paid_at;
ALTER TABLE expenses DROP COLUMN IF EXISTS type;

-- 4. RLS: mirror expenses/suppliers (any authenticated) ------------------
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expense categories viewable by authenticated"   ON expense_categories FOR SELECT USING (is_authenticated());
CREATE POLICY "Expense categories insertable by authenticated" ON expense_categories FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Expense categories updatable by authenticated"  ON expense_categories FOR UPDATE USING (is_authenticated());
CREATE POLICY "Expense categories deletable by authenticated"  ON expense_categories FOR DELETE USING (is_authenticated());

CREATE POLICY "Fixed expenses viewable by authenticated"   ON fixed_expenses FOR SELECT USING (is_authenticated());
CREATE POLICY "Fixed expenses insertable by authenticated" ON fixed_expenses FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Fixed expenses updatable by authenticated"  ON fixed_expenses FOR UPDATE USING (is_authenticated());
CREATE POLICY "Fixed expenses deletable by authenticated"  ON fixed_expenses FOR DELETE USING (is_authenticated());

-- 5. Views ----------------------------------------------------------------
CREATE VIEW expenses_view AS
SELECT
  e.id,
  e.supplier_id AS "supplierId",
  e.category_id AS "categoryId",
  c.name        AS "categoryName",
  e.description,
  e.amount,
  e.year,
  e.month,
  e.date::TEXT AS date,
  e.notes,
  e.created_at AS "createdAt",
  e.updated_at AS "updatedAt"
FROM expenses e
LEFT JOIN expense_categories c ON c.id = e.category_id;

CREATE OR REPLACE VIEW fixed_expenses_view AS
SELECT
  f.id,
  f.description,
  f.category_id   AS "categoryId",
  c.name          AS "categoryName",
  f.supplier_id   AS "supplierId",
  s.name          AS "supplierName",
  f.amount,
  f.period_months AS "periodMonths",
  f.start_year    AS "startYear",
  f.start_month   AS "startMonth",
  f.end_year      AS "endYear",
  f.end_month     AS "endMonth",
  f.notes,
  f.created_at    AS "createdAt",
  f.updated_at    AS "updatedAt"
FROM fixed_expenses f
LEFT JOIN expense_categories c ON c.id = f.category_id
LEFT JOIN suppliers s ON s.id = f.supplier_id;

-- 6. Drop dead code -------------------------------------------------------
DROP FUNCTION IF EXISTS get_expenses_summary(INTEGER, INTEGER);
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool with name `036_costs_overhaul` and the SQL above. (The project applies migrations to the remote project — there is no local DB.)

- [ ] **Step 3: Verify**

Run `mcp__supabase__list_tables` (or `execute_sql`: `SELECT name, description FROM expense_categories ORDER BY name;`).
Expected: `expense_categories` has 10 rows, `fixed_expenses` exists, `expenses` no longer has `status`/`paid_at`/`type` and has `category_id`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/036_costs_overhaul.sql
git commit -m "feat(costs): migración 036 — categorías, gastos fijos, expenses variable-only"
```

---

## Task 2: Pure fixed-expense math (`fixedExpenseCalc`)

**Files:**
- Create: `src/services/expenses/fixedExpenseCalc.js`
- Test: `src/services/expenses/fixedExpenseCalc.test.js`

- [ ] **Step 1: Write the failing test**

```js
import {
  PERIODICITY_OPTIONS,
  periodicityLabel,
  isActive,
  hitsMonth,
  fixedCashForMonth,
  fixedMonthlyForMonth,
  nextPayment
} from './fixedExpenseCalc'

// Semestral $60000 starting Jan 2026 (month 0), no end.
const semestral = { amount: 60000, periodMonths: 6, startYear: 2026, startMonth: 0, endYear: null, endMonth: null }
// Monthly $1000 from Mar 2026 (month 2) to May 2026 (month 4).
const monthlyBounded = { amount: 1000, periodMonths: 1, startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 4 }

describe('PERIODICITY_OPTIONS / periodicityLabel', () => {
  test('has the six options', () => {
    expect(PERIODICITY_OPTIONS.map(o => o.months)).toEqual([1, 2, 3, 4, 6, 12])
  })
  test('label lookup', () => {
    expect(periodicityLabel(6)).toBe('Semestral')
    expect(periodicityLabel(1)).toBe('Mensual')
  })
})

describe('isActive', () => {
  test('false before start', () => {
    expect(isActive(semestral, 2025, 11)).toBe(false)
  })
  test('true at/after start with no end', () => {
    expect(isActive(semestral, 2026, 0)).toBe(true)
    expect(isActive(semestral, 2030, 5)).toBe(true)
  })
  test('respects end', () => {
    expect(isActive(monthlyBounded, 2026, 4)).toBe(true)
    expect(isActive(monthlyBounded, 2026, 5)).toBe(false)
  })
})

describe('hitsMonth', () => {
  test('semestral hits Jan and Jul 2026, not Feb', () => {
    expect(hitsMonth(semestral, 2026, 0)).toBe(true)
    expect(hitsMonth(semestral, 2026, 6)).toBe(true)
    expect(hitsMonth(semestral, 2026, 1)).toBe(false)
  })
  test('does not hit before start even on phase', () => {
    expect(hitsMonth(semestral, 2025, 6)).toBe(false)
  })
})

describe('fixedCashForMonth', () => {
  test('full amount only on payment month', () => {
    expect(fixedCashForMonth([semestral], 2026, 0)).toBe(60000)
    expect(fixedCashForMonth([semestral], 2026, 1)).toBe(0)
  })
  test('sums multiple templates', () => {
    expect(fixedCashForMonth([semestral, monthlyBounded], 2026, 2)).toBe(1000)
  })
})

describe('fixedMonthlyForMonth', () => {
  test('monthlyizes active templates', () => {
    expect(fixedMonthlyForMonth([semestral], 2026, 1)).toBe(10000)
    expect(fixedMonthlyForMonth([semestral], 2025, 11)).toBe(0)
  })
  test('sums active templates, ignores inactive', () => {
    expect(fixedMonthlyForMonth([semestral, monthlyBounded], 2026, 3)).toBe(11000)
    expect(fixedMonthlyForMonth([semestral, monthlyBounded], 2026, 5)).toBe(10000)
  })
})

describe('nextPayment', () => {
  test('returns the next occurrence on/after the given month', () => {
    expect(nextPayment(semestral, 2026, 1)).toEqual({ year: 2026, month: 6 })
    expect(nextPayment(semestral, 2026, 6)).toEqual({ year: 2026, month: 6 })
  })
  test('null when past end', () => {
    expect(nextPayment(monthlyBounded, 2026, 5)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx craco test src/services/expenses/fixedExpenseCalc.test.js --watchAll=false`
Expected: FAIL — cannot find module `./fixedExpenseCalc`.

- [ ] **Step 3: Write the implementation**

```js
// Pure math for fixed-expense templates. Mirrors salaryCalc's style.
// A template: { amount, periodMonths, startYear, startMonth, endYear, endMonth }.

export const PERIODICITY_OPTIONS = [
  { months: 1, label: 'Mensual' },
  { months: 2, label: 'Bimestral' },
  { months: 3, label: 'Trimestral' },
  { months: 4, label: 'Cuatrimestral' },
  { months: 6, label: 'Semestral' },
  { months: 12, label: 'Anual' }
]

export function periodicityLabel(months) {
  const opt = PERIODICITY_OPTIONS.find(o => o.months === months)
  return opt ? opt.label : `Cada ${months} meses`
}

// Absolute month index (year*12 + month).
const idx = (year, month) => year * 12 + month

export function isActive(tpl, year, month) {
  const t = idx(year, month)
  if (t < idx(tpl.startYear, tpl.startMonth)) return false
  if (tpl.endYear != null && tpl.endMonth != null && t > idx(tpl.endYear, tpl.endMonth)) return false
  return true
}

export function hitsMonth(tpl, year, month) {
  if (!isActive(tpl, year, month)) return false
  const diff = idx(year, month) - idx(tpl.startYear, tpl.startMonth)
  return diff % tpl.periodMonths === 0
}

export function fixedCashForMonth(tpls, year, month) {
  return (tpls || []).reduce(
    (sum, t) => sum + (hitsMonth(t, year, month) ? Number(t.amount) : 0),
    0
  )
}

export function fixedMonthlyForMonth(tpls, year, month) {
  return (tpls || []).reduce(
    (sum, t) => sum + (isActive(t, year, month) ? Number(t.amount) / t.periodMonths : 0),
    0
  )
}

// Next occurrence on/after (year, month); null if past end.
export function nextPayment(tpl, year, month) {
  const start = idx(tpl.startYear, tpl.startMonth)
  let t = Math.max(idx(year, month), start)
  const rem = (t - start) % tpl.periodMonths
  const occ = rem === 0 ? t : t + (tpl.periodMonths - rem)
  if (tpl.endYear != null && tpl.endMonth != null && occ > idx(tpl.endYear, tpl.endMonth)) return null
  return { year: Math.floor(occ / 12), month: occ % 12 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx craco test src/services/expenses/fixedExpenseCalc.test.js --watchAll=false`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/expenses/fixedExpenseCalc.js src/services/expenses/fixedExpenseCalc.test.js
git commit -m "feat(costs): fixedExpenseCalc — cash/mensualizado por periodicidad"
```

---

## Task 3: Expense categories service

**Files:**
- Create: `src/services/expenseCategories/expenseCategoryService.js`

- [ ] **Step 1: Write the service**

```js
import { supabase } from '../supabase/client'

// Get all expense categories (name + description), alphabetical.
export async function getCategories() {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(transformCategory)
}

export async function createCategory({ name, description }) {
  const { data, error } = await supabase
    .from('expense_categories')
    .insert({ name, description: description || null })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return transformCategory(data)
}

export async function updateCategory(id, { name, description }) {
  const update = {}
  if (name !== undefined) update.name = name
  if (description !== undefined) update.description = description
  const { data, error } = await supabase
    .from('expense_categories')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return transformCategory(data)
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('expense_categories').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

function transformCategory(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/expenseCategories/expenseCategoryService.js
git commit -m "feat(costs): expenseCategoryService (CRUD categorías)"
```

---

## Task 4: Fixed-expense service

**Files:**
- Create: `src/services/expenses/fixedExpenseService.js`

- [ ] **Step 1: Write the service**

```js
import { supabase } from '../supabase/client'

// Read from the view (already camelCase + joined names).
export async function getFixedExpenses() {
  const { data, error } = await supabase
    .from('fixed_expenses_view')
    .select('*')
    .order('description', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(normalizeAmounts)
}

export async function createFixedExpense(input) {
  const { data, error } = await supabase
    .from('fixed_expenses')
    .insert(toRow(input))
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateFixedExpense(id, input) {
  const { data, error } = await supabase
    .from('fixed_expenses')
    .update(toRow(input))
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteFixedExpense(id) {
  const { error } = await supabase.from('fixed_expenses').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

function toRow(input) {
  return {
    description: input.description,
    category_id: input.categoryId || null,
    supplier_id: input.supplierId || null,
    amount: input.amount,
    period_months: input.periodMonths,
    start_year: input.startYear,
    start_month: input.startMonth,
    end_year: input.endYear ?? null,
    end_month: input.endMonth ?? null,
    notes: input.notes || null
  }
}

function normalizeAmounts(row) {
  return { ...row, amount: Number(row.amount) }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/expenses/fixedExpenseService.js
git commit -m "feat(costs): fixedExpenseService (CRUD plantillas fijas)"
```

---

## Task 5: Update variable-expense service

**Files:**
- Modify: `src/services/expenses/expenseService.js`

- [ ] **Step 1: Replace the file contents**

Replace the entire file with the version below (adds `category`, removes `status`/`markExpenseAsPaid`/`getExpensesSummary`):

```js
import { supabase } from '../supabase/client'

// All variable expenses (most recent first).
export async function getExpenses() {
  const { data, error } = await supabase
    .from('expenses_view')
    .select('*')
    .order('date', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

// Variable expenses for a 0-indexed month.
export async function getExpensesByMonth(year, month) {
  const { data, error } = await supabase
    .from('expenses_view')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .order('date', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

export async function createExpense(expenseData) {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      supplier_id: expenseData.supplierId || null,
      category_id: expenseData.categoryId || null,
      description: expenseData.description,
      amount: expenseData.amount,
      year: expenseData.year,
      month: expenseData.month,
      date: expenseData.date,
      notes: expenseData.notes || null
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return transformExpense(data)
}

export async function updateExpense(id, expenseData) {
  const updateData = {}
  if (expenseData.supplierId !== undefined) updateData.supplier_id = expenseData.supplierId || null
  if (expenseData.categoryId !== undefined) updateData.category_id = expenseData.categoryId || null
  if (expenseData.description !== undefined) updateData.description = expenseData.description
  if (expenseData.amount !== undefined) updateData.amount = expenseData.amount
  if (expenseData.year !== undefined) updateData.year = expenseData.year
  if (expenseData.month !== undefined) updateData.month = expenseData.month
  if (expenseData.date !== undefined) updateData.date = expenseData.date
  if (expenseData.notes !== undefined) updateData.notes = expenseData.notes

  const { data, error } = await supabase
    .from('expenses')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return transformExpense(data)
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

function transformExpense(expense) {
  return {
    id: expense.id,
    supplierId: expense.supplier_id,
    categoryId: expense.category_id,
    description: expense.description,
    amount: Number(expense.amount),
    year: expense.year,
    month: expense.month,
    date: expense.date,
    notes: expense.notes
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/expenses/expenseService.js
git commit -m "feat(costs): expenses variable-only (categoría, sin estado de pago)"
```

---

## Task 6: Update the api.js facade

**Files:**
- Modify: `src/services/api.js`

- [ ] **Step 1: Inspect current expense/supplier exports**

Run: `grep -n "expense\|Expense\|Supplier\|SUPPLIER" src/services/api.js`
Note the exact import/export lines for `markExpenseAsPaid`, `getExpensesSummary`, and expense service.

- [ ] **Step 2: Remove dropped exports, add new services**

- Remove any import/export of `markExpenseAsPaid` and `getExpensesSummary` from the expense service block.
- Add these export blocks (place near the other service re-exports):

```js
export {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory
} from './expenseCategories/expenseCategoryService'

export {
  getFixedExpenses,
  createFixedExpense,
  updateFixedExpense,
  deleteFixedExpense
} from './expenses/fixedExpenseService'

export {
  PERIODICITY_OPTIONS,
  periodicityLabel,
  hitsMonth,
  fixedCashForMonth,
  fixedMonthlyForMonth,
  nextPayment
} from './expenses/fixedExpenseCalc'
```

- [ ] **Step 3: Verify no dangling references compile-break**

Run: `grep -rn "markExpenseAsPaid\|getExpensesSummary" src/`
Expected: no results outside of git history (the old `SupplierList.jsx` still references `markExpenseAsPaid`; that's fine — it is deleted in Task 11. If Task 11 is not yet done, this grep will show `SupplierList.jsx` — acceptable until then).

- [ ] **Step 4: Commit**

```bash
git add src/services/api.js
git commit -m "feat(costs): facade — categorías + gastos fijos, sin markExpenseAsPaid/summary"
```

---

## Task 7: Dashboard finance series — cash vs monthlyized

**Files:**
- Modify: `src/services/dashboard/financeSeries.js`
- Modify: `src/services/dashboard/financeSeries.test.js`

- [ ] **Step 1: Update the test file**

At the top of `financeSeries.test.js`, add the import and a fixed-expense fixture, and update the expense-selector tests. Add this import after the existing imports:

```js
import { fixedCashForMonth } from '../expenses/fixedExpenseCalc'
```

Then update the `mergeFinanceSeries` and selector tests to the following (replace the existing `describe('mergeFinanceSeries'...)` and the selector assertions that use `selectExpensesTotal`/`selectMargin`):

```js
const semestral = { amount: 6000, periodMonths: 6, startYear: 2026, startMonth: 0, endYear: null, endMonth: null }

describe('mergeFinanceSeries', () => {
  test('maps rpc rows to variable/fixed/salary fields', () => {
    const out = mergeFinanceSeries([rpcRow()], [], [semestral])
    expect(out[0].variableExpenses).toBe(300)
    expect(out[0].salaries).toBe(0)
    // rpcRow default month is 5 (Jun) -> not a semestral hit; monthly = 1000
    expect(out[0].fixedCash).toBe(0)
    expect(out[0].fixedMonthly).toBe(1000)
  })
  test('fixed cash lands on the payment month', () => {
    const out = mergeFinanceSeries([rpcRow({ month: 0 })], [], [semestral])
    expect(out[0].fixedCash).toBe(6000)
    expect(out[0].fixedMonthly).toBe(1000)
  })
})

describe('expense selectors', () => {
  const row = mergeFinanceSeries([rpcRow({ month: 0 })], [], [semestral])[0]
  test('cash basis includes fixedCash (default)', () => {
    expect(selectExpensesTotal({ ...row, salaries: 50 })).toBe(300 + 6000 + 50)
  })
  test('monthly basis includes fixedMonthly', () => {
    expect(selectExpensesTotal({ ...row, salaries: 50 }, { fixedBasis: 'monthly' })).toBe(300 + 1000 + 50)
  })
  test('margin uses the same fixed basis', () => {
    expect(selectMargin({ ...row, salaries: 50 }, { basis: 'previsto', withIva: false, fixedBasis: 'monthly' }))
      .toBe(1200 - (300 + 1000 + 50))
  })
})
```

Note: the existing `rpcRow` helper already sets `expenses_total: 300` by default (verify — if its default differs, adjust the numbers above to match). Confirm `rpcRow` default `att_net`/`trans_net` sum to 1200 for the margin test.

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx craco test src/services/dashboard/financeSeries.test.js --watchAll=false`
Expected: FAIL — `mergeFinanceSeries` ignores the 3rd arg; `variableExpenses`/`fixedCash` undefined.

- [ ] **Step 3: Update `financeSeries.js`**

Replace the `mergeFinanceSeries`, `selectExpensesTotal`, `selectMargin`, and `deriveKpis` functions with:

```js
import { fixedCashForMonth, fixedMonthlyForMonth } from '../expenses/fixedExpenseCalc'
```
(add at top, alongside the existing salaryCalc import)

```js
// Raw RPC rows + employees + fixed-expense templates → UI-ready month objects.
export function mergeFinanceSeries(rpcRows, employees, fixedExpenses = []) {
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
    variableExpenses: Number(r.expenses_total) || 0,
    fixedCash: fixedCashForMonth(fixedExpenses, r.year, r.month),
    fixedMonthly: fixedMonthlyForMonth(fixedExpenses, r.year, r.month),
    salaries: salaryCostForMonth(employees, r.year, r.month)
  }))
}
```

```js
// Variable + fixed (basis-dependent), WITHOUT salaries.
export function selectExpensesOnly(row, { fixedBasis = 'cash' } = {}) {
  const fixed = fixedBasis === 'monthly' ? (row.fixedMonthly || 0) : (row.fixedCash || 0)
  return (row.variableExpenses || 0) + fixed
}

// Total monthly expenses = variable + fixed (basis) + monthlyized salaries.
export function selectExpensesTotal(row, opts = {}) {
  return selectExpensesOnly(row, opts) + (row.salaries || 0)
}

export function selectMargin(row, opts) {
  return selectIncome(row, opts) - selectExpensesTotal(row, opts)
}
```

In `deriveKpis`, change the expense/margin lines to use the monthlyized basis:

```js
  const gastos = selectExpensesTotal(cur, { ...opts, fixedBasis: 'monthly' })
```
```js
  const prevGastos = prev ? selectExpensesTotal(prev, { ...opts, fixedBasis: 'monthly' }) : null
```

(Leave `margen = ingresoPrevisto - gastos` as-is; it now uses the monthlyized `gastos`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx craco test src/services/dashboard/financeSeries.test.js --watchAll=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboard/financeSeries.js src/services/dashboard/financeSeries.test.js
git commit -m "feat(dashboard): gastos fijos cash vs mensualizado en la serie financiera"
```

---

## Task 8: Wire fixed expenses into the dashboard fetch + chart

**Files:**
- Modify: `src/services/dashboard/dashboardService.js`
- Modify: `src/pages/Dashboard/MonthlyFinanceChart.jsx`

- [ ] **Step 1: Fetch fixed expenses in `getDashboardFinanceSeries`**

At the top of `dashboardService.js`, add:
```js
import { getFixedExpenses } from '../expenses/fixedExpenseService'
```

Replace the body of `getDashboardFinanceSeries` (lines ~165-178) with:
```js
export async function getDashboardFinanceSeries(fromYear, fromMonth, toYear, toMonth) {
  const [seriesRes, employees, fixedExpenses] = await Promise.all([
    supabase.rpc('get_dashboard_finance_series', {
      p_from_year: fromYear,
      p_from_month: fromMonth,
      p_to_year: toYear,
      p_to_month: toMonth
    }),
    getEmployees().catch(() => []), // operador lacks salary access → empty
    getFixedExpenses().catch(() => []) // never throw the whole dashboard
  ])

  if (seriesRes.error) throw new Error(seriesRes.error.message)
  return mergeFinanceSeries(seriesRes.data || [], employees, fixedExpenses)
}
```

- [ ] **Step 2: Update the chart to use cash-basis expenses**

In `MonthlyFinanceChart.jsx`:

- Update the import (line 4) to add `selectExpensesOnly`:
```js
import { selectIncome, selectExpensesTotal, selectExpensesOnly, selectMargin } from '../../services/dashboard/financeSeries'
```

- Line ~127 — replace `row.expenses` with the cash-basis expenses:
```js
      (active.gastos ? selectExpensesOnly(row, { fixedBasis: 'cash' }) : 0) + (active.sueldos ? row.salaries : 0)
```

- Line ~249 — replace `const exp = active.gastos ? row.expenses : 0` with:
```js
                const exp = active.gastos ? selectExpensesOnly(row, { fixedBasis: 'cash' }) : 0
```

- Lines ~145-153 (margin path) — ensure `opts` carries cash basis. Just before the first `selectMargin` use, define a cash opts object and use it for margin + tooltip expenses:
```js
    const expOpts = { ...opts, fixedBasis: 'cash' }
```
Then use `expOpts` in the three `selectMargin(...)` calls (lines ~145, 146, 153) and the tooltip `selectExpensesTotal`/`selectMargin` (lines ~307, 308):
```js
    const margin = selectMargin(cur, expOpts)
    const delta = prev ? margin - selectMargin(prev, expOpts) : null
```
```js
    y: H - Math.min(H, Math.max(0, y(selectMargin(row, expOpts))))
```
```js
                  <TipRow color={COLORS.gastos} label="Gastos" value={formatCurrency(selectExpensesTotal(tipRow, { fixedBasis: 'cash' }))} />
                  <TipRow color={COLORS.margen} label="Margen" value={formatCurrency(selectMargin(tipRow, { ...opts, fixedBasis: 'cash' }))} />
```
(Note: if `expOpts` is out of scope at the tooltip render, use the inline `{ ...opts, fixedBasis: 'cash' }` as shown.)

- [ ] **Step 3: Verify build**

Run: `CI=true npx craco test src/services/dashboard/financeSeries.test.js --watchAll=false` (still passes) and start the app briefly (`npm start`) to confirm the Dashboard renders without console errors on the chart. Expected: chart renders; expense bars reflect cash (spikes on payment months).

- [ ] **Step 4: Commit**

```bash
git add src/services/dashboard/dashboardService.js src/pages/Dashboard/MonthlyFinanceChart.jsx
git commit -m "feat(dashboard): incluir gastos fijos (cash) en el gráfico"
```

---

## Task 9: Route + Navbar rename to "Costos"

**Files:**
- Modify: `src/components/Layout/Navbar.jsx:28`
- Modify: `src/App.js`

- [ ] **Step 1: Update the Navbar item**

Change line 28 from:
```js
    { to: '/proveedores', label: 'Proveedores', icon: Shop, access: 'suppliers' },
```
to:
```js
    { to: '/costos', label: 'Costos', icon: Shop, access: 'suppliers' },
```

- [ ] **Step 2: Update the route in App.js**

Run: `grep -n "proveedores\|SupplierList\|Suppliers" src/App.js`
Then:
- Change the import from `./pages/Suppliers/SupplierList` to `./pages/Costs/CostsPage` and rename the imported component to `CostsPage`.
- Change the route path from `/proveedores` to `/costos` and its element to `<CostsPage />`.

(If there is a redirect or link to `/proveedores` elsewhere, run `grep -rn "/proveedores" src/` and update each to `/costos`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Layout/Navbar.jsx src/App.js
git commit -m "feat(costs): ruta /costos y label Costos en el nav"
```

---

## Task 10: Costs page — scaffold, categories manager, suppliers, salaries

**Files:**
- Create: `src/pages/Costs/CostsPage.jsx`

This task creates the new page with: header + month selector, the **CategoryManagerModal**, the suppliers directory section (relabeled), and the salaries section (moved verbatim from the old file). Fixed/variable expense sections + their modals come in Task 11 — for this task, leave placeholders for those two columns so the page compiles and renders.

- [ ] **Step 1: Create the page skeleton**

Create `src/pages/Costs/CostsPage.jsx`. Start from the OLD `src/pages/Suppliers/SupplierList.jsx` and apply these changes:

1. Imports — replace the service import block with:
```js
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  SUPPLIER_CATEGORIES,
  getExpensesByMonth,
  createExpense,
  updateExpense,
  deleteExpense,
  getFixedExpenses,
  createFixedExpense,
  updateFixedExpense,
  deleteFixedExpense,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  PERIODICITY_OPTIONS,
  periodicityLabel,
  hitsMonth,
  nextPayment,
  fixedCashForMonth,
  fixedMonthlyForMonth,
  getEmployees,
  getStandaloneExtraCosts,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  addSalaryAdjustment,
  deleteSalaryAdjustment,
  addExtraCost,
  deleteExtraCost,
  EXTRA_COST_TYPES,
  extraCostLabel
} from '../../services/api'
```

2. Rename `export default function SupplierList()` → `export default function CostsPage()`.

3. Add state for categories + fixed expenses; remove paid-status logic:
```js
  const [categories, setCategories] = useState([])
  const [fixedExpenses, setFixedExpenses] = useState([])
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [fixedModal, setFixedModal] = useState({ open: false, item: null })
  const [variableModal, setVariableModal] = useState({ open: false, item: null })
```
Remove the old `expenseModal` state and `handleMarkPaid` handler.

4. In `loadData`, fetch the new data:
```js
      const [suppliersData, expensesData, fixedData, categoriesData] = await Promise.all([
        getSuppliers(),
        getExpensesByMonth(year, month),
        getFixedExpenses(),
        getCategories()
      ])
      setSuppliers(suppliersData)
      setExpenses(expensesData)
      setFixedExpenses(fixedData)
      setCategories(categoriesData)
```
(keep the `if (hasAccess('salaries'))` block unchanged.)

5. Remove the old `recurringExpenses`/`extraordinaryExpenses`/`totalPending` derivations and the old summary cards. Replace the header `<h1>` text `Proveedores y Gastos` → `Costos`, and the two header buttons with:
```js
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setCategoryModalOpen(true)}>
            Categorías
          </Button>
          <Button variant="secondary" onClick={() => setFixedModal({ open: true, item: null })}>
            <Plus className="w-4 h-4" />
            Gasto fijo
          </Button>
          <Button onClick={() => setVariableModal({ open: true, item: null })} className="bg-purple-600 hover:bg-purple-700">
            <Plus className="w-4 h-4" />
            Gasto variable
          </Button>
        </div>
```

6. Compute month totals for the summary cards (after `loadData`, in render scope):
```js
  const variableTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const fixedCashThisMonth = fixedCashForMonth(fixedExpenses, year, month)
  const fixedMonthlyThisMonth = fixedMonthlyForMonth(fixedExpenses, year, month)
  const totalCashMonth = variableTotal + fixedCashThisMonth
```

7. Replace the 4 summary cards with:
```js
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Total del mes (caja)</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalCashMonth)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Gastos fijos (impacto este mes)</p>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(fixedCashThisMonth)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Gastos variables</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(variableTotal)}</p>
          <p className="text-xs text-gray-400">{expenses.length} gastos</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Fijos mensualizado (ref.)</p>
          <p className="text-2xl font-bold text-gray-700">{formatCurrency(fixedMonthlyThisMonth)}</p>
        </Card>
      </div>
```

8. Temporarily replace the two-column expenses grid (old recurring/extraordinary block) with a placeholder so the file compiles:
```js
      {/* Fixed + variable columns — implemented in Task 11 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" />
```

9. Relabel the suppliers section heading from `Proveedores registrados (...)` to `Proveedores (directorio) (...)`. Keep the rest of the suppliers grid and the SupplierModal as-is.

10. Remove `<ExpenseModal .../>` usage and the old `ExpenseCard` component and `ExpenseModal` component definitions (they are replaced in Task 11). Remove the paid/status delete-modal wording is fine to keep generic.

11. Add the CategoryManagerModal render near the other modals:
```js
      <CategoryManagerModal
        isOpen={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        categories={categories}
        onChanged={loadData}
      />
```

12. Append the `CategoryManagerModal` component at the end of the file:
```jsx
function CategoryManagerModal({ isOpen, onClose, categories, onChanged }) {
  const [form, setForm] = useState({ id: null, name: '', description: '' })
  const [busy, setBusy] = useState(false)

  const reset = () => setForm({ id: null, name: '', description: '' })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (form.id) {
        await updateCategory(form.id, { name: form.name, description: form.description })
      } else {
        await createCategory({ name: form.name, description: form.description })
      }
      reset()
      onChanged()
    } catch (err) {
      alert('Error al guardar categoría: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('¿Eliminar esta categoría? Los gastos asociados quedarán sin categoría.')) return
    setBusy(true)
    try {
      await deleteCategory(id)
      if (form.id === id) reset()
      onChanged()
    } catch (err) {
      alert('Error al eliminar: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Categorías de gasto">
      <form onSubmit={submit} className="bg-gray-50 rounded-lg p-3 space-y-3 mb-4">
        <Input label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Qué incluye" />
        <div className="flex justify-end gap-2">
          {form.id && <Button type="button" variant="secondary" onClick={reset}>Cancelar edición</Button>}
          <Button type="submit" disabled={busy}>{form.id ? 'Guardar' : 'Agregar'}</Button>
        </div>
      </form>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {categories.map(c => (
          <div key={c.id} className="flex items-start justify-between border border-gray-100 rounded-lg px-3 py-2">
            <div className="flex-1 pr-2">
              <p className="font-medium text-gray-900">{c.name}</p>
              {c.description && <p className="text-xs text-gray-400">{c.description}</p>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setForm({ id: c.id, name: c.name, description: c.description || '' })} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                <Edit className="w-4 h-4" />
              </button>
              <button onClick={() => remove(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                <Trash className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Delete the old page**

```bash
git rm src/pages/Suppliers/SupplierList.jsx
```
(If the `Suppliers` folder is now empty, that is fine — leave it or remove it.)

- [ ] **Step 3: Verify it compiles/renders**

Run: `npm start`, navigate to `/costos`. Expected: page loads, header shows "Costos" with three buttons, summary cards compute, categories modal opens and can create/edit/delete a category, suppliers directory renders, salaries section renders for superadmin. The middle expenses area is an empty grid (placeholder).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Costs/CostsPage.jsx
git commit -m "feat(costs): página Costos — categorías CRUD, cards, directorio proveedores"
```

---

## Task 11: Costs page — fixed & variable expense lists and modals

**Files:**
- Modify: `src/pages/Costs/CostsPage.jsx`

- [ ] **Step 1: Add delete handlers for fixed/variable**

Ensure a single delete handler exists for variable expenses (`handleDeleteExpense` from the old file, still valid) and add a fixed-expense delete handler:
```js
  const handleDeleteFixed = async (id) => {
    if (!window.confirm('¿Eliminar este gasto fijo? Dejará de impactar en el dashboard.')) return
    try {
      await deleteFixedExpense(id)
      await loadData()
    } catch (e) {
      alert('Error al eliminar: ' + e.message)
    }
  }
```

- [ ] **Step 2: Replace the placeholder grid with the two real columns**

Replace the placeholder `<div className="grid grid-cols-1 lg:grid-cols-2 gap-6" />` from Task 10 with:
```jsx
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gastos fijos (plantillas) */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
            Gastos fijos
          </h3>
          {fixedExpenses.length === 0 ? (
            <Card className="p-6 text-center"><p className="text-gray-500">Sin gastos fijos</p></Card>
          ) : (
            <div className="space-y-3">
              {fixedExpenses.map(f => (
                <FixedExpenseCard
                  key={f.id}
                  fixed={f}
                  year={year}
                  month={month}
                  onEdit={() => setFixedModal({ open: true, item: f })}
                  onDelete={() => handleDeleteFixed(f.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Gastos variables (mes) */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-500"></span>
            Gastos variables
          </h3>
          {expenses.length === 0 ? (
            <Card className="p-6 text-center"><p className="text-gray-500">No hay gastos variables este mes</p></Card>
          ) : (
            <div className="space-y-3">
              {expenses.map(expense => (
                <VariableExpenseCard
                  key={expense.id}
                  expense={expense}
                  supplierName={suppliers.find(s => s.id === expense.supplierId)?.name}
                  onEdit={() => setVariableModal({ open: true, item: expense })}
                  onDelete={() => setDeleteModal({ open: true, type: 'expense', item: expense })}
                />
              ))}
            </div>
          )}
        </div>
      </div>
```

- [ ] **Step 3: Add the fixed/variable modals to the render**

Near the other modals:
```jsx
      <FixedExpenseModal
        isOpen={fixedModal.open}
        onClose={() => setFixedModal({ open: false, item: null })}
        fixed={fixedModal.item}
        categories={categories}
        suppliers={suppliers}
        onSave={loadData}
      />
      <VariableExpenseModal
        isOpen={variableModal.open}
        onClose={() => setVariableModal({ open: false, item: null })}
        expense={variableModal.item}
        categories={categories}
        suppliers={suppliers}
        selectedYear={year}
        selectedMonth={month}
        onSave={loadData}
      />
```

- [ ] **Step 4: Append the card + modal components**

```jsx
function FixedExpenseCard({ fixed, year, month, onEdit, onDelete }) {
  const hitsThis = hitsMonth(fixed, year, month)
  const next = nextPayment(fixed, year, month)
  const monthly = Number(fixed.amount) / fixed.periodMonths
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-gray-900">{fixed.description}</h4>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">{periodicityLabel(fixed.periodMonths)}</span>
            {fixed.categoryName && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{fixed.categoryName}</span>}
            {hitsThis && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Impacta este mes</span>}
          </div>
          {fixed.supplierName && <p className="text-sm text-gray-500 mt-1">{fixed.supplierName}</p>}
          {fixed.notes && <p className="text-xs text-gray-400 mt-1">{fixed.notes}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">{formatCurrency(Number(fixed.amount))}</p>
          <p className="text-xs text-gray-400">{formatCurrency(monthly)}/mes</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          {next ? `Próximo pago: ${format(new Date(next.year, next.month, 1), 'MMM yyyy', { locale: es })}` : 'Finalizado'}
        </p>
        <div className="flex gap-2">
          <button onClick={onEdit} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
          <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash className="w-4 h-4" /></button>
        </div>
      </div>
    </Card>
  )
}

function VariableExpenseCard({ expense, supplierName, onEdit, onDelete }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-gray-900">{expense.description}</h4>
            {expense.categoryName && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{expense.categoryName}</span>}
          </div>
          {supplierName && <p className="text-sm text-gray-500 mt-1">{supplierName}</p>}
          {expense.notes && <p className="text-xs text-gray-400 mt-1">{expense.notes}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">{formatCurrency(Number(expense.amount))}</p>
          <p className="text-xs text-gray-400">{format(new Date(expense.date), 'd MMM', { locale: es })}</p>
        </div>
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 justify-end">
        <button onClick={onEdit} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
        <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash className="w-4 h-4" /></button>
      </div>
    </Card>
  )
}

function CategorySelect({ value, onChange, categories }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
      <select
        value={value}
        onChange={onChange}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      >
        <option value="">Sin categoría</option>
        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  )
}

function SupplierSelect({ value, onChange, suppliers }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor (opcional)</label>
      <select
        value={value}
        onChange={onChange}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      >
        <option value="">Sin proveedor</option>
        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  )
}

function FixedExpenseModal({ isOpen, onClose, fixed, categories, suppliers, onSave }) {
  const now = new Date()
  const empty = {
    description: '', categoryId: '', supplierId: '', amount: '',
    periodMonths: 1, startYear: now.getFullYear(), startMonth: now.getMonth(),
    hasEnd: false, endYear: now.getFullYear(), endMonth: now.getMonth(), notes: ''
  }
  const [form, setForm] = useState(empty)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (fixed) {
      setForm({
        description: fixed.description || '',
        categoryId: fixed.categoryId || '',
        supplierId: fixed.supplierId || '',
        amount: String(fixed.amount ?? ''),
        periodMonths: fixed.periodMonths || 1,
        startYear: fixed.startYear,
        startMonth: fixed.startMonth,
        hasEnd: fixed.endYear != null && fixed.endMonth != null,
        endYear: fixed.endYear ?? now.getFullYear(),
        endMonth: fixed.endMonth ?? now.getMonth(),
        notes: fixed.notes || ''
      })
    } else {
      setForm(empty)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixed, isOpen])

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const payload = {
      description: form.description,
      categoryId: form.categoryId || null,
      supplierId: form.supplierId || null,
      amount: parseFloat(form.amount),
      periodMonths: Number(form.periodMonths),
      startYear: Number(form.startYear),
      startMonth: Number(form.startMonth),
      endYear: form.hasEnd ? Number(form.endYear) : null,
      endMonth: form.hasEnd ? Number(form.endMonth) : null,
      notes: form.notes
    }
    try {
      if (fixed) await updateFixedExpense(fixed.id, payload)
      else await createFixedExpense(payload)
      onSave()
      onClose()
    } catch (err) {
      alert('Error al guardar gasto fijo: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={fixed ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej: Alquiler del local" required />
        <CategorySelect value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} categories={categories} />
        <SupplierSelect value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} suppliers={suppliers} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Monto por pago" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Periodicidad</label>
            <select value={form.periodMonths} onChange={(e) => setForm({ ...form, periodMonths: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
              {PERIODICITY_OPTIONS.map(o => <option key={o.months} value={o.months}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primer pago (mes)</label>
            <select value={form.startMonth} onChange={(e) => setForm({ ...form, startMonth: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <Input label="Primer pago (año)" type="number" value={form.startYear} onChange={(e) => setForm({ ...form, startYear: e.target.value })} required />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.hasEnd} onChange={(e) => setForm({ ...form, hasEnd: e.target.checked })} />
          Tiene fecha de fin
        </label>
        {form.hasEnd && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fin (mes)</label>
              <select value={form.endMonth} onChange={(e) => setForm({ ...form, endMonth: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
            </div>
            <Input label="Fin (año)" type="number" value={form.endYear} onChange={(e) => setForm({ ...form, endYear: e.target.value })} />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>{fixed ? 'Guardar cambios' : 'Crear gasto fijo'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function VariableExpenseModal({ isOpen, onClose, expense, categories, suppliers, selectedYear, selectedMonth, onSave }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ supplierId: '', categoryId: '', description: '', amount: '', date: '', notes: '' })

  useEffect(() => {
    if (expense) {
      setForm({
        supplierId: expense.supplierId || '',
        categoryId: expense.categoryId || '',
        description: expense.description || '',
        amount: expense.amount?.toString() || '',
        date: expense.date || '',
        notes: expense.notes || ''
      })
    } else {
      const defaultDate = new Date(selectedYear, selectedMonth, 1)
      setForm({ supplierId: '', categoryId: '', description: '', amount: '', date: format(defaultDate, 'yyyy-MM-dd'), notes: '' })
    }
  }, [expense, isOpen, selectedYear, selectedMonth])

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const expenseDate = new Date(form.date)
    const payload = {
      supplierId: form.supplierId || null,
      categoryId: form.categoryId || null,
      description: form.description,
      amount: parseFloat(form.amount),
      date: form.date,
      notes: form.notes,
      year: expenseDate.getFullYear(),
      month: expenseDate.getMonth()
    }
    try {
      if (expense) await updateExpense(expense.id, payload)
      else await createExpense(payload)
      onSave()
      onClose()
    } catch (err) {
      alert('Error al guardar gasto: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={expense ? 'Editar gasto variable' : 'Registrar gasto variable'}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej: Reparación de heladera" required />
        <CategorySelect value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} categories={categories} />
        <SupplierSelect value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} suppliers={suppliers} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Monto" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Input label="Fecha" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>{expense ? 'Guardar cambios' : 'Registrar gasto'}</Button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 5: Verify end-to-end in the app**

Run `npm start` → `/costos`:
- Create a fixed expense (e.g. Alquiler, $60000, Semestral, primer pago Ene 2026). Card shows "Semestral", $60000, $10.000/mes, next payment; "Impacta este mes" only on hit months (navigate months to confirm).
- Create a variable expense; it appears in the variable column for that month only.
- Category select in both modals lists categories; "Sin categoría" allowed.
- Delete works for both. No paid/pending UI anywhere.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Costs/CostsPage.jsx
git commit -m "feat(costs): listas y modales de gastos fijos y variables"
```

---

## Task 12: Recompile Tailwind + final verification

**Files:**
- Modify: `src/tailwind.output.css` (generated)

- [ ] **Step 1: Recompile Tailwind**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: completes without errors.

- [ ] **Step 2: Run the full test suite**

Run: `CI=true npx craco test --watchAll=false`
Expected: all tests pass (fixedExpenseCalc + financeSeries + any existing).

- [ ] **Step 3: Manual smoke of the Dashboard**

Run `npm start` → `/dashboard` (as superadmin). Confirm:
- Chart "Gastos" bars spike on fixed-expense payment months (cash).
- The "Gastos" KPI card uses the monthlyized value (no spike; it's smoothed).
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/tailwind.output.css
git commit -m "chore(costs): recompilar Tailwind"
```

---

## Self-Review Notes (verify during execution)

- `rpcRow()` default values in `financeSeries.test.js` — confirm `expenses_total` and the net columns match the numbers used in Task 7's assertions; adjust literals to the actual fixture if different.
- After Task 6, `markExpenseAsPaid`/`getExpensesSummary` must not be referenced anywhere except the old `SupplierList.jsx`, which Task 10 deletes.
- Suppliers form still uses `SUPPLIER_CATEGORIES` (unchanged) — that's intentional; expense categories are a separate concept.
- `is_authenticated()` must exist as a SQL helper (used by existing policies since migration 020) — the new policies reuse it.
