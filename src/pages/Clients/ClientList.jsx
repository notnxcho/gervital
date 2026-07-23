import { useState, useEffect, useMemo, memo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, Search, User, Heart, Flash, Calculator } from 'iconoir-react'
import { differenceInYears, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { getClients, deactivateClient, applyDueReactivations } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useReasonLabels } from '../../hooks/useReasonLabels'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Filters, { getActiveFiltersCount } from '../../components/ui/Filters'
import SortMenu from '../../components/ui/SortMenu'
import { CLIENT_TYPE_META } from '../../services/clients/clientTypes'
import DeactivateClientModal from './DeactivateClientModal'
import PlanCalculatorModal from './PlanCalculatorModal'
import './ClientCard.css'

// MOCKED RES - Días de la semana
const WEEK_DAYS = [
  { key: 'monday', label: 'L' },
  { key: 'tuesday', label: 'M' },
  { key: 'wednesday', label: 'M' },
  { key: 'thursday', label: 'J' },
  { key: 'friday', label: 'V' }
]

// MOCKED RES - Color del tier cognitivo (letra sobre el tab de vidrio oscuro)
const TIER_HEX = {
  A: '#34d399',
  B: '#38bdf8',
  C: '#fbbf24',
  D: '#fb7185'
}

// MOCKED RES - Labels de horario (badge corto + nombre largo para tooltip)
const SCHEDULE_CONFIG = {
  morning: { badge: 'AM', label: 'Mañana' },
  afternoon: { badge: 'PM', label: 'Tarde' },
  full_day: { badge: 'TD', label: 'Día completo' }
}

// MOCKED RES - Condiciones médicas mostradas como punto + inicial.
// Keyed on el valor `condition` de medicalHistory (migración 047 movió los flags a esa tabla)
const MEDICAL_FLAGS = [
  { condition: 'diabetes', label: 'Diabético', initial: 'D', color: '#3b82f6' },
  { condition: 'celiaquia', label: 'Celíaco', initial: 'C', color: '#f59e0b' },
  { condition: 'hipertension', label: 'Hipertenso', initial: 'H', color: '#ef4444' },
  { condition: 'intolerancia_lactosa', label: 'Intolerante a la lactosa', initial: 'L', color: '#8b5cf6' }
]

// Deriva los flags visibles a partir del array medicalHistory del cliente
const medicalFlagsFor = (client) => {
  const conditions = new Set((client.medicalHistory || []).map(h => h.condition))
  return MEDICAL_FLAGS.filter(f => conditions.has(f.condition))
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
      { value: 4, label: '4x' },
      { value: 5, label: '5x' }
    ]
  },
  {
    key: 'schedule',
    label: 'Horario',
    options: [
      { value: 'morning', label: 'Mañana' },
      { value: 'afternoon', label: 'Tarde' },
      { value: 'full_day', label: 'Día completo' }
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
  },
  {
    key: 'clientType',
    label: 'Tipo',
    type: 'icon',
    options: [
      { value: 'regular', label: 'Normal', icon: User },
      { value: 'charity', label: 'Beneficencia', icon: Heart },
      { value: 'trial', label: 'A prueba', icon: Flash }
    ]
  },
  {
    key: 'showDeleted',
    label: 'Bajas',
    options: [
      { value: true, label: 'Mostrar solo bajas' }
    ]
  }
]

// Opciones de ordenamiento
const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Nombre (A-Z)' },
  { value: 'name_desc', label: 'Nombre (Z-A)' },
  { value: 'age_desc', label: 'Edad (mayor primero)' },
  { value: 'freq_desc', label: 'Frecuencia (mayor primero)' },
  { value: 'tier_asc', label: 'Tier (A-D)' }
]

// MOCKED RES - Calcular edad desde fecha de nacimiento
const calculateAge = (birthDate) => {
  if (!birthDate) return null
  return differenceInYears(new Date(), new Date(birthDate))
}

// Fecha efectiva de baja: prioriza deactivationDate (date-only, parseada local para no
// correrse un día por timezone); fallback a deleted_at para registros viejos.
const bajaDate = (client) =>
  client.deactivationDate
    ? new Date(`${client.deactivationDate}T00:00:00`)
    : (client.deletedAt ? new Date(client.deletedAt) : null)

