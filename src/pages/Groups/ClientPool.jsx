import { useState } from 'react'
import { PoolClientChip, AbsenceClientChip } from './ClientChip'
import Toggle from '../../components/ui/Toggle'

const matchName = (c, term) =>
  c.firstName?.toLowerCase().includes(term) || c.lastName?.toLowerCase().includes(term)

export default function ClientPool({
  clients,
  clientsInAllSlots,
  recoveryIds,
  absentClients = [],
  vacationClients = []
}) {
  const [search, setSearch] = useState('')
  const [showAbsences, setShowAbsences] = useState(false)

  const term = search.toLowerCase()
  const filtered = search ? clients.filter(c => matchName(c, term)) : clients
  const filteredAbsent = search ? absentClients.filter(c => matchName(c, term)) : absentClients
  const filteredVacation = search ? vacationClients.filter(c => matchName(c, term)) : vacationClients
  const absenceTotal = absentClients.length + vacationClients.length

  return (
    <div className="w-60 flex-shrink-0 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Asistentes ({clients.length})
      </div>
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar..."
        className="w-full px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg mb-3 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
      <div className="flex flex-col gap-1.5">
        {filtered.map(client => (
          <PoolClientChip
            key={client.id}
            client={client}
            assignedToAll={clientsInAllSlots?.has(client.id)}
            isRecovery={recoveryIds?.has(client.id)}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">Sin resultados</p>
        )}
      </div>

      {/* Faltas: contenedor al final de los asistentes con su switch */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
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
              <div>
                <div className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">
                  Faltas del día ({filteredAbsent.length})
                </div>
                <div className="flex flex-col gap-1.5">
                  {filteredAbsent.map(client => (
                    <AbsenceClientChip key={client.id} client={client} variant="absent" />
                  ))}
                </div>
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
    </div>
  )
}
