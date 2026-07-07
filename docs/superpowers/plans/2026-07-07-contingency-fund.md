# Fondo de contingencia + Gastos extraordinarios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un fondo de contingencia (barra de progreso con límite = % customizable de "Fijos mensualizado") que se llena con gastos extraordinarios (con proveedor y categoría), debajo de las 4 KPI cards en la pantalla de Costos.

**Architecture:** Nueva tabla `extraordinary_expenses` (espeja `expenses`, month-scoped) + tabla genérica `app_settings` (key/value) para el % customizable. Servicios calcados de `expenseService`. Lógica pura testeable en `contingencyFund.js`. UI: componente `ContingencyFundBar` presentacional integrado en `CostsPage`, con dropdown colapsable que lista los extraordinarios agrupados por categoría (reusa `CategoryGroup` + `groupByCategory`).

**Tech Stack:** React 19, Supabase (PostgreSQL + RLS), Tailwind, iconoir-react, Jest (via craco), date-fns.

## Global Constraints

- Variables y código en inglés; textos de UI en español.
- No usar `;` en JS/JSX cuando no es obligatorio.
- Named exports para servicios; default export para componentes de página/UI.
- Servicios usan el cliente Supabase directo (`src/services/supabase/client.js`).
- Re-exportar todo servicio nuevo en `src/services/api.js` (facade backward-compat).
- RLS de gastos = cualquier autenticado (`is_authenticated()`); edición del % = `is_admin_or_superadmin()`.
- Correr un solo test file: `CI=true npx craco test <path> --watchAll=false`.
- Migraciones aplicadas vía Supabase MCP (`apply_migration`), próxima es la **040**.
- Formato de commit termina con: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Migración 040 — tablas, view, trigger, RLS

**Files:**
- Create: `supabase/migrations/040_contingency_fund.sql`
- Apply: vía Supabase MCP `apply_migration` (name: `contingency_fund`)

**Interfaces:**
- Produces: tabla `extraordinary_expenses`, view `extraordinary_expenses_view` (campos camelCase `supplierId`, `categoryId`, `categoryName`, `description`, `amount`, `year`, `month`, `date`, `notes`, `createdAt`, `updatedAt`), tabla `app_settings(key, value, updated_at)` con seed `contingency_fund_pct = '10'`.

- [ ] **Step 1: Escribir la migración**

Create `supabase/migrations/040_contingency_fund.sql`:

```sql
-- 040_contingency_fund.sql
-- Contingency fund: extraordinary expenses (full-access, supplier + category)
-- and a generic app_settings table holding the customizable fund percentage.

-- 1. Extraordinary expenses (mirrors expenses; month-scoped) --------------
CREATE TABLE extraordinary_expenses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  year        INT NOT NULL,
  month       INT NOT NULL CHECK (month BETWEEN 0 AND 11),
  date        DATE NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_extraordinary_expenses_year_month ON extraordinary_expenses (year, month);

CREATE TRIGGER update_extraordinary_expenses_updated_at
  BEFORE UPDATE ON extraordinary_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE VIEW extraordinary_expenses_view AS
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
FROM extraordinary_expenses e
LEFT JOIN expense_categories c ON c.id = e.category_id;

ALTER TABLE extraordinary_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Extraordinary expenses viewable by authenticated"   ON extraordinary_expenses FOR SELECT USING (is_authenticated());
CREATE POLICY "Extraordinary expenses insertable by authenticated" ON extraordinary_expenses FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Extraordinary expenses updatable by authenticated"  ON extraordinary_expenses FOR UPDATE USING (is_authenticated());
CREATE POLICY "Extraordinary expenses deletable by authenticated"  ON extraordinary_expenses FOR DELETE USING (is_authenticated());

-- 2. Generic app settings (key/value) ------------------------------------
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (key, value) VALUES ('contingency_fund_pct', '10');

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "App settings viewable by authenticated" ON app_settings FOR SELECT USING (is_authenticated());
CREATE POLICY "App settings insertable by admins"      ON app_settings FOR INSERT WITH CHECK (is_admin_or_superadmin());
CREATE POLICY "App settings updatable by admins"       ON app_settings FOR UPDATE USING (is_admin_or_superadmin());
```