// Ordena una copia de la lista según el criterio. Los vacíos (edad/tier sin dato) van al final.
const sortClients = (list, sortBy) => {
  const arr = [...list]
  const fullName = (c) => `${c.firstName} ${c.lastName}`.trim().replace(/\s+/g, ' ')
  const cmpName = (a, b) =>
    fullName(a).localeCompare(fullName(b), 'es', { sensitivity: 'base' })
  const nullsLast = (aEmpty, bEmpty, cmp) => {
    if (aEmpty && bEmpty) return 0
    if (aEmpty) return 1
    if (bEmpty) return -1
    return cmp()
  }
  switch (sortBy) {
    case 'name_desc':
      return arr.sort((a, b) => cmpName(b, a))
    case 'age_desc':
      // Mayor edad primero = fecha de nacimiento más antigua primero
      return arr.sort((a, b) => nullsLast(!a.birthDate, !b.birthDate, () => new Date(a.birthDate) - new Date(b.birthDate)))
    case 'freq_desc':
      return arr.sort((a, b) => (b.plan?.frequency || 0) - (a.plan?.frequency || 0))
    case 'tier_asc':
      return arr.sort((a, b) => nullsLast(!a.cognitiveLevel, !b.cognitiveLevel, () => a.cognitiveLevel.localeCompare(b.cognitiveLevel)))
    case 'name_asc':
    default:
      return arr.sort(cmpName)
  }
}

// Icono de transporte (van)
function VanIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 16V7a1 1 0 0 1 1-1h9v10" />
      <path d="M13 8h4l3 3.5V16" />
      <path d="M3 16h2m12 0h2m-2 0H8" />
      <circle cx="6.5" cy="16.5" r="1.7" />
      <circle cx="17.5" cy="16.5" r="1.7" />
    </svg>
  )
}

// Iconos del toggle de vista
function GridIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}
function ListIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function ClientList() {
  const { user, hasAccess } = useAuth()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [deactivateModal, setDeactivateModal] = useState({ open: false, client: null })
  const [deactivating, setDeactivating] = useState(false)
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('clients.viewMode') || 'grid')
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('clients.sortBy') || 'name_asc')
  const [filters, setFilters] = useState({
    cognitiveLevel: null,
    frequency: null,
    schedule: null,
    hasTransport: null,
    clientType: null,
    showDeleted: null
  })

  const navigate = useNavigate()

  useEffect(() => {
    loadClients()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.showDeleted])

  useEffect(() => { localStorage.setItem('clients.viewMode', viewMode) }, [viewMode])
  useEffect(() => { localStorage.setItem('clients.sortBy', sortBy) }, [sortBy])

  const loadClients = async () => {
    setLoading(true)
    try {
      // Self-heal: voltea a activo los reintegros programados cuya fecha ya llegó (no hay cron).
      await applyDueReactivations().catch(() => {})
      const data = await getClients({ includeDeleted: filters.showDeleted === true })
      setClients(data)
    } catch (error) {
      console.error('Error cargando clientes:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredClients = useMemo(() => {
    const searchLower = search.toLowerCase()
    const filtered = clients.filter((client) => {
      const fullName = `${client.firstName} ${client.lastName}`.toLowerCase()
      const phone = client.emergencyContact?.phone?.toLowerCase() || ''
      const address = client.address?.street?.toLowerCase() || ''
      const matchesSearch = fullName.includes(searchLower) || phone.includes(searchLower) || address.includes(searchLower)

      const matchesCognitive = filters.cognitiveLevel === null || client.cognitiveLevel === filters.cognitiveLevel
      const matchesFrequency = filters.frequency === null || client.plan.frequency === filters.frequency
      const matchesSchedule = filters.schedule === null || client.plan.schedule === filters.schedule
      const matchesTransport = filters.hasTransport === null || client.plan.hasTransport === filters.hasTransport
      const matchesType = filters.clientType === null || (client.clientType || 'regular') === filters.clientType
      // "Solo bajas": con el filtro activo se muestran únicamente los dados de baja
      const matchesDeleted = filters.showDeleted === true ? !!client.deletedAt : !client.deletedAt

      return matchesSearch && matchesCognitive && matchesFrequency && matchesSchedule && matchesTransport && matchesType && matchesDeleted
    })
    return sortClients(filtered, sortBy)
  }, [clients, search, filters.cognitiveLevel, filters.frequency, filters.schedule, filters.hasTransport, filters.clientType, filters.showDeleted, sortBy])

  const activeFiltersCount = getActiveFiltersCount(filters)

  const handleDeactivate = async ({ reason, notes, deactivationDate }) => {
    if (!deactivateModal.client || !user?.id) return

    setDeactivating(true)
    try {
      await deactivateClient(deactivateModal.client.id, { reason, notes, userId: user.id, deactivationDate })
      setDeactivateModal({ open: false, client: null })
      await loadClients()
    } catch (error) {
      console.error('Error dando de baja al cliente:', error)
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      {/* Header: título + búsqueda (span) + filtros + orden + vista + CTA */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-2xl font-semibold text-gray-900">Clientes</h1>
          <span className="text-gray-400">–</span>
          <span className="text-gray-500">{filteredClients.length}</span>
        </div>

        {/* Búsqueda: ocupa todo el ancho disponible */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, cedula, dirección..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <Filters
          filters={filters}
          onChange={setFilters}
          config={FILTERS_CONFIG}
        />

        {/* Orden */}
        <div className="shrink-0">
          <SortMenu value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
        </div>

        {/* Toggle de vista */}
        <div className="shrink-0 flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-600'}`}
            title="Vista grilla"
            aria-label="Vista grilla"
          >
            <GridIcon />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-600'}`}
            title="Vista lista"
            aria-label="Vista lista"
          >
            <ListIcon />
          </button>
        </div>

        {hasAccess('billing') && (
          <Button
            variant="secondary"
            onClick={() => setCalculatorOpen(true)}
            className="shrink-0 rounded-full px-5"
          >
            <Calculator className="w-4 h-4 mr-1" />
            Calcular
          </Button>
        )}

        <Button
          onClick={() => navigate('/clientes/nuevo')}
          className="shrink-0 bg-purple-600 hover:bg-purple-700 rounded-full px-6"
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
      ) : filteredClients.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-gray-500">
            {search || activeFiltersCount > 0
              ? 'No se encontraron clientes con ese criterio'
              : 'No hay clientes registrados'}
          </p>
          {activeFiltersCount > 0 && (
            <button
              onClick={() => setFilters({ cognitiveLevel: null, frequency: null, schedule: null, hasTransport: null, clientType: null, showDeleted: null })}
              className="mt-2 text-purple-600 hover:text-purple-700 text-sm font-medium"
            >
              Limpiar filtros
            </button>
          )}
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(290px,1fr))]">
          {filteredClients.map((client) => (
            <ClientCard key={client.id} client={client} />
          ))}
        </div>
      ) : (
        <div className="client-list">
          {filteredClients.map((client) => (
            <ClientRow key={client.id} client={client} />
          ))}
        </div>
      )}

      <DeactivateClientModal
        isOpen={deactivateModal.open}
        onClose={() => setDeactivateModal({ open: false, client: null })}
        client={deactivateModal.client}
        onConfirm={handleDeactivate}
        loading={deactivating}
      />

      <PlanCalculatorModal
        isOpen={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
      />
    </div>
  )
}

