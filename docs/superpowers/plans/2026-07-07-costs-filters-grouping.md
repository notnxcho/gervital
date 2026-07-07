# Filtros y agrupación por categoría en Costos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar agrupación por categoría (con subtotales) y filtros a las tres secciones de listado de `CostsPage.jsx` (Gastos fijos, Gastos variables, Proveedores).

**Architecture:** Se extrae la lógica de filtrado/agrupación a un módulo puro testeado (`src/services/costs/costsFilters.js`), y dos componentes presentacionales reutilizables (`CostsFilterBar`, `CategoryGroup`). `CostsPage.jsx` compone estas piezas por sección, envolviendo los cards existentes sin cambiar el backend ni el modelo de datos.

**Tech Stack:** React 19, Tailwind CSS 3, Jest (via react-scripts), date-fns, iconoir-react.

## Global Constraints

- Variables y código en inglés; textos de UI en español.
- No usar `;` al final de línea en JS/JSX cuando no es obligatorio.
- Named exports para servicios; default export para componentes de página.
- Estilo de inputs existente: `border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500`.
- Montos formateados con `formatCurrency` de `../../utils/format`.
- Sin cambios de backend ni de modelo de datos.
- Test runner: `CI=true npx react-scripts test <path> --watchAll=false`.

---

## File Structure

- **Create** `src/services/costs/costsFilters.js` — lógica pura: `filterItems`, `groupByCategory`, constante `NONE_KEY`.
- **Create** `src/services/costs/costsFilters.test.js` — tests unitarios.
- **Create** `src/pages/Costs/CostsFilterBar.jsx` — barra de filtros reutilizable.
- **Create** `src/pages/Costs/CategoryGroup.jsx` — encabezado colapsable con subtotal.
- **Modify** `src/pages/Costs/CostsPage.jsx` — integrar filtros+agrupación en las 3 secciones.

---

### Task 1: Lógica pura de filtrado y agrupación

**Files:**
- Create: `src/services/costs/costsFilters.js`
- Test: `src/services/costs/costsFilters.test.js`

**Interfaces:**
- Produces:
  - `NONE_KEY` (string `'__none__'`) — sentinel para "sin categoría" / "sin proveedor".
  - `filterItems(items, filters, accessors) -> Array` donde
    `filters = { query?, categoryId?, supplierId?, minAmount?, maxAmount? }` y
    `accessors = { getText?, getCategoryId?, getSupplierId?, getAmount? }`.
  - `groupByCategory(items, { getKey, getLabel, getAmount? }) -> Array<{ key, label, items, subtotal }>`.

- [ ] **Step 1: Write the failing tests**

Create `src/services/costs/costsFilters.test.js`:

