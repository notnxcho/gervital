import { useState, useEffect, useRef } from 'react'
import { FilterList } from 'iconoir-react'

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
          flex items-center gap-2 px-4 py-2.5 bg-white border rounded-xl transition-colors
          ${activeFiltersCount > 0 
            ? 'border-purple-300 text-purple-700' 
            : 'border-gray-200 text-gray-600 hover:border-gray-300'}
        `}
      >
        <FilterList className="w-5 h-5" />
        <span className="font-medium">Filtros</span>
        {activeFiltersCount > 0 && (
          <span className="bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded-full">
            {activeFiltersCount}
          </span>
        )}
      </button>
      
      {/* Filter panel */}
      {showFilters && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-20 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Filtros</h3>
            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm text-purple-600 hover:text-purple-700"
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
                px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border
                ${type === 'full' ? 'flex-1' : ''}
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
