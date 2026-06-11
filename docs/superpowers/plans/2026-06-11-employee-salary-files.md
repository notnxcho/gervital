# Ficha de empleados (rework Sueldos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el módulo Sueldos plano (`salaries`) por una ficha de empleados con historia de sueldo, gastos extraordinarios y costo anual mensualizado derivado según normativa uruguaya.

**Architecture:** 3 tablas nuevas (`employees`, `employee_salary_adjustments`, `employee_extra_costs`) + view `employees_full` + RPC `create_employee_with_salary` (todo superadmin). La lógica de costos vive en un helper JS puro y testeable (`salaryCalc.js`). La UI reemplaza el bloque Sueldos dentro de `SupplierList.jsx`.

**Tech Stack:** React 19, Supabase (PostgreSQL + RLS), Tailwind, Jest (`craco test`), iconoir-react.

**Spec:** `docs/superpowers/specs/2026-06-11-employee-salary-files-design.md`

**Convenciones del repo:** variables/código en inglés, UI en español, sin `;` innecesarios en JS/JSX, named exports en servicios. Tailwind se compila manual al final.

---

## File Structure

**Nuevos:**
- `src/services/salaries/salaryCalc.js` — funciones puras de cálculo (sueldo vigente, aguinaldo, salario vacacional, costo anual, proyección)
- `src/services/salaries/salaryCalc.test.js` — tests del helper
- `supabase/migrations/026_employee_salaries.sql` — drop `salaries`; tablas, RLS, view, RPC

**Modificados:**
- `src/services/salaries/salaryService.js` — reescritura: API centrada en empleados
- `src/services/api.js` — re-exports actualizados
- `src/pages/Suppliers/SupplierList.jsx` — bloque Sueldos: grid de empleados + `EmployeeFichaModal` + `AddEmployeeModal` + bloque "Extraordinarios sin empleado"

---

## Task 1: Helper de cálculo `salaryCalc.js` (TDD)

**Files:**
- Create: `src/services/salaries/salaryCalc.js`
- Test: `src/services/salaries/salaryCalc.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/services/salaries/salaryCalc.test.js`:

```js
import {
  VACATION_DAYS,
  currentSalary,
  aguinaldoAnual,
  salarioVacacionalAnual,
  extraordinarios12m,
  costoAnual,
  costoAnualMensualizado,
  proyectarNominal
} from './salaryCalc'

describe('currentSalary', () => {
  test('returns null when no adjustments', () => {
    expect(currentSalary([])).toBeNull()
    expect(currentSalary(undefined)).toBeNull()
  })

  test('picks the adjustment with the latest effectiveDate', () => {
    const adj = [
      { nominal: 100, liquido: 80, effectiveDate: '2025-01-01' },
      { nominal: 120, liquido: 95, effectiveDate: '2026-01-01' },
      { nominal: 110, liquido: 88, effectiveDate: '2025-06-01' }
    ]
    expect(currentSalary(adj)).toEqual({ nominal: 120, liquido: 95, effectiveDate: '2026-01-01' })
  })

  test('breaks ties on effectiveDate using createdAt', () => {
    const adj = [
      { nominal: 100, liquido: 80, effectiveDate: '2026-01-01', createdAt: '2026-01-01T10:00:00Z' },
      { nominal: 130, liquido: 99, effectiveDate: '2026-01-01', createdAt: '2026-01-02T10:00:00Z' }
    ]
    expect(currentSalary(adj).nominal).toBe(130)
  })
})

describe('aguinaldoAnual', () => {
  test('equals one nominal month', () => {
    expect(aguinaldoAnual(50000)).toBe(50000)
    expect(aguinaldoAnual(0)).toBe(0)
  })
})

describe('salarioVacacionalAnual', () => {
  test('is (liquido / 30) * 20', () => {
    expect(salarioVacacionalAnual(38000)).toBeCloseTo((38000 / 30) * 20, 5)
  })
  test('uses VACATION_DAYS = 20', () => {
    expect(VACATION_DAYS).toBe(20)
  })
})

describe('extraordinarios12m', () => {
  const extras = [
    { amount: 1000, date: '2026-05-01' }, // within 12m of asOf
    { amount: 500, date: '2025-07-01' },  // within 12m
    { amount: 9999, date: '2025-05-01' }  // older than 12m -> excluded
  ]
  test('sums only costs within the last 12 months of asOf', () => {
    expect(extraordinarios12m(extras, '2026-06-11')).toBe(1500)
  })
  test('returns 0 for empty input', () => {
    expect(extraordinarios12m([], '2026-06-11')).toBe(0)
    expect(extraordinarios12m(undefined, '2026-06-11')).toBe(0)
  })
})

describe('costoAnual / costoAnualMensualizado', () => {
  const args = {
    nominal: 50000,
    liquido: 40000,
    extraCosts: [{ amount: 12000, date: '2026-05-01' }]
  }
  test('costoAnual = nominal*12 + aguinaldo + salarioVacacional + extras12m', () => {
    const expected = 50000 * 12 + 50000 + (40000 / 30) * 20 + 12000
    expect(costoAnual(args, '2026-06-11')).toBeCloseTo(expected, 5)
  })
  test('mensualizado = costoAnual / 12', () => {
    expect(costoAnualMensualizado(args, '2026-06-11')).toBeCloseTo(costoAnual(args, '2026-06-11') / 12, 5)
  })
})

describe('proyectarNominal', () => {
  test('applies the semester pct compounded over N semesters', () => {
    expect(proyectarNominal(100000, 3.5, 2)).toBeCloseTo(100000 * Math.pow(1.035, 2), 5)
  })
  test('0 semesters returns the same nominal', () => {
    expect(proyectarNominal(100000, 3.5, 0)).toBe(100000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx craco test src/services/salaries/salaryCalc.test.js --watchAll=false`