```js
import { filterItems, groupByCategory, NONE_KEY } from './costsFilters'

const items = [
  { id: 1, text: 'Reparación heladera', cat: 'c1', sup: 's1', amount: 8500 },
  { id: 2, text: 'Verduras semana', cat: 'c2', sup: 's2', amount: 4000 },
  { id: 3, text: 'Detergente', cat: null, sup: null, amount: 3200 },
  { id: 4, text: 'Carne', cat: 'c2', sup: 's2', amount: 8500 }
]

const accessors = {
  getText: (i) => i.text,
  getCategoryId: (i) => i.cat,
  getSupplierId: (i) => i.sup,
  getAmount: (i) => i.amount
}

describe('filterItems', () => {
  test('empty filters is passthrough', () => {
    expect(filterItems(items, {}, accessors)).toHaveLength(4)
  })
  test('text filter is case-insensitive and matches substring', () => {
    const r = filterItems(items, { query: 'VERD' }, accessors)
    expect(r.map(i => i.id)).toEqual([2])
  })
  test('category filter matches by id', () => {
    const r = filterItems(items, { categoryId: 'c2' }, accessors)
    expect(r.map(i => i.id)).toEqual([2, 4])
  })
  test('category filter NONE_KEY matches null category', () => {
    const r = filterItems(items, { categoryId: NONE_KEY }, accessors)
    expect(r.map(i => i.id)).toEqual([3])
  })
  test('supplier filter NONE_KEY matches null supplier', () => {
    const r = filterItems(items, { supplierId: NONE_KEY }, accessors)
    expect(r.map(i => i.id)).toEqual([3])
  })
  test('amount range inclusive on both bounds', () => {
    const r = filterItems(items, { minAmount: 4000, maxAmount: 8500 }, accessors)
    expect(r.map(i => i.id)).toEqual([1, 2, 4])
  })
  test('only minAmount', () => {
    const r = filterItems(items, { minAmount: 5000 }, accessors)
    expect(r.map(i => i.id)).toEqual([1, 4])
  })
  test('filters combine with AND', () => {
    const r = filterItems(items, { categoryId: 'c2', minAmount: 5000 }, accessors)
    expect(r.map(i => i.id)).toEqual([4])
  })
  test('missing accessor is ignored (no amount accessor)', () => {
    const r = filterItems(items, { minAmount: 5000 }, { getText: (i) => i.text })
    expect(r).toHaveLength(4)
  })
  test('empty string / undefined filter values do not narrow', () => {
    const r = filterItems(items, { query: '', categoryId: '', minAmount: undefined }, accessors)
    expect(r).toHaveLength(4)
  })
})

describe('groupByCategory', () => {
  const catItems = [
    { id: 1, cat: 'c2', catName: 'Limpieza', amount: 3200 },
    { id: 2, cat: 'c1', catName: 'Alimentación', amount: 4000 },
    { id: 3, cat: null, catName: null, amount: 1000 },
    { id: 4, cat: 'c1', catName: 'Alimentación', amount: 8500 }
  ]
  const opts = {
    getKey: (i) => i.cat,
    getLabel: (i) => i.catName,
    getAmount: (i) => i.amount
  }
  test('groups sorted alphabetically by label with Sin categoría last', () => {
    const g = groupByCategory(catItems, opts)
    expect(g.map(x => x.label)).toEqual(['Alimentación', 'Limpieza', 'Sin categoría'])
  })
  test('subtotals sum per group', () => {
    const g = groupByCategory(catItems, opts)
    expect(g.find(x => x.label === 'Alimentación').subtotal).toBe(12500)
    expect(g.find(x => x.label === 'Sin categoría').subtotal).toBe(1000)
  })
  test('items land in the right group', () => {
    const g = groupByCategory(catItems, opts)
    expect(g.find(x => x.label === 'Alimentación').items.map(i => i.id)).toEqual([2, 4])
  })
  test('Sin categoría uses NONE_KEY as key', () => {
    const g = groupByCategory(catItems, opts)
    expect(g.find(x => x.label === 'Sin categoría').key).toBe(NONE_KEY)
  })
  test('without getAmount subtotal is 0', () => {
    const g = groupByCategory(catItems, { getKey: (i) => i.cat, getLabel: (i) => i.catName })
    expect(g[0].subtotal).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx react-scripts test src/services/costs/costsFilters.test.js --watchAll=false`
Expected: FAIL — "Cannot find module './costsFilters'".

- [ ] **Step 3: Write the implementation**

Create `src/services/costs/costsFilters.js`:

