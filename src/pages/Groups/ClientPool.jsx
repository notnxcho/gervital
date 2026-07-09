import { useState, useRef, useEffect } from 'react'
import { Filter } from 'iconoir-react'
import { PoolClientChip, AbsenceClientChip } from './ClientChip'
import Toggle from '../../components/ui/Toggle'

const matchName = (c, term) =>
  c.firstName?.toLowerCase().includes(term) || c.lastName?.toLowerCase().includes(term)

const TIERS = ['A', 'B', 'C', 'D']
const TIER_COLORS = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-amber-100 text-amber-700',
  D: 'bg-red-100 text-red-700'
}

export default function ClientPool({
  clients,
  clientsInAllSlots,
  recoveryIds,
  absentClients = [],
  vacationClients = []
}) {
  const [search, setSearch] = useState('')
  const [showAbsences, setShowAbsences] = useState(true)
  const [showAssignedAll, setShowAssignedAll] = useState(true)
  const [tierFilter, setTierFilter] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterRef = useRef(null)

  // Cerrar el popover de filtros al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFiltersOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const term = search.toLowerCase()
  // Los clientes ya asignados a todos los horarios salen de la lista principal
  // y pasan a su propio contenedor colapsable al final
  const assignedToAllClients = clients.filter(c => clientsInAllSlots?.has(c.id))
  const visible = clients.filter(c => !clientsInAllSlots?.has(c.id))
  const byTier = tierFilter ? visible.filter(c => c.cognitiveLevel === tierFilter) : visible
  const filtered = search ? byTier.filter(c => matchName(c, term)) : byTier
  const filteredAssignedToAll = search ? assignedToAllClients.filter(c => matchName(c, term)) : assignedToAllClients
  const filteredAbsent = search ? absentClients.filter(c => matchName(c, term)) : absentClients
  const filteredVacation = search ? vacationClients.filter(c => matchName(c, term)) : vacationClients
  const absenceTotal = absentClients.length + vacationClients.length

  return (
    <div className="w-60 flex-shrink-0 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Asistentes ({clients.length})
      </div>
      <div className="flex items-stretch gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar..."
          className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <div className="relative flex-shrink-0" ref={filterRef}>
          <button
            type="button"
            onClick={() => setFiltersOpen(o => !o)}
            title="Filtros"
            aria-label="Filtros"
            className={`flex items-center justify-center w-9 h-full rounded-lg border transition-colors ${
              tierFilter
                ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}
          >
            <Filter className="w-4 h-4" />
            {tierFilter && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-500 ring-2 ring-gray-50" />
            )}
          </button>

          {filtersOpen && (
            <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-gray-100 rounded-2xl shadow-xl ring-1 ring-black/5 z-20 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tier cognitivo</span>
                {tierFilter && (
                  <button
                    type="button"
                    onClick={() => setTierFilter(null)}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Limpiar
                  </button>
                )}
              </div>
              <div className="flex gap-1.5">
                {TIERS.map(tier => {
                  const active = tierFilter === tier
                  return (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setTierFilter(active ? null : tier)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                        active ? TIER_COLORS[tier] : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {tier}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Faltas: contenedor arriba de los asistentes con su switch */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3">
        <Toggle
          id="toggle-absences-pool"
          checked={showAbsences}
          onChange={setShowAbsences}
          label={`Mostrar faltas${absenceTotal > 0 ? ` (${absenceTotal})` : ''}`}
        />

        {showAbsences && (
          <div className="mt-3">
            {absenceTotal === 0 && (
              <p className="text-xs text-gray-400 text-center py-2">Sin faltas ni vacaciones este día</p>
            )}

            {filteredAbsent.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {filteredAbsent.map(client => (
                  <AbsenceClientChip key={client.id} client={client} variant="absent" />
                ))}
              </div>
            )}

            {filteredVacation.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
                  Vacaciones ({filteredVacation.length})
                </div>
                <div className="flex flex-col gap-1.5">
                  {filteredVacation.map(client => (
                    <AbsenceClientChip key={client.id} client={client} variant="vacation" />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {filtered.map(client => (
          <PoolClientChip
            key={client.id}
            client={client}
            isRecovery={recoveryIds?.has(client.id)}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">Sin resultados</p>
        )}
      </div>

      {/* Asignados a todos los horarios: contenedor al final con su switch */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
        <Toggle
          id="toggle-assigned-all-pool"
          checked={showAssignedAll}
          onChange={setShowAssignedAll}
          label={`Asignados a todo${assignedToAllClients.length > 0 ? ` (${assignedToAllClients.length})` : ''}`}
        />

        {showAssignedAll && (
          <div className="mt-3 flex flex-col gap-1.5">
            {filteredAssignedToAll.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">Nadie asignado a todos los horarios</p>
            ) : (
              filteredAssignedToAll.map(client => (
                <PoolClientChip
                  key={client.id}
                  client={client}
                  assignedToAll
                  isRecovery={recoveryIds?.has(client.id)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
