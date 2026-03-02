import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Trash, Refresh, SunLight, HalfMoon, Sparks } from 'iconoir-react'
import { differenceInYears } from 'date-fns'
import { getClients, deleteClient } from '../../services/api'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import Filters, { getActiveFiltersCount } from '../../components/ui/Filters'

// MOCKED RES - Días de la semana
const WEEK_DAYS = [
  { key: 'monday', label: 'Lun' },
  { key: 'tuesday', label: 'Mar' },
  { key: 'wednesday', label: 'Mie' },
  { key: 'thursday', label: 'Jue' },
  { key: 'friday', label: 'Vie' }
]

// MOCKED RES - Colores del tier cognitivo
const COGNITIVE_LEVEL_COLORS = {
  A: 'bg-green-100 text-green-700 border-green-200',
  B: 'bg-blue-100 text-blue-700 border-blue-200',
  C: 'bg-amber-100 text-amber-700 border-amber-200',
  D: 'bg-red-100 text-red-700 border-red-200'
}

// MOCKED RES - Labels y iconos de horario
const SCHEDULE_CONFIG = {
  morning: { label: 'Mañana', Icon: SunLight },
  afternoon: { label: 'Tarde', Icon: HalfMoon },
  full_day: { label: 'Día completo', Icon: Sparks }
}

// Configuración de filtros
const FILTERS_CONFIG = [
  {
    key: 'cognitiveLevel',
    label: 'Tier cognitivo',
    options: ['A', 'B', 'C', 'D']
  },
  {
    key: 'frequency',
    label: 'Frecuencia',
    options: [
      { value: 1, label: '1x' },
      { value: 2, label: '2x' },
      { value: 3, label: '3x' },
      { value: 4, label: '4x' }
    ]
  },
  {
    key: 'hasTransport',
    label: 'Transporte',
    type: 'full',
    options: [
      { value: true, label: 'Con transporte' },
      { value: false, label: 'Sin transporte' }
    ]
  }
]

// MOCKED RES - Calcular edad desde fecha de nacimiento
const calculateAge = (birthDate) => {
  if (!birthDate) return null
  return differenceInYears(new Date(), new Date(birthDate))
}