```js
export const NONE_KEY = '__none__'

const normKey = (raw) => (raw == null || raw === '' ? NONE_KEY : String(raw))

// Filter a list of items by query/category/supplier/amount-range.
// Empty/undefined filter values do not narrow. Missing accessors are skipped.
export function filterItems(items, filters = {}, accessors = {}) {
  const { query, categoryId, supplierId, minAmount, maxAmount } = filters
  const { getText, getCategoryId, getSupplierId, getAmount } = accessors
  const q = query ? query.trim().toLowerCase() : ''

  return items.filter(item => {
    if (q && getText) {
      const text = (getText(item) || '').toLowerCase()
      if (!text.includes(q)) return false
    }
    if (categoryId && getCategoryId) {
      if (normKey(getCategoryId(item)) !== String(categoryId)) return false
    }
    if (supplierId && getSupplierId) {
      if (normKey(getSupplierId(item)) !== String(supplierId)) return false
    }
    if (getAmount) {
      const amount = Number(getAmount(item))
      if (minAmount !== '' && minAmount != null && amount < Number(minAmount)) return false
      if (maxAmount !== '' && maxAmount != null && amount > Number(maxAmount)) return false
    }
    return true
  })
}

// Group items by category into ordered buckets with subtotals.
// Alphabetical by label; the NONE_KEY ("Sin categoría") bucket is always last.
export function groupByCategory(items, { getKey, getLabel, getAmount } = {}) {
  const map = new Map()

  for (const item of items) {
    const key = normKey(getKey ? getKey(item) : null)
    const label = key === NONE_KEY ? 'Sin categoría' : (getLabel ? getLabel(item) : '') || 'Sin categoría'
    if (!map.has(key)) map.set(key, { key, label, items: [], subtotal: 0 })
    const group = map.get(key)
    group.items.push(item)
    if (getAmount) group.subtotal += Number(getAmount(item)) || 0
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.key === NONE_KEY) return 1
    if (b.key === NONE_KEY) return -1
    return a.label.localeCompare(b.label, 'es')
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CI=true npx react-scripts test src/services/costs/costsFilters.test.js --watchAll=false`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/costs/costsFilters.js src/services/costs/costsFilters.test.js
git commit -m "feat(costs): lógica pura de filtrado y agrupación por categoría

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Componente `CategoryGroup`

**Files:**
- Create: `src/pages/Costs/CategoryGroup.jsx`

**Interfaces:**
- Consumes: `formatCurrency` from `../../utils/format`.
- Produces: default export `CategoryGroup` con props
  `{ label, count, subtotal?, defaultOpen = true, children }`.
  Si `subtotal` es `undefined`/`null`/`0` y la sección no lleva monto, no lo muestra;
  para mostrarlo siempre que exista, se pasa `subtotal` como número (incluido 0). Regla:
  se muestra el subtotal solo cuando `subtotal != null && showSubtotal`. Para simplificar,
  el prop `subtotal` se muestra cuando es un número finito distinto de `undefined`/`null`.

- [ ] **Step 1: Create the component**

Create `src/pages/Costs/CategoryGroup.jsx`:

```jsx
import { useState } from 'react'
import { NavArrowDown, NavArrowRight } from 'iconoir-react'
import { formatCurrency } from '../../utils/format'

// Collapsible category header wrapping already-rendered item cards.
export default function CategoryGroup({ label, count, subtotal, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const showSubtotal = subtotal != null

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <NavArrowDown className="w-4 h-4 text-gray-500 shrink-0" /> : <NavArrowRight className="w-4 h-4 text-gray-500 shrink-0" />}
          <span className="font-medium text-gray-900 truncate">{label}</span>
          <span className="text-xs text-gray-500 shrink-0">({count})</span>
        </div>
        {showSubtotal && (
          <span className="text-sm font-semibold text-gray-700 shrink-0">{formatCurrency(subtotal)}</span>
        )}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `CI=true npx react-scripts test --watchAll=false --passWithNoTests src/pages/Costs`
Expected: PASS (no tests, compiles). Alternatively confirm no import/JSX errors by building later in Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Costs/CategoryGroup.jsx
git commit -m "feat(costs): componente CategoryGroup colapsable con subtotal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Componente `CostsFilterBar`

**Files:**
- Create: `src/pages/Costs/CostsFilterBar.jsx`

**Interfaces:**
- Consumes: `NONE_KEY` from `../../services/costs/costsFilters`.
- Produces: default export `CostsFilterBar` con props:
  - `filters` — `{ query, categoryId, supplierId, minAmount, maxAmount }`
  - `onChange(nextFilters)` — recibe el objeto de filtros completo actualizado
  - `categoryOptions` — `Array<{ value, label }>` (sin incluir "Sin categoría"; el componente la agrega con `NONE_KEY`)
  - `supplierOptions` — `Array<{ value, label }>` opcional; si se pasa, muestra el dropdown de proveedor (agrega "Sin proveedor" con `NONE_KEY`)
  - `showAmountRange` — bool, muestra inputs min/max
  - `searchPlaceholder` — string

- [ ] **Step 1: Create the component**

Create `src/pages/Costs/CostsFilterBar.jsx`:

```jsx
import { Search } from 'iconoir-react'
import { NONE_KEY } from '../../services/costs/costsFilters'

