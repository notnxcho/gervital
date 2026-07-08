# Módulo de costos: estadística + copiar variables — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** Corregir la imputación de extraordinarios sin empleado (por mes, no ÷12), incluir los extraordinarios de contingencia en la estadística (total + por categoría), y agregar el botón "sumar variables del mes pasado".

**Tech:** React 19, Supabase, Jest (craco).

## Global Constraints
- UI español, código inglés; sin `;` innecesarios.
- Reconciliación/bucketing por mes en frontend; no se toca el RPC del finance series.
- Contingencia cuenta en total y margen (base caja).
- Commit termina con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Lógica pura financeSeries (TDD)

**Files:** Modify `src/services/dashboard/financeSeries.js`, `financeSeries.test.js`.

**Interfaces:**
- `standaloneExtraForMonth(costs, year, month)` — reemplaza `standaloneExtraCostForMonth`.
- `contingencyForMonth(rows, year, month)`.
- row gana `contingencyExpenses`; `selectExpensesOnly` lo incluye.
- `mergeFinanceSeries(rpcRows, employees, fixedExpenses, standaloneCosts, contingencyRows)`.
- `expensesByCategory({ variableRows, fixedTemplates, extraordinaryRows, salaries }, year, month)`.

- [ ] **Step 1: Tests que fallan** — reemplazar el describe de `standaloneExtraCostForMonth` y agregar:

```js
import { standaloneExtraForMonth, contingencyForMonth } from './financeSeries'

describe('standaloneExtraForMonth', () => {
  test('suma standalone con fecha en el mes (sin amortizar)', () => {
    const costs = [
      { amount: 10000, date: '2026-06-10' },
      { amount: 2500, date: '2026-06-28' },
      { amount: 9999, date: '2026-05-30' }
    ]
    expect(standaloneExtraForMonth(costs, 2026, 5)).toBe(12500) // junio = month 5
  })
  test('cero si no hay del mes / vacío', () => {
    expect(standaloneExtraForMonth([], 2026, 5)).toBe(0)
    expect(standaloneExtraForMonth(undefined, 2026, 5)).toBe(0)
    expect(standaloneExtraForMonth([{ amount: 100, date: '2026-04-01' }], 2026, 5)).toBe(0)
  })
})

describe('contingencyForMonth', () => {
  const rows = [
    { amount: 5000, year: 2026, month: 5, categoryName: 'Vehículo' },
    { amount: 3000, year: 2026, month: 5, categoryName: 'Salud' },
    { amount: 1000, year: 2026, month: 4, categoryName: 'Vehículo' }
  ]
  test('suma contingencia del mes', () => {
    expect(contingencyForMonth(rows, 2026, 5)).toBe(8000)
  })
  test('cero si vacío/otro mes', () => {
    expect(contingencyForMonth([], 2026, 5)).toBe(0)
    expect(contingencyForMonth(rows, 2026, 6)).toBe(0)
  })
})
```

Y actualizar los tests de `mergeFinanceSeries`/selectors: `salaries` ahora = empleados + standalone del mes; agregar caso contingencia en `selectExpensesOnly`. Reemplazar el viejo test 'folds monthlyized standalone costs into salaries' por:
```js
describe('mergeFinanceSeries standalone + contingencia', () => {
  test('standalone del mes va a salaries (sin amortizar)', () => {
    const out = mergeFinanceSeries([rpcRow()], [], [], [{ amount: 12000, date: '2026-06-15' }])
    expect(out[0].salaries).toBe(12000) // junio, sin empleados
  })
  test('contingencia del mes entra en contingencyExpenses y en selectExpensesOnly', () => {
    const out = mergeFinanceSeries([rpcRow()], [], [], [], [{ amount: 7000, year: 2026, month: 5 }])
    expect(out[0].contingencyExpenses).toBe(7000)
    // variableExpenses 300 + contingency 7000 (fixed 0) = 7300
    expect(selectExpensesOnly(out[0], { fixedBasis: 'cash' })).toBe(7300)
  })
})
```
(Ajustar el describe/test viejo de standalone amortizado — eliminarlo.)

- [ ] **Step 2: Run → fail** — `CI=true npx craco test src/services/dashboard/financeSeries.test.js --watchAll=false`.