Expected: FAIL — `Cannot find module './salaryCalc'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/salaries/salaryCalc.js`:

```js
// Pure salary cost calculations (Uruguayan labor model).
// asOf is injected (no internal Date.now) so results are deterministic and testable.

export const VACATION_DAYS = 20

/**
 * Current salary = adjustment with the latest effectiveDate (tie-break by createdAt).
 * @param {Array<{nominal:number, liquido:number, effectiveDate:string, createdAt?:string}>} adjustments
 * @returns {{nominal:number, liquido:number, effectiveDate:string}|null}
 */
export function currentSalary(adjustments) {
  if (!adjustments || adjustments.length === 0) return null
  const sorted = [...adjustments].sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? 1 : -1
    return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1
  })
  const top = sorted[0]
  return { nominal: Number(top.nominal), liquido: Number(top.liquido), effectiveDate: top.effectiveDate }
}

// Aguinaldo (SAC): 1/12 del nominal anual = un mes de nominal.
export function aguinaldoAnual(nominal) {
  return Number(nominal) || 0
}

// Salario vacacional: (liquido / 30) * 20 dias (base liquido, segun ley).
export function salarioVacacionalAnual(liquido) {
  return ((Number(liquido) || 0) / 30) * VACATION_DAYS
}

// Suma de extraordinarios del empleado en los ultimos 12 meses respecto a asOf.
export function extraordinarios12m(extraCosts, asOf) {
  if (!extraCosts || extraCosts.length === 0) return 0
  const ref = asOf ? new Date(asOf) : new Date()
  const cutoff = new Date(ref)
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  return extraCosts
    .filter(x => {
      const d = new Date(x.date)
      return d > cutoff && d <= ref
    })
    .reduce((sum, x) => sum + (Number(x.amount) || 0), 0)
}

// Costo anual = nominal*12 + aguinaldo + salario vacacional + extraordinarios 12m.
export function costoAnual({ nominal, liquido, extraCosts }, asOf) {
  return (Number(nominal) || 0) * 12
    + aguinaldoAnual(nominal)
    + salarioVacacionalAnual(liquido)
    + extraordinarios12m(extraCosts, asOf)
}

export function costoAnualMensualizado(args, asOf) {
  return costoAnual(args, asOf) / 12
}

// Proyeccion: aplica el % semestral compuesto sobre N semestres (uso futuro en analisis).
export function proyectarNominal(nominal, pct, semestres) {
  return (Number(nominal) || 0) * Math.pow(1 + (Number(pct) || 0) / 100, semestres)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx craco test src/services/salaries/salaryCalc.test.js --watchAll=false`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/services/salaries/salaryCalc.js src/services/salaries/salaryCalc.test.js
git commit -m "feat(salaries): salaryCalc helper for employee cost derivation"
```

---

## Task 2: Migración `026_employee_salaries.sql`

**Files:**
- Create: `supabase/migrations/026_employee_salaries.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/026_employee_salaries.sql`:

```sql
-- 026: Rework Sueldos -> ficha de empleados.
-- Drops the flat salaries table; adds employees + salary history + extra costs.

-- 1. Drop legacy salaries table (datos de prueba, se descartan)
DROP TABLE IF EXISTS salaries CASCADE;

-- 2. employees
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  role TEXT,
  semester_adjustment_pct NUMERIC(5,2) NOT NULL DEFAULT 3.5,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. employee_salary_adjustments (historia de sueldo)