const selectClass = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'

// Reusable filter row for a costs section. Controls shown depend on props.
export default function CostsFilterBar({
  filters,
  onChange,
  categoryOptions = [],
  supplierOptions = null,
  showAmountRange = false,
  searchPlaceholder = 'Buscar…'
}) {
  const set = (patch) => onChange({ ...filters, ...patch })

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={filters.query || ''}
          onChange={(e) => set({ query: e.target.value })}
          placeholder={searchPlaceholder}
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        />
      </div>

      <select value={filters.categoryId || ''} onChange={(e) => set({ categoryId: e.target.value })} className={selectClass}>
        <option value="">Todas las categorías</option>
        {categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value={NONE_KEY}>Sin categoría</option>
      </select>

      {supplierOptions && (
        <select value={filters.supplierId || ''} onChange={(e) => set({ supplierId: e.target.value })} className={selectClass}>
          <option value="">Todos los proveedores</option>
          {supplierOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value={NONE_KEY}>Sin proveedor</option>
        </select>
      )}

      {showAmountRange && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={filters.minAmount ?? ''}
            onChange={(e) => set({ minAmount: e.target.value })}
            placeholder="Mín"
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <span className="text-gray-400">–</span>
          <input
            type="number"
            value={filters.maxAmount ?? ''}
            onChange={(e) => set({ maxAmount: e.target.value })}
            placeholder="Máx"
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Costs/CostsFilterBar.jsx
git commit -m "feat(costs): componente CostsFilterBar reutilizable

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Integrar en Gastos variables

**Files:**
- Modify: `src/pages/Costs/CostsPage.jsx`

**Interfaces:**
- Consumes: `filterItems`, `groupByCategory`, `NONE_KEY` de `../../services/costs/costsFilters`; `CostsFilterBar`, `CategoryGroup`.

- [ ] **Step 1: Add imports**

En `CostsPage.jsx`, después de los imports de UI (tras `import Input from '../../components/ui/Input'`), agregar:

```jsx
import { filterItems, groupByCategory } from '../../services/costs/costsFilters'
import CostsFilterBar from './CostsFilterBar'
import CategoryGroup from './CategoryGroup'
```

- [ ] **Step 2: Add filter state**

Dentro de `CostsPage`, junto a los otros `useState` (después de `const [standaloneCosts, setStandaloneCosts] = useState([])`), agregar el estado de filtros de las tres secciones (fijos y proveedores se usan en tasks posteriores; se agregan todos juntos acá para un solo commit de estado):

```jsx
  const emptyFilters = { query: '', categoryId: '', supplierId: '', minAmount: '', maxAmount: '' }
  const [variableFilters, setVariableFilters] = useState(emptyFilters)
  const [fixedFilters, setFixedFilters] = useState(emptyFilters)
  const [supplierFilters, setSupplierFilters] = useState({ query: '', categoryId: '' })
```

- [ ] **Step 3: Build derived options and grouped data for variables**

Después de los cálculos de totales del mes (tras `const totalCashMonth = variableTotal + fixedCashThisMonth`), agregar helpers de opciones y accessors reutilizados:

```jsx
  // Filter option lists derived from loaded data.
  const categoryOptions = categories.map(c => ({ value: c.id, label: c.name }))
  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }))

  // Accessors shared by fixed & variable expenses.
  const expenseAccessors = {
    getText: (e) => [e.description, e.notes, e.supplierName].filter(Boolean).join(' '),
    getCategoryId: (e) => e.categoryId,
    getSupplierId: (e) => e.supplierId,
    getAmount: (e) => Number(e.amount)
  }
  const expenseGroupOpts = {
    getKey: (e) => e.categoryId,
    getLabel: (e) => e.categoryName,
    getAmount: (e) => Number(e.amount)
  }

  const variableGroups = groupByCategory(
    filterItems(expenses, variableFilters, expenseAccessors),
    expenseGroupOpts
  )
```

- [ ] **Step 4: Replace the variable expenses render block**

Reemplazar el bloque actual (líneas del div de "Gastos variables (mes)", el `<h3>` con el punto ámbar y su lista) por la versión con filtro + grupos:

```jsx
          {/* Gastos variables (mes) */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              Gastos variables
            </h3>
            <CostsFilterBar
              filters={variableFilters}
              onChange={setVariableFilters}
              categoryOptions={categoryOptions}
              supplierOptions={supplierOptions}
              showAmountRange
              searchPlaceholder="Buscar gasto…"
            />
            {variableGroups.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-500">No hay gastos variables este mes</p></Card>
            ) : (
              variableGroups.map(group => (
                <CategoryGroup key={group.key} label={group.label} count={group.items.length} subtotal={group.subtotal}>
                  {group.items.map(expense => (
                    <VariableExpenseCard
                      key={expense.id}
                      expense={expense}
                      supplierName={getSupplierName(expense.supplierId)}
                      onEdit={() => setVariableModal({ open: true, item: expense })}
                      onDelete={() => setDeleteModal({ open: true, type: 'expense', item: expense })}
                    />
                  ))}
                </CategoryGroup>
              ))
            )}
          </div>
```

- [ ] **Step 5: Verify build compiles and run app**

Run: `npm run build`
Expected: build sin errores.

Verificación manual: `npm start`, ir a Costos. Los gastos variables aparecen agrupados por categoría con subtotales; el buscador, dropdown de categoría/proveedor y rango de monto acotan la lista; los grupos colapsan/expanden.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Costs/CostsPage.jsx
git commit -m "feat(costs): filtros y agrupación por categoría en gastos variables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Integrar en Gastos fijos

**Files:**
- Modify: `src/pages/Costs/CostsPage.jsx`

**Interfaces:**
- Consumes: `fixedFilters` state (Task 4), `expenseAccessors`, `expenseGroupOpts`, `categoryOptions`, `supplierOptions`.

- [ ] **Step 1: Build grouped data for fixed expenses**

Después de la definición de `variableGroups` (Task 4, Step 3), agregar:

```jsx
  const fixedGroups = groupByCategory(
    filterItems(fixedExpenses, fixedFilters, expenseAccessors),
    expenseGroupOpts
  )
```

- [ ] **Step 2: Replace the fixed expenses render block**

Reemplazar el bloque actual de "Gastos fijos (plantillas)" (el `<h3>` con el punto azul y su lista) por:

```jsx
          {/* Gastos fijos (plantillas) */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500"></span>
              Gastos fijos
            </h3>
            <CostsFilterBar
              filters={fixedFilters}
              onChange={setFixedFilters}
              categoryOptions={categoryOptions}
              supplierOptions={supplierOptions}
              showAmountRange
              searchPlaceholder="Buscar gasto fijo…"
            />
            {fixedGroups.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-500">Sin gastos fijos</p></Card>
            ) : (
              fixedGroups.map(group => (
                <CategoryGroup key={group.key} label={group.label} count={group.items.length} subtotal={group.subtotal}>
                  {group.items.map(f => (
                    <FixedExpenseCard
                      key={f.id}
                      fixed={f}
                      year={year}
                      month={month}
                      onEdit={() => setFixedModal({ open: true, item: f })}
                      onDelete={() => handleDeleteFixed(f.id)}
                    />
                  ))}
                </CategoryGroup>
              ))
            )}
          </div>
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: build sin errores.

Verificación manual: en Costos, los gastos fijos aparecen agrupados por categoría con subtotal (suma del monto por pago) y los filtros funcionan.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Costs/CostsPage.jsx
git commit -m "feat(costs): filtros y agrupación por categoría en gastos fijos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Integrar en Proveedores

**Files:**
- Modify: `src/pages/Costs/CostsPage.jsx`

**Interfaces:**
- Consumes: `supplierFilters` state (Task 4), `CostsFilterBar`, `CategoryGroup`, `filterItems`, `groupByCategory`.

- [ ] **Step 1: Build derived options and grouped data for suppliers**

Después de `fixedGroups` (Task 5, Step 1), agregar:

```jsx
  // Supplier categories come from the suppliers' own `category` string.
  const supplierCategoryOptions = Array.from(new Set(suppliers.map(s => s.category).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map(c => ({ value: c, label: c }))

  const supplierGroups = groupByCategory(
    filterItems(suppliers, supplierFilters, {
      getText: (s) => [s.name, s.contact, s.notes].filter(Boolean).join(' '),
      getCategoryId: (s) => s.category
    }),
    { getKey: (s) => s.category, getLabel: (s) => s.category }
  )
```

- [ ] **Step 2: Replace the suppliers directory render block**

Reemplazar el contenido interno de la sección de proveedores (el `<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">` con el `.map` de suppliers) manteniendo el header con el botón "Nuevo proveedor". El nuevo cuerpo:

```jsx
        <CostsFilterBar
          filters={supplierFilters}
          onChange={setSupplierFilters}
          categoryOptions={supplierCategoryOptions}
          searchPlaceholder="Buscar proveedor…"
        />

        {supplierGroups.length === 0 ? (
          <Card className="p-6 text-center"><p className="text-gray-500">No hay proveedores</p></Card>
        ) : (
          supplierGroups.map(group => (
            <CategoryGroup key={group.key} label={group.label} count={group.items.length}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.items.map(supplier => (
                  <Card key={supplier.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-gray-900">{supplier.name}</h4>
                        <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                          {supplier.category}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setSupplierModal({ open: true, supplier })}
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteModal({ open: true, type: 'supplier', item: supplier })}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {supplier.contact && (
                      <p className="text-sm text-gray-500 mt-2">{supplier.contact}</p>
                    )}
                    {supplier.phone && (
                      <p className="text-sm text-gray-500">{supplier.phone}</p>
                    )}
                  </Card>
                ))}
              </div>
            </CategoryGroup>
          ))
        )}
```

Nota: el contador del título ("Proveedores (directorio) (N)") se mantiene con `suppliers.length` (total, no filtrado), igual que las tarjetas de resumen del tope no cambian.

- [ ] **Step 3: Verify Tailwind is compiled and build passes**

Run: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css && npm run build`
Expected: Tailwind compila y build sin errores.

Verificación manual: en Costos, los proveedores aparecen agrupados por su categoría (sin subtotal), con buscador y filtro por categoría funcionando; los grupos colapsan/expanden.

- [ ] **Step 4: Run full test suite**

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS — incluyendo `costsFilters.test.js` y los tests existentes.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Costs/CostsPage.jsx src/tailwind.output.css
git commit -m "feat(costs): filtros y agrupación por categoría en proveedores

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Agrupación por categoría con subtotales en fijos/variables, sin subtotal en proveedores → Tasks 1, 2, 4, 5, 6. ✅
- Orden alfabético + "Sin categoría" al final → Task 1 (`groupByCategory`), testeado. ✅
- Grupos colapsables, expandidos por defecto → Task 2 (`CategoryGroup`, `defaultOpen = true`). ✅
- Filtros: categoría, proveedor, texto, rango de monto (gastos); categoría + texto (proveedores) → Tasks 3, 4, 5, 6. ✅
- Combinación AND, vacíos no acotan → Task 1, testeado. ✅
- Empty states respetados tras filtrar → Tasks 4, 5, 6 (rama `groups.length === 0`). ✅
- Tarjetas de resumen del mes no cambian → no se tocan (Task 4 Step 4 conserva totales). ✅
- Sin cambios de backend → ninguna task toca servicios/DB. ✅
- Tests de `costsFilters.js` → Task 1. ✅

**Placeholder scan:** Sin TBD/TODO; todo el código está completo en cada step. ✅

**Type consistency:** `filterItems(items, filters, accessors)`, `groupByCategory(items, {getKey,getLabel,getAmount})`, `NONE_KEY`, y las props de `CostsFilterBar`/`CategoryGroup` se usan idénticas entre tasks. `emptyFilters`/`variableFilters`/`fixedFilters`/`supplierFilters` consistentes. ✅