- [ ] **Step 3: Implementar** en `financeSeries.js`:
  - Reemplazar `standaloneExtraCostForMonth` por:
```js
// Standalone extra costs (no employee) dated in (year, month) — cash, not amortized.
export function standaloneExtraForMonth(standaloneCosts, year, month) {
  if (!standaloneCosts || standaloneCosts.length === 0) return 0
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  return standaloneCosts
    .filter(c => String(c.date || '').slice(0, 7) === prefix)
    .reduce((s, c) => s + (Number(c.amount) || 0), 0)
}

// Contingency extraordinary expenses for (year, month) — rows carry year/month.
export function contingencyForMonth(rows, year, month) {
  if (!rows || rows.length === 0) return 0
  return rows
    .filter(r => r.year === year && r.month === month)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)
}
```
  - Quitar el import de `extraordinarios12m` si queda sin uso (verificar: `salaryCalc` aún exporta y `salaryCostForMonth` lo usa vía costoAnualMensualizado — `extraordinarios12m` ya no se usa en financeSeries → quitar del import).
  - `selectExpensesOnly`:
```js
export function selectExpensesOnly(row, { fixedBasis = 'cash' } = {}) {
  const fixed = fixedBasis === 'monthly' ? (row.fixedMonthly || 0) : (row.fixedCash || 0)
  return (row.variableExpenses || 0) + fixed + (row.contingencyExpenses || 0)
}
```
  - `mergeFinanceSeries` firma + campos:
```js
export function mergeFinanceSeries(rpcRows, employees, fixedExpenses = [], standaloneCosts = [], contingencyRows = []) {
  return (rpcRows || []).map(r => ({
    // ...igual...
    variableExpenses: Number(r.expenses_total) || 0,
    contingencyExpenses: contingencyForMonth(contingencyRows, r.year, r.month),
    fixedCash: fixedCashForMonth(fixedExpenses, r.year, r.month),
    fixedMonthly: fixedMonthlyForMonth(fixedExpenses, r.year, r.month),
    salaries: salaryCostForMonth(employees, r.year, r.month)
      + standaloneExtraForMonth(standaloneCosts, r.year, r.month)
  }))
}
```
  - `expensesByCategory` acepta `extraordinaryRows`:
```js
export function expensesByCategory({ variableRows = [], fixedTemplates = [], extraordinaryRows = [], salaries = 0 } = {}, year, month) {
  const totals = new Map()
  const add = (name, amount) => { if (!amount) return; const key = name || 'Sin categoría'; totals.set(key, (totals.get(key) || 0) + amount) }
  for (const e of variableRows) add(e.categoryName, Number(e.amount) || 0)
  for (const t of fixedTemplates) { if (isActive(t, year, month)) add(t.categoryName, monthlyAmount(t)) }
  for (const x of extraordinaryRows) add(x.categoryName, Number(x.amount) || 0)
  add('Sueldos', salaries || 0)
  return [...totals.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}
```

- [ ] **Step 4: Run → pass**. Fix any other test referencing removed `standaloneExtraCostForMonth`.

- [ ] **Step 5: Commit** `feat(dashboard): imputar standalone por mes + contingencia en la estadística (lógica pura)`.

---

### Task 2: Servicios (getAllExtraordinary + wiring del series)

**Files:** Modify `src/services/expenses/extraordinaryExpenseService.js`, `src/services/api.js`, `src/services/dashboard/dashboardService.js`.

- [ ] **Step 1: `getAllExtraordinaryExpenses`** en extraordinaryExpenseService:
```js
export async function getAllExtraordinaryExpenses() {
  const { data, error } = await supabase
    .from('extraordinary_expenses_view')
    .select('*')
    .order('date', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}
```

- [ ] **Step 2: Re-export** en api.js (bloque de extraordinaryExpenseService): agregar `getAllExtraordinaryExpenses`.