CREATE TABLE employee_salary_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  nominal NUMERIC(12,2) NOT NULL,
  liquido NUMERIC(12,2) NOT NULL,
  effective_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_salary_adj_employee ON employee_salary_adjustments(employee_id, effective_date DESC);

-- 4. employee_extra_costs (extraordinarios, con o sin empleado)
CREATE TABLE employee_extra_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('despido', 'liquidacion', 'bono', 'otro')),
  concept TEXT,
  amount NUMERIC(12,2) NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_extra_costs_employee ON employee_extra_costs(employee_id);
CREATE INDEX idx_extra_costs_date ON employee_extra_costs(date);

-- 5. RLS: superadmin only (las 3 tablas)
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_salary_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_extra_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees viewable by superadmin"   ON employees FOR SELECT USING (is_superadmin());
CREATE POLICY "Employees insertable by superadmin" ON employees FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY "Employees updatable by superadmin"  ON employees FOR UPDATE USING (is_superadmin());
CREATE POLICY "Employees deletable by superadmin"  ON employees FOR DELETE USING (is_superadmin());

CREATE POLICY "Salary adj viewable by superadmin"   ON employee_salary_adjustments FOR SELECT USING (is_superadmin());
CREATE POLICY "Salary adj insertable by superadmin" ON employee_salary_adjustments FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY "Salary adj updatable by superadmin"  ON employee_salary_adjustments FOR UPDATE USING (is_superadmin());
CREATE POLICY "Salary adj deletable by superadmin"  ON employee_salary_adjustments FOR DELETE USING (is_superadmin());

CREATE POLICY "Extra costs viewable by superadmin"   ON employee_extra_costs FOR SELECT USING (is_superadmin());
CREATE POLICY "Extra costs insertable by superadmin" ON employee_extra_costs FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY "Extra costs updatable by superadmin"  ON employee_extra_costs FOR UPDATE USING (is_superadmin());
CREATE POLICY "Extra costs deletable by superadmin"  ON employee_extra_costs FOR DELETE USING (is_superadmin());

-- 6. View employees_full (nested JSON; derivados se calculan en JS)
CREATE VIEW employees_full WITH (security_invoker = on) AS
SELECT
  e.id,
  e.name,
  e.role,
  e.semester_adjustment_pct,
  e.active,
  e.created_at,
  e.updated_at,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.effective_date DESC, a.created_at DESC)
    FROM employee_salary_adjustments a WHERE a.employee_id = e.id
  ), '[]'::jsonb) AS adjustments,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC)
    FROM employee_extra_costs x WHERE x.employee_id = e.id
  ), '[]'::jsonb) AS extra_costs
FROM employees e;