- [ ] **Step 2: Aplicar la migración vía MCP**

Usar `mcp__supabase__apply_migration` con `name: "contingency_fund"` y el SQL de arriba.
Expected: sin error.

- [ ] **Step 3: Verificar tablas creadas**

Usar `mcp__supabase__execute_sql` con:
```sql
SELECT key, value FROM app_settings WHERE key = 'contingency_fund_pct';
```
Expected: una fila `contingency_fund_pct | 10`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/040_contingency_fund.sql
git commit -m "feat(costs): migración 040 fondo de contingencia y gastos extraordinarios

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Lógica pura del fondo (`contingencyFund.js`) — TDD

**Files:**
- Create: `src/services/expenses/contingencyFund.js`
- Test: `src/services/expenses/contingencyFund.test.js`

**Interfaces:**
- Produces:
  - `contingencyLimit(fixedMonthly: number, pct: number): number`
  - `contingencyStatus(consumed: number, limit: number): { fillPct: number, remaining: number, over: boolean }`

- [ ] **Step 1: Escribir el test que falla**

Create `src/services/expenses/contingencyFund.test.js`:

```js
import { contingencyLimit, contingencyStatus } from './contingencyFund'

describe('contingencyLimit', () => {
  test('applies the percentage to the monthlyized base', () => {
    expect(contingencyLimit(100000, 10)).toBe(10000)
  })
  test('zero base gives zero limit', () => {
    expect(contingencyLimit(0, 10)).toBe(0)
  })
})

describe('contingencyStatus', () => {
  test('under limit: partial fill, positive remaining, not over', () => {
    expect(contingencyStatus(2500, 10000)).toEqual({ fillPct: 25, remaining: 7500, over: false })
  })
  test('exactly at limit: 100% fill, zero remaining, not over', () => {
    expect(contingencyStatus(10000, 10000)).toEqual({ fillPct: 100, remaining: 0, over: false })
  })
  test('over limit: fill capped at 100, negative remaining, over true', () => {
    expect(contingencyStatus(12000, 10000)).toEqual({ fillPct: 100, remaining: -2000, over: true })
  })
  test('zero limit with spend: 100% fill and over', () => {
    expect(contingencyStatus(500, 0)).toEqual({ fillPct: 100, remaining: -500, over: true })
  })
  test('zero limit with zero spend: 0% fill and not over', () => {
    expect(contingencyStatus(0, 0)).toEqual({ fillPct: 0, remaining: 0, over: false })
  })
})
```

- [ ] **Step 2: Correr el test para ver que falla**

Run: `CI=true npx craco test src/services/expenses/contingencyFund.test.js --watchAll=false`
Expected: FAIL (Cannot find module './contingencyFund' o funciones undefined).

- [ ] **Step 3: Implementar la lógica**

Create `src/services/expenses/contingencyFund.js`:

```js
// Pure math for the contingency fund. Follows fixedExpenseCalc's style.

// Budget limit: pct % of the monthlyized fixed-expense base.
export function contingencyLimit(fixedMonthly, pct) {
  return Number(fixedMonthly) * Number(pct) / 100
}

// Fund status against a limit.
// fillPct is clamped to [0, 100]; remaining may go negative; over = spend beyond limit.
export function contingencyStatus(consumed, limit) {
  const c = Number(consumed)
  const l = Number(limit)
  const over = c > l
  const fillPct = l > 0 ? Math.min(100, (c / l) * 100) : (c > 0 ? 100 : 0)
  return { fillPct, remaining: l - c, over }
}
```

- [ ] **Step 4: Correr el test para ver que pasa**

Run: `CI=true npx craco test src/services/expenses/contingencyFund.test.js --watchAll=false`
Expected: PASS (5 passed en el segundo describe, 2 en el primero).

- [ ] **Step 5: Commit**