- [ ] **Step 3: dashboardService.getDashboardFinanceSeries** — importar `getAllExtraordinaryExpenses` y agregarlo al Promise.all + pasarlo a mergeFinanceSeries:
```js
import { getAllExtraordinaryExpenses } from '../expenses/extraordinaryExpenseService'
// ...
const [seriesRes, employees, fixedExpenses, standaloneCosts, contingencyRows] = await Promise.all([
  supabase.rpc('get_dashboard_finance_series', { ... }),
  getEmployees().catch(() => []),
  getFixedExpenses().catch(() => []),
  getStandaloneExtraCosts().catch(() => []),
  getAllExtraordinaryExpenses().catch(() => [])
])
if (seriesRes.error) throw new Error(seriesRes.error.message)
return mergeFinanceSeries(seriesRes.data || [], employees, fixedExpenses, standaloneCosts, contingencyRows)
```

- [ ] **Step 4:** `CI=true npx craco test src/services --watchAll=false` (verde). **Commit** `feat(dashboard): traer extraordinarios de contingencia para el finance series`.

---

### Task 3: FinanceSection — contingencia por categoría del mes

**Files:** Modify `src/pages/Dashboard/sections/FinanceSection.jsx`.

- [ ] **Step 1:** importar `getExtraordinaryByMonth` (from `../../../services/expenses/extraordinaryExpenseService`). Estado `const [monthExtraordinary, setMonthExtraordinary] = useState([])`.

- [ ] **Step 2:** en el effect que trae `getExpensesByMonth(selected...)`, agregar en paralelo `getExtraordinaryByMonth(selected.year, selected.month)` → `setMonthExtraordinary`.

- [ ] **Step 3:** pasar a expensesByCategory:
```js
() => expensesByCategory(
  { variableRows: monthExpenses, fixedTemplates, extraordinaryRows: monthExtraordinary, salaries: selectedRow?.salaries || 0 },
  selected.year, selected.month
),
[monthExpenses, fixedTemplates, monthExtraordinary, selectedRow, selected]
```

- [ ] **Step 4:** build. **Commit** `feat(dashboard): contingencia por categoría en el desglose de gastos`.

---

### Task 4: CostsPage — standalone por mes + copiar variables del mes pasado

**Files:** Modify `src/pages/Costs/CostsPage.jsx`.

- [ ] **Step 1: Filtrar standalone al mes** — donde se rendan `standaloneCosts`, filtrar por `c.date` en (year, month):
```js
const standaloneThisMonth = standaloneCosts.filter(c => String(c.date || '').slice(0,7) === `${year}-${String(month + 1).padStart(2,'0')}`)
```
Usar `standaloneThisMonth` en el render de la lista.

- [ ] **Step 2: Botón "Copiar del mes pasado"** en la cabecera de gastos variables (junto a "Gasto variable"):
```jsx
<Button variant="secondary" onClick={() => setCopyModalOpen(true)}>Copiar del mes pasado</Button>
```
Estado `const [copyModalOpen, setCopyModalOpen] = useState(false)`.

- [ ] **Step 3: Modal `CopyLastMonthVariablesModal`** (nuevo componente en el archivo o `src/pages/Costs/CopyLastMonthVariablesModal.jsx`):
  - Props: `isOpen, onClose, year, month, suppliers, onSaved`.
  - Al abrir: calcula mes anterior (`prevYear/prevMonth`), `getExpensesByMonth(prevYear, prevMonth)` → estado `rows` con `{ include: true, description, categoryId, categoryName, supplierId, amount }`.
  - UI: lista con descripción + categoría/proveedor (solo lectura) + input de monto editable + toggle/checkbox incluir (y/o botón quitar). Vacío → mensaje "No hay gastos variables el mes pasado".
  - Confirmar: para cada `include`, `createExpense({ supplierId, categoryId, description, amount: Number(amount), date: 'YYYY-MM-01' del mes actual, year, month, notes: '' })`. Luego `onSaved()` (reload) + `onClose()`.

- [ ] **Step 4: Montar el modal** con `year/month/suppliers`, `onSaved={loadData}`.

- [ ] **Step 5:** `npx tailwindcss ...` + build. **Commit** `feat(costs): filtrar standalone por mes + copiar gastos variables del mes pasado`.

---

## Verificación final
- Suite verde; build limpio.
- BD: para un mes con contingencia y standalone, el total de gastos del dashboard los incluye; el desglose por categoría muestra contingencia por su categoría y Sueldos = empleados + standalone del mes.
- Manual: botón copiar variables abre preview editable y crea los del mes actual al confirmar.