-- 7. RPC: alta atomica de empleado + primer sueldo (SECURITY INVOKER -> RLS aplica)
CREATE OR REPLACE FUNCTION create_employee_with_salary(
  p_name TEXT,
  p_role TEXT,
  p_semester_adjustment_pct NUMERIC,
  p_nominal NUMERIC,
  p_liquido NUMERIC,
  p_effective_date DATE,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO employees (name, role, semester_adjustment_pct)
  VALUES (p_name, p_role, COALESCE(p_semester_adjustment_pct, 3.5))
  RETURNING id INTO v_id;

  INSERT INTO employee_salary_adjustments (employee_id, nominal, liquido, effective_date, notes)
  VALUES (v_id, p_nominal, p_liquido, p_effective_date, p_notes);

  RETURN v_id;
END;
$$;
```

- [ ] **Step 2: Apply the migration to the remote project**

Use the Supabase MCP tool `apply_migration` with name `026_employee_salaries` and the SQL above.
(If MCP is unavailable, run it via the SQL editor / `supabase db push`.)

- [ ] **Step 3: Verify tables, view and RPC exist**

Use MCP `execute_sql` (or SQL editor) to run:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('employees','employee_salary_adjustments','employee_extra_costs','employees_full');
SELECT proname FROM pg_proc WHERE proname = 'create_employee_with_salary';
SELECT tablename FROM pg_tables WHERE tablename = 'salaries';  -- expected: 0 rows (dropped)
```
Expected: first query returns the 4 names; second returns 1 row; third returns 0 rows.

- [ ] **Step 4: Verify RLS advisor has no new errors**

Use MCP `get_advisors` (type `security`). Expected: no new "RLS disabled" errors for the 3 new tables (they have RLS enabled). The `employees_full` view is `security_invoker`, so base-table RLS applies.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/026_employee_salaries.sql
git commit -m "feat(salaries): migration 026 employees + salary history + extra costs"
```

---

## Task 3: Reescritura de `salaryService.js` + `api.js`

**Files:**
- Modify (rewrite): `src/services/salaries/salaryService.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Replace `salaryService.js` contents**

Replace the entire file `src/services/salaries/salaryService.js` with:

```js
import { supabase } from '../supabase/client'

// Tipos discretos para gastos extraordinarios de empleado.
export const EXTRA_COST_TYPES = [
  { value: 'despido', label: 'Despido' },
  { value: 'liquidacion', label: 'Liquidación' },
  { value: 'bono', label: 'Bono' },
  { value: 'otro', label: 'Otro' }
]

const EXTRA_COST_LABELS = EXTRA_COST_TYPES.reduce((acc, t) => {
  acc[t.value] = t.label
  return acc
}, {})

export function extraCostLabel(type) {
  return EXTRA_COST_LABELS[type] || type || ''
}

function mapAdjustment(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    nominal: Number(row.nominal),
    liquido: Number(row.liquido),
    effectiveDate: row.effective_date,
    notes: row.notes,
    createdAt: row.created_at
  }
}

function mapExtraCost(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    type: row.type,
    concept: row.concept,
    amount: Number(row.amount),
    date: row.date,
    createdAt: row.created_at
  }
}

function mapEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    semesterAdjustmentPct: Number(row.semester_adjustment_pct),
    active: row.active,
    adjustments: (row.adjustments || []).map(mapAdjustment),
    extraCosts: (row.extra_costs || []).map(mapExtraCost),
    createdAt: row.created_at
  }
}

/**
 * Get all employees with nested salary history and extra costs, newest first.
 * @returns {Promise<Array>}
 */
export async function getEmployees() {
  const { data, error } = await supabase
    .from('employees_full')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data.map(mapEmployee)
}

/**
 * Get standalone extra costs (no employee).
 * @returns {Promise<Array>}
 */
export async function getStandaloneExtraCosts() {
  const { data, error } = await supabase
    .from('employee_extra_costs')
    .select('*')
    .is('employee_id', null)
    .order('date', { ascending: false })

  if (error) throw new Error(error.message)
  return data.map(mapExtraCost)
}

/**
 * Create an employee + its first salary adjustment atomically.
 * @param {object} input - { name, role, semesterAdjustmentPct, nominal, liquido, effectiveDate, notes? }
 * @returns {Promise<string>} new employee id
 */
export async function createEmployee(input) {
  const { data, error } = await supabase.rpc('create_employee_with_salary', {
    p_name: input.name,
    p_role: input.role || null,
    p_semester_adjustment_pct: input.semesterAdjustmentPct ?? 3.5,
    p_nominal: input.nominal,
    p_liquido: input.liquido,
    p_effective_date: input.effectiveDate,
    p_notes: input.notes || null
  })

  if (error) throw new Error(error.message)
  return data
}

/**
 * Update employee fields (name, role, %, active).
 */
export async function updateEmployee(id, input) {
  const payload = {}
  if (input.name !== undefined) payload.name = input.name
  if (input.role !== undefined) payload.role = input.role
  if (input.semesterAdjustmentPct !== undefined) payload.semester_adjustment_pct = input.semesterAdjustmentPct
  if (input.active !== undefined) payload.active = input.active
  payload.updated_at = new Date().toISOString()

  const { error } = await supabase.from('employees').update(payload).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Delete an employee (cascade removes adjustments and extra costs). */
export async function deleteEmployee(id) {
  const { error } = await supabase.from('employees').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Add a salary adjustment row (a real raise/change, kept in history).
 * @param {string} employeeId
 * @param {object} input - { nominal, liquido, effectiveDate, notes? }
 */
export async function addSalaryAdjustment(employeeId, input) {
  const { error } = await supabase.from('employee_salary_adjustments').insert({
    employee_id: employeeId,
    nominal: input.nominal,
    liquido: input.liquido,
    effective_date: input.effectiveDate,
    notes: input.notes || null
  })
  if (error) throw new Error(error.message)
}

/** Delete a salary adjustment (UI prevents deleting the only/first one). */
export async function deleteSalaryAdjustment(id) {
  const { error } = await supabase.from('employee_salary_adjustments').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Add an extra cost. employeeId null => standalone (no employee, no type).
 * @param {object} input - { employeeId?, type?, concept?, amount, date }
 */
export async function addExtraCost(input) {
  const { error } = await supabase.from('employee_extra_costs').insert({
    employee_id: input.employeeId || null,
    type: input.employeeId ? (input.type || null) : null,
    concept: input.concept || null,
    amount: input.amount,
    date: input.date
  })
  if (error) throw new Error(error.message)
}

/** Delete an extra cost. */
export async function deleteExtraCost(id) {
  const { error } = await supabase.from('employee_extra_costs').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 2: Update `api.js` re-exports**

In `src/services/api.js`, find the salaries re-export block (around lines 132-142, the `getSalaries`/`createSalary`/`deactivateSalary`/`deleteSalary`/`SALARY_ONE_TIME_TYPES`/`salaryOneTimeLabel` exports) and replace it with:

```js
export {
  EXTRA_COST_TYPES,
  extraCostLabel,
  getEmployees,
  getStandaloneExtraCosts,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  addSalaryAdjustment,
  deleteSalaryAdjustment,
  addExtraCost,
  deleteExtraCost
} from './salaries/salaryService'
```

(Match the existing import/export style in `api.js` — if it uses `export * from` or a different form, mirror that. The point: stop exporting the removed symbols and export the new ones.)

- [ ] **Step 3: Verify the build compiles (no references to removed symbols yet from api)**

Run: `CI=true npx craco test src/services/salaries/salaryCalc.test.js --watchAll=false`
Expected: still PASS (helper untouched).

Run: `npx eslint src/services/salaries/salaryService.js src/services/api.js`
Expected: no errors. (`SupplierList.jsx` will still reference old symbols — fixed in Task 4. Do NOT run a full build yet.)

- [ ] **Step 4: Commit**

```bash
git add src/services/salaries/salaryService.js src/services/api.js
git commit -m "feat(salaries): employee-centric salaryService + api re-exports"
```

---

## Task 4: UI — bloque Sueldos en `SupplierList.jsx`

**Files:**
- Modify: `src/pages/Suppliers/SupplierList.jsx`

This task replaces the imports, state, handlers, the Sueldos JSX block (lines ~334-434), the `<SalaryModal>` usage (~455-461), and the `SalaryModal` component definition (~688-790).

- [ ] **Step 1: Update imports from api**

In `src/pages/Suppliers/SupplierList.jsx`, replace the salary imports (lines 26-31):

```js
  getSalaries,
  createSalary,
  deactivateSalary,
  deleteSalary,
  SALARY_ONE_TIME_TYPES,
  salaryOneTimeLabel
```

with:

```js
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
```

Add the calc helper import below the api import block:

```js
import { currentSalary, costoAnualMensualizado, aguinaldoAnual, salarioVacacionalAnual, extraordinarios12m } from '../../services/salaries/salaryCalc'
```

Add icons to the iconoir import (line 5-14 block): add `Calendar` and `Wallet` to the existing list (keep `Plus, Trash, Edit` etc).

- [ ] **Step 2: Update state**

Replace the salaries state (line 42) and salaryModal state (line 50):

```js
  const [salaries, setSalaries] = useState([])
```
```js
  const [salaryModal, setSalaryModal] = useState({ open: false, kind: 'recurring' })
```

with:

```js
  const [employees, setEmployees] = useState([])
  const [standaloneCosts, setStandaloneCosts] = useState([])
```
```js
  const [employeeModal, setEmployeeModal] = useState({ open: false, employee: null })
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false)
  const [standaloneModalOpen, setStandaloneModalOpen] = useState(false)