```bash
git add src/services/expenses/contingencyFund.js src/services/expenses/contingencyFund.test.js
git commit -m "feat(costs): lógica pura del fondo de contingencia

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Servicios de datos (extraordinarios + settings) + re-exports

**Files:**
- Create: `src/services/expenses/extraordinaryExpenseService.js`
- Create: `src/services/settings/appSettingsService.js`
- Modify: `src/services/api.js:131` (agregar bloques export tras el bloque de expenseService)

**Interfaces:**
- Consumes: view `extraordinary_expenses_view`, tablas `extraordinary_expenses`, `app_settings` (Task 1).
- Produces:
  - `getExtraordinaryByMonth(year, month): Promise<Expense[]>` (objetos con `id, supplierId, categoryId, categoryName, description, amount, year, month, date, notes`)
  - `createExtraordinary(data)`, `updateExtraordinary(id, data)`, `deleteExtraordinary(id)`
  - `getSetting(key): Promise<string|null>`, `setSetting(key, value): Promise<void>`

- [ ] **Step 1: Crear el servicio de gastos extraordinarios**

Create `src/services/expenses/extraordinaryExpenseService.js`:

```js
import { supabase } from '../supabase/client'

// Extraordinary expenses for a 0-indexed month (most recent first).
export async function getExtraordinaryByMonth(year, month) {
  const { data, error } = await supabase
    .from('extraordinary_expenses_view')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .order('date', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

export async function createExtraordinary(expenseData) {
  const { data, error } = await supabase
    .from('extraordinary_expenses')
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
  return transformExtraordinary(data)
}

export async function updateExtraordinary(id, expenseData) {
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
    .from('extraordinary_expenses')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return transformExtraordinary(data)
}

export async function deleteExtraordinary(id) {
  const { error } = await supabase.from('extraordinary_expenses').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

function transformExtraordinary(expense) {
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

- [ ] **Step 2: Crear el servicio de settings**

Create `src/services/settings/appSettingsService.js`:

```js
import { supabase } from '../supabase/client'

// Read a single global setting value (string) or null if absent.
export async function getSetting(key) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.value ?? null
}

// Upsert a global setting. RLS restricts writes to admin/superadmin.
export async function setSetting(key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value: String(value) })
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 3: Re-exportar en api.js**

Modify `src/services/api.js`, insertar tras el bloque `} from './expenses/expenseService'` (línea 131):

```js
export {
  getExtraordinaryByMonth,
  createExtraordinary,
  updateExtraordinary,
  deleteExtraordinary
} from './expenses/extraordinaryExpenseService'

export {
  contingencyLimit,
  contingencyStatus
} from './expenses/contingencyFund'

export {
  getSetting,
  setSetting
} from './settings/appSettingsService'
```

- [ ] **Step 4: Verificar que compila (lint/build no rompe imports)**

Run: `CI=true npx craco test src/services/expenses/contingencyFund.test.js --watchAll=false`
Expected: PASS (confirma que los imports del árbol de servicios resuelven).

- [ ] **Step 5: Commit**

```bash
git add src/services/expenses/extraordinaryExpenseService.js src/services/settings/appSettingsService.js src/services/api.js
git commit -m "feat(costs): servicios de gastos extraordinarios y app_settings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Feature RBAC `expense_settings` (admin+)

**Files:**
- Modify: `src/context/AuthContext.jsx:7-15` (agregar entrada a `FEATURE_ROLES`)

**Interfaces:**
- Produces: `hasAccess('expense_settings')` → true solo para admin y superadmin.

- [ ] **Step 1: Agregar el feature**

Modify `src/context/AuthContext.jsx`, dentro de `FEATURE_ROLES` (después de `statistics`):

```js
  statistics: ['admin', 'superadmin'],
  expense_settings: ['admin', 'superadmin']
```

(Recordá quitar/mantener la coma correcta: `statistics` pasa a tener coma al final.)

- [ ] **Step 2: Commit**

```bash
git add src/context/AuthContext.jsx
git commit -m "feat(costs): feature expense_settings (admin+) para editar el % del fondo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Componente `ContingencyFundBar` (presentacional)

**Files:**
- Create: `src/pages/Costs/ContingencyFundBar.jsx`

**Interfaces:**
- Consumes: `contingencyStatus` (Task 2), `formatCurrency` de `../../utils/format`.
- Produces: default export `ContingencyFundBar` con props:
  - `limitAmount: number`, `consumed: number`, `pct: number`
  - `canEdit: boolean`, `onSavePct: (newPct: number) => Promise<void>`
  - `count: number` (cantidad de extraordinarios del mes)
  - `children: ReactNode` (contenido del dropdown)

- [ ] **Step 1: Crear el componente**

Create `src/pages/Costs/ContingencyFundBar.jsx`:

```jsx
import { useState } from 'react'
import { NavArrowDown, NavArrowRight, EditPencil, Check, Xmark } from 'iconoir-react'
import { formatCurrency } from '../../utils/format'
import { contingencyStatus } from '../../services/expenses/contingencyFund'
import Card from '../../components/ui/Card'

// Contingency-fund progress bar. Limit = pct% of monthlyized fixed expenses,
// filled by extraordinary expenses. Collapsible detail passed as children.
export default function ContingencyFundBar({ limitAmount, consumed, pct, canEdit, onSavePct, count, children }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftPct, setDraftPct] = useState(String(pct))
  const [saving, setSaving] = useState(false)

  const { fillPct, remaining, over } = contingencyStatus(consumed, limitAmount)

  const barColor = over ? 'bg-red-500' : fillPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'

  const saveEdit = async () => {
    const value = Number(draftPct)
    if (!Number.isFinite(value) || value <= 0) return
    setSaving(true)
    try {
      await onSavePct(value)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-4 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">Fondo de contingencia</h3>
            {editing ? (
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  value={draftPct}
                  onChange={(e) => setDraftPct(e.target.value)}
                  className="w-16 px-2 py-0.5 border border-gray-300 rounded text-sm"
                />
                <span className="text-sm text-gray-500">%</span>
                <button onClick={saveEdit} disabled={saving} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => { setEditing(false); setDraftPct(String(pct)) }} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                  <Xmark className="w-4 h-4" />
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-gray-500">
                <span>{pct}% de fijos mensualizado</span>
                {canEdit && (
                  <button onClick={() => setEditing(true)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                    <EditPencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {formatCurrency(consumed)} de {formatCurrency(limitAmount)}
            {over
              ? <span className="text-red-600 font-medium"> · Excedido por {formatCurrency(-remaining)}</span>
              : <span className="text-gray-400"> · Disponible {formatCurrency(remaining)}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 shrink-0"
        >
          {open ? <NavArrowDown className="w-5 h-5" /> : <NavArrowRight className="w-5 h-5" />}
          <span>{count} extraordinario{count === 1 ? '' : 's'}</span>
        </button>
      </div>

      <div className="mt-3 h-3 w-full bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${fillPct}%` }} />
      </div>

      {open && <div className="mt-4">{children}</div>}
    </Card>
  )
}
```

- [ ] **Step 2: Verificar que los íconos existen en iconoir-react**

Run: `node -e "const i=require('iconoir-react'); console.log(['NavArrowDown','NavArrowRight','EditPencil','Check','Xmark'].map(n=>n+':'+(!!i[n])).join(' '))"`
Expected: todos `true`. Si alguno es `false`, sustituir por un ícono equivalente existente (ej. `Xmark`→`Cancel`, `EditPencil`→`Edit`, `Check`→`CheckCircle`) y ajustar el import.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Costs/ContingencyFundBar.jsx
git commit -m "feat(costs): componente ContingencyFundBar con barra de progreso y edición de %

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Integración en `CostsPage` (datos, total, dropdown, modal)

**Files:**
- Modify: `src/pages/Costs/CostsPage.jsx` (imports, estado, `loadData`, totales, render de la barra, nuevo modal)

**Interfaces:**
- Consumes: `getExtraordinaryByMonth`, `createExtraordinary`, `updateExtraordinary`, `deleteExtraordinary`, `getSetting`, `setSetting`, `contingencyLimit` (de `../../services/api`); `ContingencyFundBar` (Task 5); `groupByCategory`/`filterItems` ya importados; `CategoryGroup` ya importado.

- [ ] **Step 1: Ampliar imports desde api**

Modify `src/pages/Costs/CostsPage.jsx`, en el bloque de import desde `'../../services/api'` (líneas 13-49), agregar estos nombres a la lista:

```js
  getExtraordinaryByMonth,
  createExtraordinary,
  updateExtraordinary,
  deleteExtraordinary,
  getSetting,
  setSetting,
  contingencyLimit,
```

Y agregar tras los imports de UI (después de `import CategoryGroup from './CategoryGroup'`):

```js
import ContingencyFundBar from './ContingencyFundBar'
```

- [ ] **Step 2: Estado nuevo**

Modify `CostsPage`, junto a los otros `useState` (tras `const [standaloneCosts, setStandaloneCosts] = useState([])`, línea ~66):

```js
  const [extraordinaryExpenses, setExtraordinaryExpenses] = useState([])
  const [contingencyPct, setContingencyPct] = useState(10)
```

Y junto a los otros modales (tras `const [variableModal, ...]`, línea ~80):

```js
  const [extraordinaryModal, setExtraordinaryModal] = useState({ open: false, item: null })
```

- [ ] **Step 3: Cargar datos en `loadData`**

Modify el primer `Promise.all` de `loadData` (líneas ~96-101) para incluir extraordinarios y el %:

```js
      const [suppliersData, expensesData, fixedData, categoriesData, extraordinaryData, pctSetting] = await Promise.all([
        getSuppliers(),
        getExpensesByMonth(year, month),
        getFixedExpenses(),
        getCategories(),
        getExtraordinaryByMonth(year, month),
        getSetting('contingency_fund_pct')
      ])
      setSuppliers(suppliersData)
      setExpenses(expensesData)
      setFixedExpenses(fixedData)
      setCategories(categoriesData)
      setExtraordinaryExpenses(extraordinaryData)
      setContingencyPct(pctSetting != null ? Number(pctSetting) : 10)
```

- [ ] **Step 4: Totales y agrupación de extraordinarios**

Modify la sección de totales (tras `const totalCashMonth = ...`, línea ~128):

```js
  const extraordinaryTotal = extraordinaryExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const contingencyLimitAmount = contingencyLimit(fixedMonthlyThisMonth, contingencyPct)
```

Y cambiar la línea de `totalCashMonth` (línea ~128) para sumar extraordinarios:

```js
  const totalCashMonth = variableTotal + fixedCashThisMonth + extraordinaryTotal
```

Agregar el agrupado de extraordinarios junto a `variableGroups`/`fixedGroups` (tras línea ~157):

```js
  const extraordinaryGroups = groupByCategory(
    filterItems(extraordinaryExpenses, emptyFilters, expenseAccessors),
    expenseGroupOpts
  )
```

- [ ] **Step 5: Handlers de extraordinarios y edición del %**

Modify `CostsPage`, agregar junto a los otros handlers (tras `handleDeleteExpense`, línea ~182):

```js
  const handleDeleteExtraordinary = async (id) => {
    if (!window.confirm('¿Eliminar este gasto extraordinario del fondo de contingencia?')) return
    try {
      await deleteExtraordinary(id)
      await loadData()
    } catch (e) {
      alert('Error al eliminar: ' + e.message)
    }
  }

  const handleSaveContingencyPct = async (newPct) => {
    try {
      await setSetting('contingency_fund_pct', newPct)
      setContingencyPct(newPct)
    } catch (e) {
      alert('Error al guardar el porcentaje: ' + e.message)
    }
  }
```

- [ ] **Step 6: Renderizar la barra tras las 4 KPI cards**

Modify `CostsPage`, insertar inmediatamente después del cierre del grid de summary cards (`</div>` de la línea ~296, antes de `{loading ? (`):

```jsx
      {/* Contingency fund */}
      <ContingencyFundBar
        limitAmount={contingencyLimitAmount}
        consumed={extraordinaryTotal}
        pct={contingencyPct}
        canEdit={hasAccess('expense_settings')}
        onSavePct={handleSaveContingencyPct}
        count={extraordinaryExpenses.length}
      >
        <div className="flex justify-end mb-3">
          <Button variant="secondary" onClick={() => setExtraordinaryModal({ open: true, item: null })}>
            <Plus className="w-4 h-4" />
            Gasto extraordinario
          </Button>
        </div>
        {extraordinaryGroups.length === 0 ? (
          <Card className="p-6 text-center"><p className="text-gray-500">No hay gastos extraordinarios este mes</p></Card>
        ) : (
          extraordinaryGroups.map(group => (
            <CategoryGroup key={group.key} label={group.label} count={group.items.length} subtotal={group.subtotal}>
              {group.items.map(expense => (
                <VariableExpenseCard
                  key={expense.id}
                  expense={expense}
                  supplierName={getSupplierName(expense.supplierId)}
                  onEdit={() => setExtraordinaryModal({ open: true, item: expense })}
                  onDelete={() => handleDeleteExtraordinary(expense.id)}
                />
              ))}
            </CategoryGroup>
          ))
        )}
      </ContingencyFundBar>
```

- [ ] **Step 7: Montar el modal de extraordinario**

Modify `CostsPage`, agregar junto a los otros modales renderizados (tras `<VariableExpenseModal ... />`, línea ~546):

```jsx
      {/* Extraordinary expense modal */}
      <ExtraordinaryExpenseModal
        isOpen={extraordinaryModal.open}
        onClose={() => setExtraordinaryModal({ open: false, item: null })}
        expense={extraordinaryModal.item}
        categories={categories}
        suppliers={suppliers}
        selectedYear={year}
        selectedMonth={month}
        onSave={loadData}
      />
```

- [ ] **Step 8: Definir `ExtraordinaryExpenseModal`**

Modify `CostsPage.jsx`, agregar esta función tras `VariableExpenseModal` (después de su cierre, línea ~954). Es calcada de `VariableExpenseModal` pero llama a `createExtraordinary`/`updateExtraordinary` y cambia los títulos:

```jsx
// Extraordinary expense modal (contingency fund)
function ExtraordinaryExpenseModal({ isOpen, onClose, expense, categories, suppliers, selectedYear, selectedMonth, onSave }) {
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
      if (expense) await updateExtraordinary(expense.id, payload)
      else await createExtraordinary(payload)
      onSave()
      onClose()
    } catch (err) {
      alert('Error al guardar gasto extraordinario: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={expense ? 'Editar gasto extraordinario' : 'Registrar gasto extraordinario'}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej: Reparación imprevista" required />
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

- [ ] **Step 9: Compilar Tailwind (por si hay clases nuevas)**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`
Expected: sin errores (las clases usadas ya existen en el proyecto; este paso es por convención).

- [ ] **Step 10: Verificación manual end-to-end**

Run: `npm start` y en `/costos`:
1. La barra "Fondo de contingencia" aparece bajo las 4 KPI cards con límite = 10% del card "Fijos mensualizado".
2. Abrir el chevron → "+ Gasto extraordinario", cargar uno con proveedor + categoría → aparece agrupado por categoría y la barra se llena.
3. Cargar extraordinarios hasta superar el límite → barra roja + "Excedido por $X".
4. "Total del mes (caja)" incluye el extraordinario.
5. Como admin/superadmin: el lápiz de editar % aparece, cambiar a 20% y confirmar que el límite se recalcula y persiste al recargar.
6. Como operador: el lápiz NO aparece (y un intento directo de `setSetting` daría error por RLS).

- [ ] **Step 11: Commit**

```bash
git add src/pages/Costs/CostsPage.jsx src/tailwind.output.css
git commit -m "feat(costs): integrar fondo de contingencia y gastos extraordinarios en CostsPage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notas de verificación final

- Correr toda la suite de servicios: `CI=true npx craco test src/services --watchAll=false` → verde.
- Confirmar que no se tocó la sección de Sueldos ni `salary_extra_costs`.
- Confirmar que operador puede ver/cargar/editar/borrar extraordinarios pero no editar el %.
