import { useState } from 'react'
import { Search, Filter, NavArrowDown, NavArrowUp, Xmark } from 'iconoir-react'
import { NONE_KEY } from '../../services/costs/costsFilters'

const selectClass = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'

// Reusable filter row for a costs section. Search is always visible; the
// category/supplier/amount controls collapse behind a "Filtros" toggle.
export default function CostsFilterBar({
  filters,
  onChange,
  categoryOptions = [],
  supplierOptions = null,
  showAmountRange = false,
  searchPlaceholder = 'Buscar…'
}) {
  const [open, setOpen] = useState(false)
  const set = (patch) => onChange({ ...filters, ...patch })

  // Count the collapsed (non-search) filters that are active.
  const activeCount =
    (filters.categoryId ? 1 : 0) +
    (supplierOptions && filters.supplierId ? 1 : 0) +
    (showAmountRange && filters.minAmount ? 1 : 0) +
    (showAmountRange && filters.maxAmount ? 1 : 0)

  const clearCollapsed = () => set({ categoryId: '', supplierId: '', minAmount: '', maxAmount: '' })

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
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

        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Filter className="w-4 h-4" />
          <span>Filtros</span>
          {activeCount > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-purple-600 text-white text-xs">
              {activeCount}
            </span>
          )}
          {open ? <NavArrowUp className="w-4 h-4 text-gray-400" /> : <NavArrowDown className="w-4 h-4 text-gray-400" />}
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2 mt-2 p-3 bg-gray-50 rounded-lg">
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

          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearCollapsed}
              className="flex items-center gap-1 px-2 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              <Xmark className="w-4 h-4" />
              Limpiar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