export default function ClientList() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteModal, setDeleteModal] = useState({ open: false, client: null })
  const [deleting, setDeleting] = useState(false)
  const [filters, setFilters] = useState({
    cognitiveLevel: null,
    frequency: null,
    hasTransport: null
  })
  
  const navigate = useNavigate()

  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    setLoading(true)
    try {
      const data = await getClients()
      setClients(data)
    } catch (error) {
      console.error('Error cargando clientes:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredClients = clients.filter((client) => {
    // Filtro de búsqueda
    const fullName = `${client.firstName} ${client.lastName}`.toLowerCase()
    const phone = client.emergencyContact?.phone?.toLowerCase() || ''
    const address = client.address?.street?.toLowerCase() || ''
    const searchLower = search.toLowerCase()
    const matchesSearch = fullName.includes(searchLower) || phone.includes(searchLower) || address.includes(searchLower)
    
    // Filtro de tier cognitivo
    const matchesCognitive = filters.cognitiveLevel === null || client.cognitiveLevel === filters.cognitiveLevel
    
    // Filtro de frecuencia
    const matchesFrequency = filters.frequency === null || client.plan.frequency === filters.frequency
    
    // Filtro de transporte
    const matchesTransport = filters.hasTransport === null || client.plan.hasTransport === filters.hasTransport
    
    return matchesSearch && matchesCognitive && matchesFrequency && matchesTransport
  })
  
  const activeFiltersCount = getActiveFiltersCount(filters)

  const handleDelete = async () => {
    if (!deleteModal.client) return
    
    setDeleting(true)
    try {
      await deleteClient(deleteModal.client.id)
      setClients(clients.filter(c => c.id !== deleteModal.client.id))
      setDeleteModal({ open: false, client: null })
    } catch (error) {
      console.error('Error eliminando cliente:', error)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">Clientes</h1>
          <span className="text-gray-400">–</span>
          <span className="text-gray-500">{clients.length}</span>
        </div>
        
        {/* Search and Filters */}
        <div className="flex items-center gap-3 flex-1 max-w-3xl mx-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nombre, cedula, dirección..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
          
          <Filters
            filters={filters}
            onChange={setFilters}
            config={FILTERS_CONFIG}
          />
        </div>

        <Button 
          onClick={() => navigate('/clientes/nuevo')}
          className="bg-purple-600 hover:bg-purple-700 rounded-full px-6"
        >
          Alta de cliente
          <Plus className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        </div>
      ) : (
        /* Client grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredClients.length === 0 ? (
            <div className="col-span-full">
              <Card className="p-8 text-center">
                <p className="text-gray-500">
                  {search || activeFiltersCount > 0 
                    ? 'No se encontraron clientes con ese criterio' 
                    : 'No hay clientes registrados'}
                </p>
                {activeFiltersCount > 0 && (
                  <button
                    onClick={() => setFilters({ cognitiveLevel: null, frequency: null, hasTransport: null })}
                    className="mt-2 text-purple-600 hover:text-purple-700 text-sm font-medium"
                  >
                    Limpiar filtros
                  </button>
                )}
              </Card>
            </div>
          ) : (
            filteredClients.map((client) => (
              <ClientCard 
                key={client.id} 
                client={client} 
                onView={() => navigate(`/clientes/${client.id}`)}
                onDelete={() => setDeleteModal({ open: true, client })}
              />
            ))
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      <Modal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, client: null })}
        title="Eliminar cliente"
      >
        <p className="text-gray-600 mb-6">
          ¿Estás seguro de que deseas eliminar a{' '}
          <span className="font-semibold">
            {deleteModal.client?.firstName} {deleteModal.client?.lastName}
          </span>
          ? Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-3 justify-end">
          <Button
            variant="secondary"
            onClick={() => setDeleteModal({ open: false, client: null })}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            loading={deleting}
          >
            Eliminar
          </Button>
        </div>
      </Modal>
    </div>
  )
}

// Componente de tarjeta de cliente
function ClientCard({ client, onView, onDelete }) {
  const age = calculateAge(client.birthDate)
  
  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group">
      <div onClick={onView}>
        {/* Imagen placeholder con tier cognitivo */}
        <div className="relative h-40 bg-gradient-to-br from-gray-200 to-gray-300">
          {/* Placeholder de foto */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-6xl text-gray-400 font-light">
              {client.firstName[0]}{client.lastName[0]}
            </span>
          </div>
          
          {/* Tier cognitivo badge */}
          <div className={`absolute bottom-3 left-3 px-3 py-1 rounded-lg text-sm font-semibold border ${COGNITIVE_LEVEL_COLORS[client.cognitiveLevel] || 'bg-gray-100 text-gray-700'}`}>
            Tier {client.cognitiveLevel}
          </div>
          
          {/* Días de recupero badge */}
          {client.recoveryDaysAvailable > 0 && (
            <div className="absolute bottom-3 right-3 flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur rounded-lg text-xs font-medium text-gray-700">
              <Refresh className="w-3 h-3" />
              {client.recoveryDaysAvailable}
            </div>
          )}
        </div>
        
        {/* Info */}
        <div className="p-4">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">
              {client.firstName} {client.lastName}
            </h3>
            {age && (
              <p className="text-gray-500 text-sm">{age} años</p>
            )}
          </div>
          
          {/* Contacto de emergencia */}
          <div className="mt-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Contacto</p>
            <p className="text-sm text-gray-700">{client.emergencyContact?.phone}</p>
          </div>
          
          {/* Días de la semana + Horario */}
          <div className="flex items-center gap-2 mt-4">
            <div className="flex gap-1.5">
              {WEEK_DAYS.map((day) => {
                const isAssigned = client.plan.assignedDays.includes(day.key)
                return (
                  <span
                    key={day.key}
                    className={`
                      px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                      ${isAssigned 
                        ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                        : 'bg-gray-100 text-gray-400 border border-gray-200'}
                    `}
                  >
                    {day.label}
                  </span>
                )
              })}
            </div>
            
            {/* Horario con tooltip */}
            {SCHEDULE_CONFIG[client.plan.schedule] && (
              <div className="relative group/schedule">
                <div className="p-1.5 rounded-lg bg-gray-100 text-gray-500 border border-gray-200">
                  {(() => {
                    const { Icon } = SCHEDULE_CONFIG[client.plan.schedule]
                    return <Icon className="w-4 h-4" />
                  })()}
                </div>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-gray-900 text-white rounded whitespace-nowrap opacity-0 group-hover/schedule:opacity-100 transition-opacity pointer-events-none z-10">
                  {SCHEDULE_CONFIG[client.plan.schedule].label}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Delete button (visible on hover) */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="absolute top-2 right-2 p-2 bg-white/80 backdrop-blur rounded-lg text-gray-400 hover:text-red-600 hover:bg-white opacity-0 group-hover:opacity-100 transition-all"
      >
        <Trash className="w-4 h-4" />
      </button>
    </Card>
  )
}
