import { useState } from 'react'
import { PoolClientChip } from './ClientChip'

export default function ClientPool({ clients }) {
  const [search, setSearch] = useState('')

  const filtered = search
    ? clients.filter(c => {
        const term = search.toLowerCase()
        return (
          c.firstName?.toLowerCase().includes(term) ||
          c.lastName?.toLowerCase().includes(term)
        )
      })
    : clients

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
          <PoolClientChip key={client.id} client={client} />
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">Sin resultados</p>
        )}
      </div>
    </div>
  )
}
