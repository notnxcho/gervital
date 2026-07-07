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