```

- [ ] **Step 3: Update data loading**

Replace the salaries load (lines ~69-71):

```js
      if (hasAccess('salaries')) {
        const salariesData = await getSalaries()
        setSalaries(salariesData)
      }
```

with:

```js
      if (hasAccess('salaries')) {
        const [employeesData, standaloneData] = await Promise.all([
          getEmployees(),
          getStandaloneExtraCosts()
        ])
        setEmployees(employeesData)
        setStandaloneCosts(standaloneData)
      }
```

- [ ] **Step 4: Replace salary handlers**

Replace `handleDeactivateSalary` and `handleDeleteSalary` (lines ~131-147) with:

```js
  const handleDeleteEmployee = async (id) => {
    if (!window.confirm('¿Eliminar empleado y toda su historia de sueldos? Esta acción no se puede deshacer.')) return
    try {
      await deleteEmployee(id)
      setEmployeeModal({ open: false, employee: null })
      await loadData()
    } catch (e) {
      alert('Error al eliminar: ' + e.message)
    }
  }

  const handleDeleteStandalone = async (id) => {
    try {
      await deleteExtraCost(id)
      await loadData()
    } catch (e) {
      alert('Error al eliminar: ' + e.message)
    }
  }
```

- [ ] **Step 5: Replace the Sueldos JSX block**

Replace the entire block from `{/* Sueldos (solo superadmin) */}` (line 333) through its closing `)}` (line 434) with:

```jsx
      {/* Sueldos / Empleados (solo superadmin) */}
      {hasAccess('salaries') && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Sueldos</h3>
            <Button onClick={() => setAddEmployeeOpen(true)}>
              <Plus className="w-4 h-4" />
              Empleado
            </Button>
          </div>

          {employees.length === 0 ? (
            <Card className="p-6 text-center"><p className="text-gray-500">Sin empleados</p></Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {employees.map(emp => {
                const cur = currentSalary(emp.adjustments)
                const mensualizado = cur
                  ? costoAnualMensualizado({ nominal: cur.nominal, liquido: cur.liquido, extraCosts: emp.extraCosts })
                  : 0
                return (
                  <Card
                    key={emp.id}
                    className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${!emp.active ? 'opacity-60' : ''}`}
                    onClick={() => setEmployeeModal({ open: true, employee: emp })}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h5 className="font-medium text-gray-900">{emp.name}</h5>
                        {emp.role && <p className="text-xs text-gray-500">{emp.role}</p>}
                      </div>
                      {!emp.active && <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">Baja</span>}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs text-gray-500">Costo anual mensualizado</p>
                      <p className="text-lg font-semibold text-gray-900">${Math.round(mensualizado).toLocaleString('es-AR')}</p>
                      {cur && <p className="text-xs text-gray-400 mt-0.5">Nominal: ${cur.nominal.toLocaleString('es-AR')}</p>}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Extraordinarios sin empleado */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700">Extraordinarios sin empleado</h4>
              <Button variant="secondary" onClick={() => setStandaloneModalOpen(true)}>
                <Plus className="w-4 h-4" />
                Agregar
              </Button>
            </div>
            {standaloneCosts.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-500">Sin gastos extraordinarios</p></Card>
            ) : (
              <div className="space-y-3">
                {standaloneCosts.map(c => (
                  <Card key={c.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h5 className="font-medium text-gray-900">{c.concept || 'Sin concepto'}</h5>
                        <p className="text-xs text-gray-400 mt-1">{format(new Date(c.date), 'd MMM yyyy', { locale: es })}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-lg font-semibold text-gray-900">${c.amount.toLocaleString('es-AR')}</p>
                        <button
                          onClick={() => handleDeleteStandalone(c.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 6: Replace the SalaryModal usage with the new modals**

Replace the `{/* Salary Modal */}` usage (lines ~455-461) with:

```jsx
      {/* Employee ficha modal */}
      <EmployeeFichaModal
        isOpen={employeeModal.open}
        employee={employeeModal.employee}
        onClose={() => setEmployeeModal({ open: false, employee: null })}
        onChanged={loadData}
        onDelete={handleDeleteEmployee}
      />

      {/* Add employee modal */}
      <AddEmployeeModal
        isOpen={addEmployeeOpen}
        onClose={() => setAddEmployeeOpen(false)}
        onSave={loadData}
      />

      {/* Standalone extra cost modal */}
      <StandaloneCostModal
        isOpen={standaloneModalOpen}
        onClose={() => setStandaloneModalOpen(false)}
        onSave={loadData}
      />
```

- [ ] **Step 7: Replace the `SalaryModal` component definition with the new components**

Replace the entire `function SalaryModal({ ... }) { ... }` definition (lines ~688-790) with the following three components:

```jsx
function AddEmployeeModal({ isOpen, onClose, onSave }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [form, setForm] = useState({ name: '', role: '', nominal: '', liquido: '', semesterAdjustmentPct: '3.5', effectiveDate: today })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) setForm({ name: '', role: '', nominal: '', liquido: '', semesterAdjustmentPct: '3.5', effectiveDate: today })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createEmployee({
        name: form.name,
        role: form.role,
        semesterAdjustmentPct: Number(form.semesterAdjustmentPct) || 3.5,
        nominal: Number(form.nominal),
        liquido: Number(form.liquido),
        effectiveDate: form.effectiveDate
      })
      onSave()
      onClose()
    } catch (err) {
      alert('Error al crear empleado: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo empleado">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input label="Rol" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Ej: Coordinadora" />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Sueldo nominal" type="number" value={form.nominal} onChange={(e) => setForm({ ...form, nominal: e.target.value })} required />
          <Input label="Sueldo líquido" type="number" value={form.liquido} onChange={(e) => setForm({ ...form, liquido: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Ajuste semestral (%)" type="number" step="0.1" value={form.semesterAdjustmentPct} onChange={(e) => setForm({ ...form, semesterAdjustmentPct: e.target.value })} />
          <Input label="Vigente desde" type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} required />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Crear'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function StandaloneCostModal({ isOpen, onClose, onSave }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [form, setForm] = useState({ concept: '', amount: '', date: today })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) setForm({ concept: '', amount: '', date: today })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await addExtraCost({ employeeId: null, concept: form.concept, amount: Number(form.amount), date: form.date })
      onSave()
      onClose()
    } catch (err) {
      alert('Error al guardar: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Gasto extraordinario (sin empleado)">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Concepto" value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} placeholder="Ej: Consultoría" required />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Monto" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Input label="Fecha" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Agregar'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function EmployeeFichaModal({ isOpen, employee, onClose, onChanged, onDelete }) {
  const [adjForm, setAdjForm] = useState(null)
  const [extraForm, setExtraForm] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!employee) return null

  const cur = currentSalary(employee.adjustments)
  const nominal = cur ? cur.nominal : 0
  const liquido = cur ? cur.liquido : 0
  const ag = aguinaldoAnual(nominal)
  const sv = salarioVacacionalAnual(liquido)
  const extra12 = extraordinarios12m(employee.extraCosts)
  const mensualizado = costoAnualMensualizado({ nominal, liquido, extraCosts: employee.extraCosts })

  const today = format(new Date(), 'yyyy-MM-dd')

  const submitAdjustment = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await addSalaryAdjustment(employee.id, {
        nominal: Number(adjForm.nominal),
        liquido: Number(adjForm.liquido),
        effectiveDate: adjForm.effectiveDate,
        notes: adjForm.notes
      })
      setAdjForm(null)
      onChanged()
      onClose()
    } catch (err) {
      alert('Error al registrar ajuste: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const submitExtra = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await addExtraCost({
        employeeId: employee.id,
        type: extraForm.type,
        concept: extraForm.concept,
        amount: Number(extraForm.amount),
        date: extraForm.date
      })
      setExtraForm(null)
      onChanged()
      onClose()
    } catch (err) {
      alert('Error al guardar: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeAdjustment = async (id) => {
    if (employee.adjustments.length <= 1) {
      alert('No se puede borrar el único ajuste de sueldo del empleado.')
      return
    }
    setBusy(true)
    try {
      await deleteSalaryAdjustment(id)
      onChanged()
      onClose()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeExtra = async (id) => {
    setBusy(true)
    try {
      await deleteExtraCost(id)
      onChanged()
      onClose()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={employee.name}>
      <div className="space-y-6">
        {/* Header: costo anual mensualizado + desglose */}
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-500">Costo anual mensualizado (≠ nominal)</p>
          <p className="text-2xl font-bold text-gray-900">${Math.round(mensualizado).toLocaleString('es-AR')}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs text-gray-600">
            <span>Nominal: ${nominal.toLocaleString('es-AR')}</span>
            <span>Líquido: ${liquido.toLocaleString('es-AR')}</span>
            <span>Aguinaldo/año: ${Math.round(ag).toLocaleString('es-AR')}</span>
            <span>Sal. vacacional/año: ${Math.round(sv).toLocaleString('es-AR')}</span>
            <span>Extraord. 12m: ${Math.round(extra12).toLocaleString('es-AR')}</span>
            <span>Ajuste semestral: {employee.semesterAdjustmentPct}%</span>
          </div>
        </div>

        {/* Sueldo: historia de ajustes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Sueldo (historia)</h4>
            <button className="text-xs text-blue-600 hover:underline" onClick={() => setAdjForm({ nominal: '', liquido: '', effectiveDate: today, notes: '' })}>
              + Registrar ajuste
            </button>
          </div>
          {adjForm && (
            <form onSubmit={submitAdjustment} className="bg-blue-50 rounded-lg p-3 mb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Nominal" type="number" value={adjForm.nominal} onChange={(e) => setAdjForm({ ...adjForm, nominal: e.target.value })} required />
                <Input label="Líquido" type="number" value={adjForm.liquido} onChange={(e) => setAdjForm({ ...adjForm, liquido: e.target.value })} required />
              </div>
              <Input label="Vigente desde" type="date" value={adjForm.effectiveDate} onChange={(e) => setAdjForm({ ...adjForm, effectiveDate: e.target.value })} required />
              <Input label="Notas" value={adjForm.notes} onChange={(e) => setAdjForm({ ...adjForm, notes: e.target.value })} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setAdjForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={busy}>Guardar</Button>
              </div>
            </form>
          )}
          <div className="space-y-2">
            {employee.adjustments.map(a => (
              <div key={a.id} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2">
                <div>
                  <span className="font-medium text-gray-900">${a.nominal.toLocaleString('es-AR')}</span>
                  <span className="text-gray-400"> nom · ${a.liquido.toLocaleString('es-AR')} líq</span>
                  {a.notes && <span className="text-gray-400"> · {a.notes}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{format(new Date(a.effectiveDate), 'd MMM yyyy', { locale: es })}</span>
                  <button onClick={() => removeAdjustment(a.id)} className="p-1 text-gray-300 hover:text-red-600 rounded">
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Extraordinarios del empleado */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Extraordinarios</h4>
            <button className="text-xs text-blue-600 hover:underline" onClick={() => setExtraForm({ type: 'otro', concept: '', amount: '', date: today })}>
              + Agregar
            </button>
          </div>
          {extraForm && (
            <form onSubmit={submitExtra} className="bg-purple-50 rounded-lg p-3 mb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                  <select
                    value={extraForm.type}
                    onChange={(e) => setExtraForm({ ...extraForm, type: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    {EXTRA_COST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <Input label="Monto" type="number" value={extraForm.amount} onChange={(e) => setExtraForm({ ...extraForm, amount: e.target.value })} required />
              </div>
              <Input label="Concepto" value={extraForm.concept} onChange={(e) => setExtraForm({ ...extraForm, concept: e.target.value })} />
              <Input label="Fecha" type="date" value={extraForm.date} onChange={(e) => setExtraForm({ ...extraForm, date: e.target.value })} required />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setExtraForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={busy}>Guardar</Button>
              </div>
            </form>
          )}
          <div className="space-y-2">
            {employee.extraCosts.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2">
                <div>
                  <span className="font-medium text-gray-900">{extraCostLabel(c.type)}</span>
                  {c.concept && <span className="text-gray-400"> · {c.concept}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">${c.amount.toLocaleString('es-AR')}</span>
                  <span className="text-xs text-gray-400">{format(new Date(c.date), 'd MMM yyyy', { locale: es })}</span>
                  <button onClick={() => removeExtra(c.id)} className="p-1 text-gray-300 hover:text-red-600 rounded">
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer: eliminar empleado */}
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <button onClick={() => onDelete(employee.id)} className="text-sm text-red-600 hover:underline">
            Eliminar empleado
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 8: Verify lint and build**

Run: `npx eslint src/pages/Suppliers/SupplierList.jsx`
Expected: no errors (no references to `getSalaries`, `SalaryModal`, `handleDeactivateSalary`, etc.).

Run: `npm run build`
Expected: build succeeds with no compile errors.

- [ ] **Step 9: Recompile Tailwind**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: completes; no new utility classes missing.

- [ ] **Step 10: Manual smoke test**

Run `npm start`, log in as superadmin, go to Proveedores/Gastos:
- Crear un empleado (nombre, rol, nominal, líquido) → aparece card con costo anual mensualizado.
- Abrir ficha → verificar desglose (aguinaldo = nominal, sal. vacacional = (líquido/30)×20).
- Registrar un ajuste → aparece en la historia y el sueldo vigente cambia.
- Agregar un extraordinario al empleado → impacta el costo mensualizado.
- Agregar un extraordinario sin empleado → aparece en el bloque inferior.
- Loguear como operador/admin → el bloque Sueldos no se ve.

- [ ] **Step 11: Commit**

```bash
git add src/pages/Suppliers/SupplierList.jsx src/tailwind.output.css
git commit -m "feat(salaries): employee ficha UI (grid, ficha modal, standalone extras)"
```

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** modelo de datos (Task 2), helper de cálculo (Task 1), servicio + api (Task 3), UI embebida en Gastos con header de costo mensualizado, historia de ajustes, extraordinarios con tipo, y extraordinarios sin empleado (Task 4). Aguinaldo/salario vacacional derivados (Task 1). RLS superadmin + view security_invoker + RPC atómico (Task 2). ✅
- **Placeholders:** ninguno; todo el código está completo.
- **Consistencia de tipos:** nombres de funciones del servicio (`getEmployees`, `addSalaryAdjustment`, `addExtraCost`, `extraCostLabel`, `EXTRA_COST_TYPES`) y del helper (`currentSalary`, `costoAnualMensualizado`, `aguinaldoAnual`, `salarioVacacionalAnual`, `extraordinarios12m`) coinciden entre tasks. Campos camelCase del `mapEmployee` (`adjustments`, `extraCosts`, `semesterAdjustmentPct`) usados igual en la UI. ✅
- **Nota de riesgo:** verificar en `api.js` la forma exacta del re-export actual (Task 3 Step 2) y en `Modal`/`Input` que las props (`isOpen`, `title`, `label`) coincidan con el resto del repo — están basadas en el uso existente en `SupplierList.jsx`.
```