const ClientCard = memo(function ClientCard({ client }) {
  const reasonLabels = useReasonLabels()
  const age = calculateAge(client.birthDate)
  const isDeactivated = !!client.deletedAt
  const deactivatedLabel = isDeactivated
    ? `Baja: ${reasonLabels[client.deactivationReason] || 'Sin motivo'} · ${format(bajaDate(client), "d MMM yyyy", { locale: es })}`
    : null
  const flags = medicalFlagsFor(client)
  const schedule = SCHEDULE_CONFIG[client.plan.schedule]

  return (
    <Link to={`/clientes/${client.id}`} className={`client-card${isDeactivated ? ' is-deactivated' : ''}`}>
      {/* Foto / iniciales */}
      {client.avatarUrl ? (
        <img className="cc-photo" src={client.avatarUrl} alt={`${client.firstName} ${client.lastName}`} loading="lazy" decoding="async" />
      ) : (
        <div className="cc-initials">{client.firstName[0]}{client.lastName[0]}</div>
      )}

      {/* Degradado */}
      <div className="cc-scrim" />

      {/* Tab tier (esquina superior izquierda) */}
      <div
        className="cc-tier-tab"
        style={{ background: `linear-gradient(135deg, ${TIER_HEX[client.cognitiveLevel] || '#94a3b8'}4d, #ffffff 78%)` }}
      >
        <span className="cc-tier-letter">{client.cognitiveLevel}</span>
      </div>

      {/* Tab flags médicos (esquina superior derecha) */}
      {flags.length > 0 && (
        <div className="cc-med-tab">
          {flags.map(f => (
            <span key={f.condition} className="cc-med">
              <span className="cc-dot" style={{ background: f.color }} />
              {f.initial}
            </span>
          ))}
        </div>
      )}

      {/* Cuerpo */}
      <div className="cc-body">
        {(client.clientType && client.clientType !== 'regular' && CLIENT_TYPE_META[client.clientType]) || client.hasActiveDiscount ? (
          <div className="cc-labels">
            {client.clientType && client.clientType !== 'regular' && CLIENT_TYPE_META[client.clientType] && (
              <span className="cc-label-pill" style={{ background: CLIENT_TYPE_META[client.clientType].bg, color: CLIENT_TYPE_META[client.clientType].color }}>
                {CLIENT_TYPE_META[client.clientType].label}
              </span>
            )}

            {client.hasActiveDiscount && (
              <span className="cc-label-pill" style={{ background: '#dcfce7', color: '#15803d' }}>Promoción activa</span>
            )}
          </div>
        ) : null}

        <h3 className="cc-name">{client.firstName} {client.lastName}</h3>
        {age && <p className="cc-age">{age} años</p>}

        {isDeactivated ? (
          <div><span className="cc-deactivated">{deactivatedLabel}</span></div>
        ) : (
          <div className="cc-meta">
            <div className="cc-days">
              {WEEK_DAYS.map((day) => (
                <span
                  key={day.key}
                  className={`cc-day${client.plan.assignedDays.includes(day.key) ? ' is-on' : ''}`}
                >
                  {day.label}
                </span>
              ))}
            </div>

            <div className="cc-right">
              {client.plan.hasTransport && (
                <span className="cc-tchip"><VanIcon /></span>
              )}

              {schedule && (
                <div className="cc-schedule">
                  <span className="cc-badge">{schedule.badge}</span>
                  <span className="cc-tip">{schedule.label}</span>
                </div>
              )}

              {client.recoveryDaysAvailable > 0 && (
                <span className="cc-recovery">↻ {client.recoveryDaysAvailable}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Link>
  )
})

const ClientRow = memo(function ClientRow({ client }) {
  const reasonLabels = useReasonLabels()
  const age = calculateAge(client.birthDate)
  const isDeactivated = !!client.deletedAt
  const deactivatedLabel = isDeactivated
    ? `Baja: ${reasonLabels[client.deactivationReason] || 'Sin motivo'} · ${format(bajaDate(client), "d MMM yyyy", { locale: es })}`
    : null
  const flags = medicalFlagsFor(client)
  const schedule = SCHEDULE_CONFIG[client.plan.schedule]

  return (
    <Link to={`/clientes/${client.id}`} className={`client-row${isDeactivated ? ' is-deactivated' : ''}`}>
      {/* Avatar / iniciales */}
      {client.avatarUrl ? (
        <img className="cr-avatar" src={client.avatarUrl} alt={`${client.firstName} ${client.lastName}`} loading="lazy" decoding="async" />
      ) : (
        <div className="cr-initials">{client.firstName[0]}{client.lastName[0]}</div>
      )}

      {/* Tier */}
      {client.cognitiveLevel && (
        <span
          className="cr-tier"
          title={`Tier ${client.cognitiveLevel}`}
          style={{ background: `${TIER_HEX[client.cognitiveLevel] || '#94a3b8'}33` }}
        >
          {client.cognitiveLevel}
        </span>
      )}

      {/* Nombre + edad */}
      <div className="cr-main">
        <span className="cr-name">
          {client.firstName} {client.lastName}
          {client.clientType && client.clientType !== 'regular' && CLIENT_TYPE_META[client.clientType] && (
            <span title={CLIENT_TYPE_META[client.clientType].label} style={{ marginLeft: 6, color: CLIENT_TYPE_META[client.clientType].color }}>
              {CLIENT_TYPE_META[client.clientType].glyph}
            </span>
          )}
        </span>
        <span className="cr-sub">
          {age ? `${age} años` : 'Edad sin dato'}
          {isDeactivated && deactivatedLabel ? ` · ${deactivatedLabel}` : ''}
        </span>
      </div>

      <div className="cr-spacer" />

      {!isDeactivated && (
        <>
          {/* Flags médicos */}
          {flags.length > 0 && (
            <div className="cr-meds">
              {flags.map(f => (
                <span key={f.condition} className="cr-meddot" style={{ background: f.color }} title={f.label} />
              ))}
            </div>
          )}

          {/* Días */}
          <div className="cr-days">
            {WEEK_DAYS.map((day) => (
              <span
                key={day.key}
                className={`cr-day${client.plan.assignedDays.includes(day.key) ? ' is-on' : ''}`}
              >
                {day.label}
              </span>
            ))}
          </div>

          {/* Promoción activa */}
          {client.hasActiveDiscount && (
            <span className="cr-tchip" title="Promoción activa" style={{ color: '#15803d' }}>%</span>
          )}

          {/* Transporte */}
          {client.plan.hasTransport && (
            <span className="cr-tchip" title="Con transporte"><VanIcon size={16} /></span>
          )}

          {/* Horario */}
          {schedule && <span className="cr-badge" title={schedule.label}>{schedule.badge}</span>}

          {/* Recupero */}
          {client.recoveryDaysAvailable > 0 && (
            <span className="cr-recovery">↻ {client.recoveryDaysAvailable}</span>
          )}
        </>
      )}
    </Link>
  )
})
