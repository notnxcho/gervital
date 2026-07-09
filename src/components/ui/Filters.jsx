import { useState, useEffect, useRef } from 'react'
import { FilterList, NavArrowDown } from 'iconoir-react'

export default function Filters({ filters, onChange, config = [] }) {
  const [showFilters, setShowFilters] = useState(false)
  const filterRef = useRef(null)
  
  // Cerrar filtros al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setShowFilters(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  // Contar filtros activos
  const activeFiltersCount = Object.values(filters).filter(v => v !== null).length
  
  // Limpiar todos los filtros
  const clearFilters = () => {
    const clearedFilters = Object.keys(filters).reduce((acc, key) => {
      acc[key] = null
      return acc
    }, {})
    onChange(clearedFilters)
  }
  
  // Handler para actualizar un filtro específico
  const handleFilterChange = (key, value) => {
    onChange({
      ...filters,
      [key]: filters[key] === value ? null : value
    })
  }

  return (
    <div className="relative" ref={filterRef}>
      <button
        onClick={() => setShowFilters(!showFilters)}
        className={`
          flex items-center gap-2 px-4 h-11 text-sm bg-white border rounded-xl transition-colors
          ${activeFiltersCount > 0
            ? 'border-purple-300 text-purple-700'
            : 'border-gray-200 text-gray-600 hover:border-gray-300'}
        `}
      >
        <FilterList className="w-5 h-5" />
        <span className="font-medium">Filtros</span>
        {activeFiltersCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-purple-600 text-white text-[11px] font-semibold">
            {activeFiltersCount}
          </span>
        )}
        <NavArrowDown className={`w-4 h-4 text-gray-400 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
      </button>

      {/* Filter panel */}
      {showFilters && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white border border-gray-100 rounded-2xl shadow-xl ring-1 ring-black/5 z-20 p-4">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Filtros</h3>
            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm font-medium text-purple-600 hover:text-purple-700"
              >
                Limpiar
              </button>
            )}
          </div>

          {config.map((filterConfig, index) => (
            <FilterSection
              key={filterConfig.key}
              config={filterConfig}
              value={filters[filterConfig.key]}
              onChange={(value) => handleFilterChange(filterConfig.key, value)}
              isLast={index === config.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterSection({ config, value, onChange, isLast }) {
  const { label, options, type = 'single' } = config

  // Booleano: checkbox en línea (ej. "Bajas")
  if (type === 'checkbox') {
    const option = options[0]
    const checked = value === option.value
    return (
      <label className={`flex items-center gap-2.5 cursor-pointer select-none ${isLast ? '' : 'mb-4'}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onChange(option.value)}
          className="w-4 h-4 rounded border-gray-300 accent-purple-600 cursor-pointer"
        />
        <span className="text-sm font-medium text-gray-700">{option.label}</span>
      </label>
    )
  }

  // Icono: solo icono cuando está inactivo, icono + label cuando está activo
  if (type === 'icon') {
    return (
      <div className={isLast ? '' : 'mb-4'}>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
        <div className="flex gap-2">
          {options.map((option) => {
            const isSelected = value === option.value
            const Icon = option.icon
            return (
              <button
                key={option.value?.toString() ?? 'null'}
                onClick={() => onChange(option.value)}
                title={option.label}
                aria-label={option.label}
                className={`
                  flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                  ${isSelected
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'}
                `}
              >
                {Icon && <Icon className="w-4 h-4 shrink-0" />}
                {isSelected && <span className="truncate">{option.label}</span>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={isLast ? '' : 'mb-4'}>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label}
      </label>
      <div className="flex gap-2">
        {options.map((option) => {
          const optionValue = typeof option === 'object' ? option.value : option
          const optionLabel = typeof option === 'object' ? option.label : option
          const isSelected = value === optionValue

          return (
            <button
              key={optionValue?.toString() ?? 'null'}
              onClick={() => onChange(optionValue)}
              className={`
                flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border
                ${isSelected
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-300'}
              `}
            >
              {optionLabel}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Exportar también el contador de filtros activos como utility
export function getActiveFiltersCount(filters) {
  return Object.values(filters).filter(v => v !== null).length
}
