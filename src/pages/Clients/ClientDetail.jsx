import { useState, useEffect, useRef } from 'react'
import { formatCurrency } from '../../utils/format'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit, Phone, MapPin, Calendar, MoreVert, Trash, Check, NavArrowDown, NavArrowRight, Percentage, Heart, Flash } from 'iconoir-react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, differenceInCalendarDays } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  getClientById,
  getClientAttendance,
  getClientInvoices,
  getPlanPricing,
  getPlanPriceSync,
  getTransportPricing,
  getTransportPriceSync,
  advanceScheduledAttendance,
  ensureClientMonths,
  calculateMonthBilling,
  markMonthPaid,
  markMonthInvoiced,
  syncClientToBiller,
  unmarkMonthPaid,
  markDayAbsent,
  unmarkDayAbsent,
  markDayVacation,
  unmarkDayVacation,
  markVacationRange,
  markDayRecoveryAttended,
  unmarkDayRecoveryAttended,
  getRecoveryCredits,
  deactivateClient,
  reactivateClient,
  uploadClientAvatar,
  deleteClientAvatar,
  getClientPlanVersions,
  removePlanDiscount
} from '../../services/api'
import { useAuth, roleHasAccess } from '../../context/AuthContext'
import { useReasonLabels } from '../../hooks/useReasonLabels'
import EmitInvoiceModal from './EmitInvoiceModal'
import ApplyDiscountModal from './ApplyDiscountModal'
import Button from '../../components/ui/Button'
import Card, { CardContent, CardHeader } from '../../components/ui/Card'
import Tabs from '../../components/ui/Tabs'
import Modal from '../../components/ui/Modal'
import DeactivateClientModal from './DeactivateClientModal'
import RecoveryCreditsModal from './RecoveryCreditsModal'
import { MARITAL_STATUS_OPTIONS, RESIDENCE_TYPE_OPTIONS, MEDICAL_HISTORY_CONDITIONS, DIAGNOSIS_TYPE_OPTIONS, CHARACTER_OPTIONS } from '../../services/clients/medicalConstants'

const SCHEDULE_LABELS = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  full_day: 'Día completo'
}

// Badge por tipo de cliente no facturable (regular no muestra badge).
const CLIENT_TYPE_BADGE = {
  charity: { Icon: Heart, label: 'Beneficencia', className: 'bg-violet-100 text-violet-700' },
  trial: { Icon: Flash, label: 'A prueba', className: 'bg-orange-100 text-orange-700' }
}

const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

const DISTANCE_LABELS = { '0_to_2km': '0-2km', '2_to_5km': '2-5km', '5_to_10km': '5-10km' }

const DAY_LABELS = {
  monday: 'Lun',
  tuesday: 'Mar',
  wednesday: 'Mié',
  thursday: 'Jue',
  friday: 'Vie'
}

const DAY_INDEX_TO_NAME = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday'
}

// Resolve the plan version effective for a given (year, month) — month is 0-indexed.
// Falls back to the current `fallbackPlan` if no versions are loaded.
function getPlanForMonth(planVersions, fallbackPlan, year, month) {
  if (!planVersions || planVersions.length === 0) return fallbackPlan
  const monthStartTs = new Date(year, month, 1).getTime()
  let chosen = null
  for (const v of planVersions) {
    const [vy, vm] = v.effectiveFrom.split('-').map(Number)
    const vTs = new Date(vy, vm - 1, 1).getTime()
    if (vTs <= monthStartTs && (!chosen || vTs >= chosen.ts)) {
      chosen = { ts: vTs, plan: v }
    }
  }
  return chosen ? chosen.plan : (planVersions[0] || fallbackPlan)
}

const COGNITIVE_LEVEL_CONFIG = {
  A: { label: 'Tier A - Independiente', color: 'bg-green-100 text-green-700 border-green-200' },
  B: { label: 'Tier B - Asistencia leve', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  C: { label: 'Tier C - Asistencia moderada', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  D: { label: 'Tier D - Asistencia alta', color: 'bg-red-100 text-red-700 border-red-200' }
}

// Day cell styling by status
function getDayStyle(status, isJustified) {
  if (status === 'attended') return 'bg-green-500 text-white'
  if (status === 'absent') return isJustified ? 'bg-red-300 text-white' : 'bg-red-500 text-white'
  if (status === 'vacation') return 'bg-orange-400 text-white'
  if (status === 'recovery') return 'bg-blue-500 text-white'
  if (status === 'scheduled') return 'bg-gray-200 text-gray-600'
  return ''
}

// Returns { title, reason } — title is the status label, reason is the optional
// free-text absence note (null when absent). Empty title => no tooltip.
function getDayTooltip(status, isJustified, notes) {
  let title = ''
  if (status === 'attended') title = 'Asistió'
  else if (status === 'absent') title = isJustified ? 'Falta justificada (+1 recupero)' : 'Falta no justificada'
  else if (status === 'vacation') title = 'Vacaciones'
  else if (status === 'recovery') title = 'Día recuperado'
  else if (status === 'scheduled') title = 'Programado'
  const reason = status === 'absent' && notes ? notes : null
  return { title, reason }
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const reasonLabels = useReasonLabels()

  const [client, setClient] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [invoices, setInvoices] = useState([])
  const [pricingData, setPricingData] = useState([])
  const [transportPricingData, setTransportPricingData] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('general')
  const [showOptionsMenu, setShowOptionsMenu] = useState(false)
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [deactivateModal, setDeactivateModal] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [recoveryCredits, setRecoveryCredits] = useState([])
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [planHistoryOpen, setPlanHistoryOpen] = useState(false)

  const optionsMenuRef = useRef(null)
  const avatarInputRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target)) {
        setShowOptionsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    loadClientData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadClientData = async () => {
    setLoading(true)
    try {
      // Advance past scheduled days and ensure future months exist (parallel with data fetching)
      const [clientData, attendanceData, invoicesData, pricing, transportPricing, recoveryData, planVersions] = await Promise.all([
        getClientById(id),
        getClientAttendance(id),
        getClientInvoices(id),
        getPlanPricing(),
        getTransportPricing(),
        getRecoveryCredits(id),
        getClientPlanVersions(id)
      ])
      // Run setup functions (non-blocking, best-effort). Los clientes no facturables
      // (beneficencia / a prueba) nunca materializan facturas: skip ensureClientMonths.
      Promise.all([
        advanceScheduledAttendance().catch(() => {}),
        clientData?.isNonBillable ? Promise.resolve() : ensureClientMonths(id).catch(() => {})
      ]).then(() => {
        if (clientData?.isNonBillable) return
        // Reload invoices after ensureClientMonths creates new rows
        getClientInvoices(id).then(updated => setInvoices(updated)).catch(() => {})
      })

      setClient({ ...clientData, planVersions })
      setRecoveryCredits(recoveryData)
      setAttendance(attendanceData)
      setInvoices(invoicesData)
      setPricingData(pricing)
      setTransportPricingData(transportPricing)
    } catch (error) {
      console.error('Error cargando datos del cliente:', error)
    } finally {
      setLoading(false)
    }
  }

  const refreshRecovery = async () => {
    try {
      const [clientData, recoveryData] = await Promise.all([
        getClientById(id),
        getRecoveryCredits(id)
      ])
      setClient(prev => ({ ...clientData, planVersions: prev?.planVersions }))
      setRecoveryCredits(recoveryData)
    } catch (error) {
      console.error('Error actualizando días de recupero:', error)
    }
  }

  const handleDeactivate = async ({ reason, notes, deactivationDate }) => {
    if (!user?.id) return
    setDeactivating(true)
    try {
      const updated = await deactivateClient(id, { reason, notes, userId: user.id, deactivationDate })
      setClient(prev => ({ ...updated, planVersions: prev?.planVersions }))
      setDeactivateModal(false)
    } catch (error) {
      console.error('Error dando de baja al cliente:', error)
    } finally {
      setDeactivating(false)
    }
  }

  const handleReactivate = async () => {
    setReactivating(true)
    try {
      const updated = await reactivateClient(id)
      setClient(prev => ({ ...updated, planVersions: prev?.planVersions }))
    } catch (error) {
      console.error('Error reactivando cliente:', error)
    } finally {
      setReactivating(false)
    }
  }

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    try {
      const url = await uploadClientAvatar(id, file)
      setClient(prev => ({ ...prev, avatarUrl: url }))
    } catch (error) {
      console.error('Error subiendo avatar:', error)
      alert(error.message)
    } finally {
      setUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const handleAvatarDelete = async () => {
    setUploadingAvatar(true)
    try {
      await deleteClientAvatar(id)
      setClient(prev => ({ ...prev, avatarUrl: null }))
    } catch (error) {
      console.error('Error eliminando avatar:', error)
    } finally {
      setUploadingAvatar(false)
    }
  }

  const tabs = [
    { id: 'general', label: 'Información General' },
    { id: 'contact', label: 'Contacto y Dirección' },
    { id: 'medical', label: 'Información Médica' }
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Cliente no encontrado</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/clientes')}>
          Volver a clientes
        </Button>
      </div>
    )
  }

  const nextExpiry = (() => {
    if (!recoveryCredits.length) return { label: 'Sin días', className: 'text-gray-400' }
    const soonest = recoveryCredits[0].expiresAt // service returns soonest-first
    const daysLeft = differenceInCalendarDays(new Date(soonest), new Date())
    const className = daysLeft <= 7 ? 'text-red-600' : daysLeft <= 14 ? 'text-amber-600' : 'text-gray-400'
    return { label: `Vence el ${format(new Date(soonest), "d 'de' MMM", { locale: es })}`, className }
  })()

  return (
    <div>
      {/* Hidden file input for avatar upload */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleAvatarChange}
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/clientes')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>

        {/* Avatar */}
        <div className="relative group/avatar flex-shrink-0">
          {client.avatarUrl ? (
            <img
              src={client.avatarUrl}
              alt={`${client.firstName} ${client.lastName}`}
              className="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center border-2 border-gray-200">
              <span className="text-xl text-gray-500 font-medium">
                {client.firstName[0]}{client.lastName[0]}
              </span>
            </div>
          )}
          {/* Hover overlay */}
          <button
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity cursor-pointer"
          >
            {uploadingAvatar ? (
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
            ) : (
              <Edit className="w-5 h-5 text-white" />
            )}
          </button>
          {/* Delete avatar button */}
          {client.avatarUrl && !uploadingAvatar && (
            <button
              onClick={handleAvatarDelete}
              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover/avatar:opacity-100 transition-opacity hover:bg-red-600"
              title="Eliminar foto"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">
              {client.firstName} {client.lastName}
            </h1>
            {client.clientType && CLIENT_TYPE_BADGE[client.clientType] && (() => {
              const badge = CLIENT_TYPE_BADGE[client.clientType]
              const BadgeIcon = badge.Icon
              return (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                  <BadgeIcon className="w-3.5 h-3.5" />
                  {badge.label}
                </span>
              )
            })()}
          </div>
          <p className="text-sm text-gray-500">
            Cliente desde {format(new Date(client.startDate), "d 'de' MMMM, yyyy", { locale: es })}
          </p>
          {/* Biller receptor sync status */}
          <div className="mt-1">
            {client.billerClientId ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                Biller ✓
              </span>
            ) : (
              <button
                onClick={async () => {
                  if (client.deletedAt) return
                  setSyncing(true)
                  try { await syncClientToBiller(client.id); await loadClientData() }
                  catch (e) { window.alert(`No se pudo sincronizar con Biller: ${e.message}`) }
                  finally { setSyncing(false) }
                }}
                disabled={syncing || !!client.deletedAt}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium border disabled:opacity-50 ${
                  client.billerSyncError
                    ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                }`}
                title={client.billerSyncError || 'Sin sincronizar en Biller'}
              >
                {syncing
                  ? 'Sincronizando…'
                  : client.billerSyncError ? 'Error Biller — reintentar' : 'Sincronizar Biller'}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!client.deletedAt && (
            <Button variant="secondary" onClick={() => navigate(`/clientes/${id}/editar`)}>
              <Edit className="w-4 h-4" />
              Editar
            </Button>
          )}
          <div className="relative" ref={optionsMenuRef}>
            <Button variant="ghost" size="sm" onClick={() => setShowOptionsMenu(!showOptionsMenu)} className="p-2">
              <MoreVert className="w-5 h-5" />
            </Button>
            {showOptionsMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1">
                {!client.deletedAt && !client.isNonBillable && roleHasAccess(user?.role, 'billing') && (
                  <button
                    onClick={() => { setShowOptionsMenu(false); setShowDiscountModal(true) }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <Percentage className="w-4 h-4" />
                    Aplicar descuento
                  </button>
                )}
                {!client.deletedAt && (
                  <button
                    onClick={() => { setShowOptionsMenu(false); setDeactivateModal(true) }}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <Trash className="w-4 h-4" />
                    Dar de baja
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {client.deletedAt && (
        <div className="mb-4 p-4 rounded-xl border border-amber-300 bg-amber-50 flex items-start justify-between gap-4">
          <div>
            <p className="text-amber-900 font-semibold">
              Cliente dado de baja el {format(client.deactivationDate ? new Date(`${client.deactivationDate}T00:00:00`) : new Date(client.deletedAt), "d 'de' MMMM, yyyy", { locale: es })}
            </p>
            <p className="text-sm text-amber-800 mt-1">
              Motivo: {reasonLabels[client.deactivationReason] || '—'}
              {client.deactivationNotes && <> · {client.deactivationNotes}</>}
            </p>
          </div>
          <Button variant="secondary" onClick={handleReactivate} loading={reactivating}>
            Reactivar cliente
          </Button>
        </div>
      )}

      {/* Plan summary */}
      <Card className="mb-6">
        <CardContent className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-sm text-gray-500">Tier cognitivo</p>
              <span className={`inline-block mt-1 px-3 py-1 rounded-lg text-sm font-semibold border ${COGNITIVE_LEVEL_CONFIG[client.cognitiveLevel]?.color || 'bg-gray-100 text-gray-700'}`}>
                {client.cognitiveLevel}
              </span>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <p className="text-sm text-gray-500">Plan</p>
              <p className="font-semibold text-gray-900">
                {client.plan.frequency}x por semana · {SCHEDULE_LABELS[client.plan.schedule]}
              </p>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <p className="text-sm text-gray-500">Días asignados</p>
              <p className="font-semibold text-gray-900">
                {client.plan.assignedDays.map(d => DAY_LABELS[d]).join(', ')}
              </p>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <p className="text-sm text-gray-500">Transporte</p>
              <p className="font-semibold text-gray-900">
                {client.plan.hasTransport ? 'Incluido' : 'No incluido'}
                {client.plan.hasTransport && client.address?.distanceRange && (
                  <span className="text-sm font-normal text-gray-500 ml-1">
                    ({({ '0_to_2km': '0-2km', '2_to_5km': '2-5km', '5_to_10km': '5-10km' })[client.address.distanceRange]})
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRecoveryModalOpen(true)}
            className="flex items-center gap-3 text-right rounded-lg px-2 py-1 hover:bg-gray-50 transition-colors"
          >
            <div>
              <p className="text-sm text-gray-500">Días de recupero</p>
              <p className="text-2xl font-bold text-indigo-600">{client.recoveryDaysAvailable}</p>
              <p className={`text-xs ${nextExpiry.className}`}>{nextExpiry.label}</p>
            </div>
            <NavArrowRight className="w-5 h-5 text-gray-400" />
          </button>
        </CardContent>
      </Card>

      {/* Plan history */}
      {client.planVersions && client.planVersions.length > 1 && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <button
              type="button"
              onClick={() => setPlanHistoryOpen(o => !o)}
              className="flex w-full items-center justify-between text-left"
            >
              <h3 className="text-sm font-semibold text-gray-900">Historial de plan</h3>
              <NavArrowDown
                className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${planHistoryOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-out ${planHistoryOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="overflow-hidden">
                <ul className="space-y-2 pt-3">
                  {[...client.planVersions].reverse().map(v => (
                    <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-medium text-gray-700">
                        {MONTH_NAMES_ES[Number(v.effectiveFrom.split('-')[1]) - 1]} {v.effectiveFrom.split('-')[0]}
                      </span>
                      <span className="text-gray-500">
                        {v.frequency}×/sem · {SCHEDULE_LABELS[v.schedule]}
                        {v.hasTransport ? ` · transporte (${DISTANCE_LABELS[v.distanceRange] || 's/d'})` : ''}
                      </span>
                      <span className="text-gray-400">
                        {v.assignedDays.map(d => DAY_LABELS[d]).join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info tabs */}
      <Card className="mb-6">
        <CardHeader>
          <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
        </CardHeader>
        <CardContent>
          {activeTab === 'general' && (
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-500">Nombre completo</p>
                <p className="font-medium text-gray-900">{client.firstName} {client.lastName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Email</p>
                <p className="font-medium text-gray-900">{client.email || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Teléfono</p>
                <p className="font-medium text-gray-900">{client.phone || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Fecha de nacimiento</p>
                <p className="font-medium text-gray-900">
                  {client.birthDate ? format(new Date(client.birthDate), "d 'de' MMMM, yyyy", { locale: es }) : '-'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Tier cognitivo</p>
                <p className="font-medium text-gray-900">{COGNITIVE_LEVEL_CONFIG[client.cognitiveLevel]?.label || client.cognitiveLevel}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Fecha de ingreso</p>
                <p className="font-medium text-gray-900">
                  {format(new Date(client.startDate), "d 'de' MMMM, yyyy", { locale: es })}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Estado civil</p>
                <p className="font-medium text-gray-900">{MARITAL_STATUS_OPTIONS.find(o => o.value === client.maritalStatus)?.label || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Tipo de domicilio</p>
                <p className="font-medium text-gray-900">{RESIDENCE_TYPE_OPTIONS.find(o => o.value === client.residenceType)?.label || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Con quién vive</p>
                <p className="font-medium text-gray-900">{client.livesWith || '-'}</p>
              </div>
            </div>
          )}
          {activeTab === 'contact' && (
            <div className="space-y-6">
              <div>
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <Phone className="w-4 h-4" /> Contactos de emergencia
                </h4>
                <div className="space-y-3 pl-6">
                  {(client.emergencyContacts?.length ? client.emergencyContacts : [client.emergencyContact].filter(Boolean)).map((contact, index) => (
                    <div key={index} className="grid grid-cols-3 gap-4">
                      <div><p className="text-sm text-gray-500">Nombre</p><p className="font-medium text-gray-900">{contact?.name || '-'}</p></div>
                      <div><p className="text-sm text-gray-500">Vínculo</p><p className="font-medium text-gray-900">{contact?.relationship || '-'}</p></div>
                      <div><p className="text-sm text-gray-500">Teléfono</p><p className="font-medium text-gray-900">{contact?.phone || '-'}</p></div>
                    </div>
                  ))}
                </div>
              </div>
              {client.transferResponsible && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Responsable de transferencia</h4>
                  <p className="font-medium text-gray-900 pl-6">{client.transferResponsible}</p>
                </div>
              )}
              <div>
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4" /> Dirección
                </h4>
                <div className="grid grid-cols-2 gap-4 pl-6">
                  <div><p className="text-sm text-gray-500">Dirección</p><p className="font-medium text-gray-900">{client.address?.street || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Timbre</p><p className="font-medium text-gray-900">{client.address?.doorbell || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Observaciones de acceso</p><p className="font-medium text-gray-900">{client.address?.accessNotes || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Portería</p><p className="font-medium text-gray-900">{client.address?.concierge || '-'}</p></div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'medical' && (
            <div className="space-y-6">
              {/* Servicio de salud */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Servicio de salud</h4>
                <div className="grid grid-cols-2 gap-4 pl-6">
                  <div><p className="text-sm text-gray-500">Servicio de emergencia</p><p className="font-medium text-gray-900">{client.medicalInfo?.healthEmergencyService || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Prestador de salud</p><p className="font-medium text-gray-900">{client.medicalInfo?.healthProvider || '-'}</p></div>
                  <div className="col-span-2"><p className="text-sm text-gray-500">Observaciones</p><p className="font-medium text-gray-900">{client.medicalInfo?.healthNotes || '-'}</p></div>
                </div>
              </div>

              {/* Tratamiento farmacológico */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Tratamiento farmacológico</h4>
                <div className="space-y-2 pl-6">
                  {client.medications?.length ? (
                    client.medications.map((m, i) => (
                      <p key={i} className="font-medium text-gray-900">
                        {[m.name || '-', m.schedule || '-', m.dose || '-', m.indicatedFor || '-'].join(' — ')}
                      </p>
                    ))
                  ) : (
                    <p className="font-medium text-gray-900">-</p>
                  )}
                  <div className="pt-2"><p className="text-sm text-gray-500">Observaciones</p><p className="font-medium text-gray-900">{client.medicalInfo?.medicationNotes || '-'}</p></div>
                </div>
              </div>

              {/* Antecedentes */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Antecedentes</h4>
                <div className="space-y-2 pl-6">
                  {client.medicalHistory?.length ? (
                    client.medicalHistory.map((h, i) => {
                      const label = MEDICAL_HISTORY_CONDITIONS.find(c => c.value === h.condition)?.label || h.condition
                      return (
                        <p key={i} className="font-medium text-gray-900">
                          {label}{h.comment ? ` (${h.comment})` : ''}
                        </p>
                      )
                    })
                  ) : (
                    <p className="font-medium text-gray-900">-</p>
                  )}
                  <div className="pt-2"><p className="text-sm text-gray-500">Observaciones</p><p className="font-medium text-gray-900">{client.medicalInfo?.historyNotes || '-'}</p></div>
                </div>
              </div>

              {/* Diagnóstico */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Diagnóstico</h4>
                <div className="space-y-2 pl-6">
                  {client.diagnoses?.length ? (
                    client.diagnoses.map((d, i) => {
                      const label = DIAGNOSIS_TYPE_OPTIONS.find(x => x.value === d.diagnosisType)?.label || d.diagnosisType || '-'
                      return (
                        <p key={i} className="font-medium text-gray-900">
                          {label}{d.behaviorDisorder ? ` — ${d.behaviorDisorder}` : ''}
                        </p>
                      )
                    })
                  ) : (
                    <p className="font-medium text-gray-900">-</p>
                  )}
                </div>
              </div>

              {/* Historia de vida */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Historia de vida</h4>
                <div className="grid grid-cols-2 gap-4 pl-6">
                  <div><p className="text-sm text-gray-500">Nivel educativo</p><p className="font-medium text-gray-900">{client.medicalInfo?.educationLevel || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Ocupación</p><p className="font-medium text-gray-900">{client.medicalInfo?.occupation || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Intereses significativos</p><p className="font-medium text-gray-900">{client.medicalInfo?.significantInterests || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Vínculos significativos</p><p className="font-medium text-gray-900">{client.medicalInfo?.significantBonds || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Gustos musicales</p><p className="font-medium text-gray-900">{client.medicalInfo?.musicTaste || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Comidas preferidas</p><p className="font-medium text-gray-900">{client.medicalInfo?.favoriteFoods || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Carácter</p><p className="font-medium text-gray-900">{CHARACTER_OPTIONS.find(o => o.value === client.medicalInfo?.character)?.label || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Recursos personales</p><p className="font-medium text-gray-900">{client.medicalInfo?.personalResources || '-'}</p></div>
                  <div><p className="text-sm text-gray-500">Vulnerabilidades</p><p className="font-medium text-gray-900">{client.medicalInfo?.vulnerabilities || '-'}</p></div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing section */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Asistencia y facturación
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Desliza para ver todos los meses. Haz clic en un día para registrar ausencias o vacaciones.
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4">
        {[
          { color: 'bg-green-500', label: 'Asistió' },
          { color: 'bg-red-500', label: 'Falta no justificada' },
          { color: 'bg-red-300', label: 'Falta justificada (+recupero)' },
          { color: 'bg-orange-400', label: 'Vacaciones' },
          { color: 'bg-blue-500', label: 'Día recuperado' },
          { color: 'bg-gray-200', label: 'Programado' }
        ].map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className={`w-3.5 h-3.5 rounded ${item.color}`} />
            <span className="text-xs text-gray-600">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Month cards horizontal scroll */}
      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory" style={{ scrollBehavior: 'smooth' }}>
        {invoices.length === 0 ? (
          // Fallback: show current + next 2 months while invoices load
          [new Date(), addMonths(new Date(), 1), addMonths(new Date(), 2)].map((d, i) => (
            <MonthCard
              key={i}
              client={client}
              year={d.getFullYear()}
              month={d.getMonth()}
              invoice={null}
              attendance={attendance}
              pricingData={pricingData}
              transportPricingData={transportPricingData}
              user={user}
              onRefresh={loadClientData}
            />
          ))
        ) : (
          invoices.map(inv => (
            <MonthCard
              key={`${inv.year}-${inv.month}`}
              client={client}
              year={inv.year}
              month={inv.month}
              invoice={inv}
              attendance={attendance}
              pricingData={pricingData}
              transportPricingData={transportPricingData}
              user={user}
              onRefresh={loadClientData}
            />
          ))
        )}
      </div>

      <DeactivateClientModal
        isOpen={deactivateModal}
        onClose={() => setDeactivateModal(false)}
        client={client}
        onConfirm={handleDeactivate}
        loading={deactivating}
      />

      <RecoveryCreditsModal
        isOpen={recoveryModalOpen}
        onClose={() => setRecoveryModalOpen(false)}
        credits={recoveryCredits}
        canMutate={!client.deletedAt}
        userName={user?.name}
        clientId={id}
        onChanged={refreshRecovery}
      />

      <ApplyDiscountModal
        isOpen={showDiscountModal}
        onClose={() => setShowDiscountModal(false)}
        client={client}
        invoices={invoices}
        onRefresh={loadClientData}
      />
    </div>
  )
}

// ============================================================
// MonthCard
// ============================================================
function MonthCard({ client, year, month, invoice, attendance, pricingData, transportPricingData, user, onRefresh }) {
  const [processing, setProcessing] = useState(false)
  // Modal state: null | 'payment' | 'undoPayment' | 'invoice' | 'absence' | 'undoAbsence' | 'vacation' | 'undoVacation' | 'recovery' | 'undoRecovery'
  const [modal, setModal] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [paymentDropOpen, setPaymentDropOpen] = useState(false)
  const [emitModalOpen, setEmitModalOpen] = useState(false)
  const paymentDropRef = useRef(null)
  const isDeactivated = !!client.deletedAt

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (paymentDropRef.current && !paymentDropRef.current.contains(e.target)) setPaymentDropOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const monthStart = startOfMonth(new Date(year, month, 1))
  const monthEnd = endOfMonth(monthStart)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // Fallback (no versions loaded) keeps the current plan but sources distance from the address,
  // since client.plan from clients_full carries no distanceRange.
  const plan = getPlanForMonth(client.planVersions, { ...client.plan, distanceRange: client.address?.distanceRange }, year, month)

  // Días descontados del mes (vacaciones / no cobrados) → adenda por defecto del modal.
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const discountedDays = attendance
    .filter(a => a.status === 'vacation' && String(a.date).startsWith(monthPrefix))
    .map(a => new Date(String(a.date) + 'T12:00:00'))

  const startDay = getDay(monthStart)
  const paddingDays = startDay === 0 ? 6 : startDay - 1

  const today = new Date()
  const isPaid = invoice?.paymentStatus === 'paid'
  const isInvoiced = invoice?.invoiceStatus === 'invoiced'
  const canViewBilling = roleHasAccess(user?.role, 'billing') && !client?.isNonBillable
  // Overdue: unpaid and past the 11th of the invoice's month
  const dueDate = new Date(year, month, 11, 23, 59, 59)
  const isOverdue = !isPaid && today > dueDate

  // --- Billing calculation (local, for unpaid months) ---
  const clientStart = new Date(client.startDate)
  const effectiveStart = clientStart > monthStart ? clientStart : monthStart
  // Fecha de baja: desde ese día (inclusive) el cliente ya NO asiste ni se cobra (corte exclusivo).
  const deactDate = client.deactivationDate ? new Date(`${client.deactivationDate}T00:00:00`) : null

  const vacationDays = days.filter(d => {
    const dateStr = format(d, 'yyyy-MM-dd')
    const rec = attendance.find(a => a.date === dateStr)
    const name = DAY_INDEX_TO_NAME[getDay(d)]
    return name && plan.assignedDays.includes(name) && d >= effectiveStart && (!deactDate || d < deactDate) && rec?.status === 'vacation'
  }).length

  const plannedDays = days.filter(d => {
    const name = DAY_INDEX_TO_NAME[getDay(d)]
    if (!name || !plan.assignedDays.includes(name)) return false
    if (d < effectiveStart) return false
    if (deactDate && d >= deactDate) return false
    return true
  }).length

  const chargeableDays = plannedDays - vacationDays
  const recoveryDays = days.filter(d => {
    const dateStr = format(d, 'yyyy-MM-dd')
    return attendance.find(a => a.date === dateStr)?.status === 'recovery'
  }).length

  const planPrice = getPlanPriceSync(pricingData, plan.frequency, plan.schedule)
  const transportPrice = plan.hasTransport && plan.distanceRange
    ? getTransportPriceSync(transportPricingData, plan.frequency, plan.distanceRange)
    : { priceNet: 0, priceGross: 0 }
  // Modelo de precio por día determinístico: días estándar = 4 × frecuencia (mes = 4 semanas).
  // Se factura min(díasCobrables, díasEstándar) → un mes completo nunca supera la mensualidad,
  // y cada día por debajo del estándar descuenta precio/díasEstándar.
  const daysPerMonth = 4 * plan.frequency
  const billedDays = Math.max(0, Math.min(chargeableDays, daysPerMonth))
  // El descuento de promoción aplica SOLO a asistencia (no a transporte). Se redondea
  // cada componente por separado para coincidir exacto con calculate_month_billing (emisión).
  const discountFactor = 1 - ((invoice?.discountPercent || 0) / 100)
  const proration = daysPerMonth > 0 ? billedDays / daysPerMonth : 0
  const liveChargeableAmount = Math.round(proration * planPrice.priceGross * discountFactor) + Math.round(proration * transportPrice.priceGross)

  // If paid: use snapshot from invoice; otherwise live calculation
  const displayAmount = isPaid ? (invoice.paidAmount ?? invoice.chargeableAmount) : liveChargeableAmount
  // Descuento por vacaciones sobre los días facturados (0 si el día extra del mes lo absorbe).
  const billedWithoutVacation = Math.max(0, Math.min(plannedDays, daysPerMonth))
  const vacationPct = billedWithoutVacation > billedDays
    ? Math.round(((billedWithoutVacation - billedDays) / daysPerMonth) * 100)
    : 0

  const isProrated = billedDays < daysPerMonth

  // --- Day status lookup ---
  const getDayStatus = (day) => {
    const dateStr = format(day, 'yyyy-MM-dd')
    const rec = attendance.find(a => a.date === dateStr)
    const name = DAY_INDEX_TO_NAME[getDay(day)]
    const isAssigned = name && plan.assignedDays.includes(name)

    if (rec?.status === 'recovery') return { status: 'recovery', isJustified: false, isAssigned: false }
    if (!isAssigned) return { status: 'not_scheduled', isJustified: false, isAssigned: false }
    if (day < clientStart) return { status: 'not_scheduled', isJustified: false, isAssigned: false }
    // Baja: desde la fecha de baja (inclusive) el día ya no cuenta como asistencia ni es cobrable.
    if (deactDate && day >= deactDate) return { status: 'not_scheduled', isJustified: false, isAssigned: false }
    if (rec) return { status: rec.status, isJustified: rec.isJustified ?? false, isAssigned: true, notes: rec.notes ?? null }
    if (day > today) return { status: 'scheduled', isJustified: false, isAssigned: true }
    return { status: 'attended', isJustified: false, isAssigned: true }
  }

  const handleDayClick = (day) => {
    if (isDeactivated) return
    const dateStr = format(day, 'yyyy-MM-dd')
    const { status, isJustified, isAssigned } = getDayStatus(day)
    const isWeekend = getDay(day) === 0 || getDay(day) === 6
    if (isWeekend) return

    setSelectedDate(dateStr)
    setSelectedRecord({ status, isJustified })

    if (isAssigned) {
      if (day >= today) {
        // Future assigned day
        if (status === 'scheduled') setModal('vacation')
        else if (status === 'vacation') setModal('undoVacation')
      } else {
        // Past assigned day
        if (status === 'attended') setModal('absence')
        else if (status === 'absent') setModal('undoAbsence')
        else if (status === 'vacation') setModal('undoVacation')
      }
    } else {
      // Non-assigned day: always open the recovery modal (it reports when there
      // are no available recovery credits).
      if (status === 'recovery') setModal('undoRecovery')
      else setModal('recovery')
    }
  }

  const closeModal = () => { setModal(null); setSelectedDate(null); setSelectedRecord(null) }

  const withProcessing = async (fn) => {
    setProcessing(true)
    try {
      await fn()
      await onRefresh()
    } catch (err) {
      console.error(err)
    } finally {
      setProcessing(false)
      closeModal()
    }
  }

  const handleUndoPayment = async () => {
    setPaymentDropOpen(false)
    await withProcessing(() => unmarkMonthPaid(client.id, year, month))
  }

  const canRemoveDiscount = invoice?.paymentStatus === 'pending' && invoice?.invoiceStatus === 'pending'
  const handleRemoveDiscount = async () => {
    try { await removePlanDiscount(client.id, year, month, year, month); await onRefresh() }
    catch (e) { window.alert(e.message) }
  }

  return (
    <>
      <Card className="flex-shrink-0 w-80 snap-center">
        <CardHeader className="pb-2">
          {/* Month title */}
          <h3 className="font-semibold text-gray-900 capitalize mb-2">
            {format(new Date(year, month, 1), 'MMMM yyyy', { locale: es })}
            {isProrated && <span className="ml-2 text-xs font-normal text-blue-600">(prorrateado)</span>}
            {canViewBilling && invoice?.discountPercent > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 align-middle">
                −{invoice.discountPercent}%
                {canRemoveDiscount && (
                  <button
                    onClick={handleRemoveDiscount}
                    className="ml-0.5 text-violet-500 hover:text-violet-800"
                    title="Quitar descuento"
                  >
                    ✕
                  </button>
                )}
              </span>
            )}
          </h3>

          {/* Payment + Invoice badges */}
          {canViewBilling && (
          <div className="flex gap-2">
            {/* Payment badge */}
            <div className="relative flex-1" ref={paymentDropRef}>
              <button
                onClick={() => setPaymentDropOpen(!paymentDropOpen)}
                className={`w-full flex items-center justify-between gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  isPaid
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : isOverdue
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                } ${isPaid ? 'hover:bg-green-100' : isOverdue ? 'hover:bg-red-100' : 'hover:bg-amber-100'}`}
              >
                <span className="flex items-center gap-1">
                  {isPaid ? 'Cobrado' : 'Pendiente'}
                  {isOverdue && <span className="px-1 py-0.5 bg-red-600 text-white rounded text-[10px] leading-none">Vencido</span>}
                </span>
                <NavArrowDown className="w-3 h-3" />
              </button>
              {paymentDropOpen && (
                <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1">
                  {isPaid ? (
                    <>
                      <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                        <div>Fecha de pago: {invoice.paidDate ? format(new Date(invoice.paidDate + 'T12:00:00'), "d/M/yyyy") : format(new Date(invoice.paidAt), "d/M/yyyy")}</div>
                        {invoice.paidAmount && <div className="font-semibold text-gray-900">{formatCurrency(invoice.paidAmount)}</div>}
                        {invoice.paymentMethod && <div>{invoice.paymentMethod}</div>}
                      </div>
                      <button
                        onClick={handleUndoPayment}
                        className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                      >
                        Deshacer cobro
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => { setPaymentDropOpen(false); setModal('payment') }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Marcar como cobrado
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Invoice badge → abre el modal de emisión/info */}
            <div className="flex-1">
              <button
                onClick={() => setEmitModalOpen(true)}
                className={`w-full flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  isInvoiced
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : invoice?.emitError
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-gray-50 text-gray-500 border-gray-200'
                } ${isInvoiced ? 'hover:bg-indigo-100' : invoice?.emitError ? 'hover:bg-red-100' : 'hover:bg-gray-100'}`}
              >
                {isInvoiced
                  ? `Facturado${invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ''}`
                  : invoice?.emitError ? 'Error al emitir' : 'Sin factura'}
              </button>
            </div>
          </div>
          )}

          {/* Stats row */}
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-sm font-medium text-gray-700">
              {billedDays}/{daysPerMonth}
            </span>
            {recoveryDays > 0 && (
              <span className="text-sm text-blue-600 font-medium">+{recoveryDays}</span>
            )}
            {vacationPct > 0 && (
              <span className="text-xs text-orange-600">(-{vacationPct}%)</span>
            )}
            {canViewBilling && (
              <span className="ml-auto text-base font-bold text-gray-900">
                {formatCurrency(displayAmount)}
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-1">
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => (
              <div key={i} className="text-center text-xs font-medium text-gray-400">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: paddingDays }).map((_, i) => <div key={`pad-${i}`} className="h-7" />)}
            {days.map(day => {
              const isWeekend = getDay(day) === 0 || getDay(day) === 6
              const { status, isJustified, isAssigned, notes } = getDayStatus(day)
              const isStartDate = format(day, 'yyyy-MM-dd') === format(clientStart, 'yyyy-MM-dd')
              // Every weekday (Mon-Fri) is clickable. Recovery still requires an
              // available credit, but that is enforced inside the recovery modal.
              const canClick = !isWeekend && !isDeactivated && (
                isAssigned ||
                status === 'recovery' ||
                status === 'not_scheduled'
              )

              const colorClass = isWeekend
                ? 'text-gray-300'
                : status === 'not_scheduled'
                  ? 'bg-gray-50 text-gray-400 border border-dashed border-gray-200 hover:bg-blue-50 hover:text-blue-500'
                  : getDayStyle(status, isJustified)

              const tip = getDayTooltip(status, isJustified, notes)
              const isRecoverable = status === 'not_scheduled' && !isWeekend
              const nativeTitle = isStartDate
                ? 'Primer día'
                : isRecoverable
                  ? 'Recuperar día'
                  : tip.title
                    ? (tip.reason ? `${tip.title}\n${tip.reason}` : tip.title)
                    : ''

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => canClick && handleDayClick(day)}
                  disabled={!canClick || processing}
                  className={`
                    h-7 w-7 rounded text-xs font-medium transition-opacity relative group
                    ${colorClass}
                    ${canClick ? 'hover:opacity-75 cursor-pointer' : 'cursor-default'}
                    ${isStartDate ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}
                  `}
                  title={nativeTitle}
                >
                  {format(day, 'd')}
                  {tip.title && (
                    <span className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-gray-900 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 ${tip.reason ? 'max-w-[200px] whitespace-normal text-left' : 'whitespace-nowrap'}`}>
                      <span className="font-medium block">{tip.title}</span>
                      {tip.reason && <span className="block text-gray-300 mt-0.5">{tip.reason}</span>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── PaymentModal ── */}
      <PaymentModal
        isOpen={modal === 'payment'}
        onClose={closeModal}
        clientId={client.id}
        year={year}
        month={month}
        liveAmount={liveChargeableAmount}
        userName={user?.name}
        onConfirm={(amount, method, notes, paidDate) =>
          withProcessing(() => markMonthPaid(client.id, year, month, amount, method, notes, paidDate))
        }
      />

      {/* ── InvoiceModal (marca manual, fallback) ── */}
      <InvoiceModal
        isOpen={modal === 'invoice'}
        onClose={closeModal}
        onConfirm={(number, url) =>
          withProcessing(() => markMonthInvoiced(client.id, year, month, number, url))
        }
      />

      {/* ── EmitInvoiceModal (emisión + info post-factura) ── */}
      <EmitInvoiceModal
        isOpen={emitModalOpen}
        onClose={() => setEmitModalOpen(false)}
        client={client}
        plan={plan}
        year={year}
        month={month}
        discountedDays={discountedDays}
        invoice={invoice}
        onRefresh={onRefresh}
        userRole={user?.role}
      />

      {/* ── AbsenceModal ── */}
      <AbsenceModal
        isOpen={modal === 'absence'}
        onClose={closeModal}
        date={selectedDate}
        onConfirm={(isJustified, notes) =>
          withProcessing(() => markDayAbsent(client.id, selectedDate, isJustified, user?.name, notes))
        }
      />

      {/* ── Undo absence ── */}
      <ConfirmModal
        isOpen={modal === 'undoAbsence'}
        onClose={closeModal}
        title="Deshacer falta"
        message={`¿Revertir la falta del ${selectedDate ? format(new Date(selectedDate), "d 'de' MMMM", { locale: es }) : ''}? ${selectedRecord?.isJustified ? 'Se descontará 1 día de recupero.' : ''}`}
        confirmLabel="Sí, deshacer"
        onConfirm={() =>
          withProcessing(() => unmarkDayAbsent(client.id, selectedDate, user?.name))
        }
        loading={processing}
      />

      {/* ── VacationModal ── */}
      <VacationModal
        isOpen={modal === 'vacation'}
        onClose={closeModal}
        date={selectedDate}
        isPaid={isPaid}
        onConfirmSingle={() =>
          withProcessing(() => markDayVacation(client.id, selectedDate, user?.name))
        }
        onConfirmRange={(from, to) =>
          withProcessing(() => markVacationRange(client.id, from, to, user?.name))
        }
      />

      {/* ── Undo vacation ── */}
      <ConfirmModal
        isOpen={modal === 'undoVacation'}
        onClose={closeModal}
        title="Quitar vacación"
        message={`¿Quitar vacaciones del ${selectedDate ? format(new Date(selectedDate), "d 'de' MMMM", { locale: es }) : ''}?${isPaid ? ' El mes ya fue cobrado — se descontará 1 día de recupero.' : ''}`}
        confirmLabel="Sí, quitar"
        onConfirm={() =>
          withProcessing(() => unmarkDayVacation(client.id, selectedDate, user?.name))
        }
        loading={processing}
      />

      {/* ── Recovery attendance ── */}
      <ConfirmModal
        isOpen={modal === 'recovery'}
        onClose={closeModal}
        title="Marcar día recuperado"
        confirmDisabled={client.recoveryDaysAvailable <= 0}
        message={client.recoveryDaysAvailable <= 0
          ? `Este cliente no tiene días de recupero disponibles. Para recuperar un día, primero debe registrarse una falta justificada con recupero.`
          : `¿Marcar el ${selectedDate ? format(new Date(selectedDate), "d 'de' MMMM", { locale: es }) : ''} como día de recupero? Se usará 1 día de recupero (disponibles: ${client.recoveryDaysAvailable}).`}
        confirmLabel="Confirmar recupero"
        confirmClass="bg-blue-600 hover:bg-blue-700"
        onConfirm={() =>
          withProcessing(() => markDayRecoveryAttended(client.id, selectedDate, user?.name))
        }
        loading={processing}
      />

      {/* ── Undo recovery ── */}
      <ConfirmModal
        isOpen={modal === 'undoRecovery'}
        onClose={closeModal}
        title="Deshacer recupero"
        message={`¿Deshacer el día recuperado del ${selectedDate ? format(new Date(selectedDate), "d 'de' MMMM", { locale: es }) : ''}? Se devolverá 1 día de recupero.`}
        confirmLabel="Sí, deshacer"
        onConfirm={() =>
          withProcessing(() => unmarkDayRecoveryAttended(client.id, selectedDate, user?.name))
        }
        loading={processing}
      />
    </>
  )
}

// ============================================================
// PaymentModal
// ============================================================
function PaymentModal({ isOpen, onClose, clientId, year, month, liveAmount, userName, onConfirm }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('')
  const [notes, setNotes] = useState('')
  const [paidDate, setPaidDate] = useState('')
  const [loadingBilling, setLoadingBilling] = useState(false)
  const [billing, setBilling] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) { setAmount(''); setMethod(''); setNotes(''); setPaidDate(''); setBilling(null); setError(''); return }
    // Default paid date to today
    setPaidDate(format(new Date(), 'yyyy-MM-dd'))
    // Fetch authoritative billing from server
    setLoadingBilling(true)
    calculateMonthBilling(clientId, year, month)
      .then(b => { setBilling(b); setAmount(String(b.totalChargeableGross)) })
      .catch(() => setAmount(String(liveAmount)))
      .finally(() => setLoadingBilling(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleSubmit = async () => {
    const num = Number(amount)
    if (isNaN(num) || num < 0) { setError('Ingresa un monto válido'); return }
    if (!paidDate) { setError('Ingresa la fecha de pago'); return }
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(num, method || null, notes || null, paidDate)
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  const monthName = format(new Date(year, month, 1), 'MMMM yyyy', { locale: es })

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Cobrar ${monthName}`}>
      <div className="space-y-4">
        {loadingBilling ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : billing && (
          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between text-gray-600">
              <span>Días planificados:</span><span>{billing.plannedDays}</span>
            </div>
            {billing.vacationDays > 0 && (
              <div className="flex justify-between text-orange-600">
                <span>Vacaciones:</span><span>-{billing.vacationDays} días</span>
              </div>
            )}
            <div className="flex justify-between font-medium text-gray-800 border-t border-gray-200 pt-1">
              <span>Días a cobrar:</span><span>{billing.chargeableDays}/{billing.daysPerMonth}</span>
            </div>
            <div className="flex justify-between text-gray-700 pt-1">
              <span>Mensualidad:</span><span>{formatCurrency(billing.attendanceChargeableGross)}</span>
            </div>
            {billing.hasTransport && (
              <div className="flex justify-between text-gray-700">
                <span>Transporte:</span><span>{formatCurrency(billing.transportChargeableGross)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-300 pt-1">
              <span>Total a cobrar:</span><span>{formatCurrency(billing.totalChargeableGross)}</span>
            </div>
          </div>
        )}

        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Monto cobrado</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="0"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de pago</label>
          <input
            type="date"
            value={paidDate}
            onChange={e => setPaidDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Medio de pago <span className="text-gray-400">(opcional)</span></label>
          <input
            type="text"
            value={method}
            onChange={e => setMethod(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Ej: transferencia, efectivo"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notas <span className="text-gray-400">(opcional)</span></label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex gap-3 justify-end pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} loading={submitting} className="bg-green-600 hover:bg-green-700">
            <Check className="w-4 h-4" />
            Confirmar cobro
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ============================================================
// InvoiceModal
// ============================================================
function InvoiceModal({ isOpen, onClose, onConfirm }) {
  const [number, setNumber] = useState('')
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (!isOpen) { setNumber(''); setUrl(''); setError('') } }, [isOpen])

  const handleSubmit = async () => {
    if (!number.trim()) { setError('El número de factura es obligatorio'); return }
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(number.trim(), url.trim() || null)
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar factura electrónica">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Número de factura</label>
          <input
            type="text"
            value={number}
            onChange={e => setNumber(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Ej: 0001-00000123"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">URL de la factura <span className="text-gray-400">(opcional)</span></label>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="https://..."
          />
        </div>
        <div className="flex gap-3 justify-end pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} loading={submitting}>Registrar</Button>
        </div>
      </div>
    </Modal>
  )
}

// ============================================================
// AbsenceModal
// ============================================================
function AbsenceModal({ isOpen, onClose, date, onConfirm }) {
  const [selected, setSelected] = useState(null) // null | true (justified) | false
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset on open/close
  useEffect(() => {
    if (isOpen) {
      setSelected(null)
      setReason('')
      setSubmitting(false)
    }
  }, [isOpen])

  const handleConfirm = async () => {
    if (selected === null) return
    setSubmitting(true)
    try {
      await onConfirm(selected, reason.trim() || null)
    } finally {
      setSubmitting(false)
    }
  }

  // Static Tailwind classes only — the JIT does NOT detect interpolated class names
  // like `border-${color}-400`, so both variants are written out in full.
  const baseOption = 'w-full p-4 rounded-lg border text-left transition-colors'
  const justifiedClass = selected === true
    ? `${baseOption} border-green-400 bg-green-50 ring-1 ring-green-300`
    : `${baseOption} border-gray-200 hover:bg-green-50`
  const unjustifiedClass = selected === false
    ? `${baseOption} border-red-400 bg-red-50 ring-1 ring-red-300`
    : `${baseOption} border-gray-200 hover:bg-red-50`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Registrar falta — ${date ? format(new Date(date), "d 'de' MMMM", { locale: es }) : ''}`}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">El cliente no asistió. ¿Fue una falta justificada?</p>
        <button
          type="button"
          onClick={() => setSelected(true)}
          disabled={submitting}
          className={justifiedClass}
        >
          <p className="font-medium text-gray-900 flex items-center gap-1.5">
            {selected === true && <Check className="w-4 h-4 text-green-600" />}
            Justificada
          </p>
          <p className="text-sm text-gray-500 mt-0.5">El cliente gana 1 día de recupero</p>
        </button>
        <button
          type="button"
          onClick={() => setSelected(false)}
          disabled={submitting}
          className={unjustifiedClass}
        >
          <p className="font-medium text-gray-900 flex items-center gap-1.5">
            {selected === false && <Check className="w-4 h-4 text-red-600" />}
            No justificada
          </p>
          <p className="text-sm text-gray-500 mt-0.5">Sin crédito de recupero</p>
        </button>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Motivo (opcional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo de la falta..."
            rows={2}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selected === null || submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Guardando...' : 'Confirmar falta'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ============================================================
// VacationModal
// ============================================================
function VacationModal({ isOpen, onClose, date, isPaid, onConfirmSingle, onConfirmRange }) {
  const [tab, setTab] = useState('single')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) { setTab('single'); setFromDate(''); setToDate(''); setError('') }
    else if (date) { setFromDate(date); setToDate(date) }
  }, [isOpen, date])

  const handleSubmit = async () => {
    if (tab === 'range' && (!fromDate || !toDate)) { setError('Selecciona ambas fechas'); return }
    if (tab === 'range' && fromDate > toDate) { setError('La fecha de inicio debe ser anterior al fin'); return }
    setSubmitting(true)
    setError('')
    try {
      if (tab === 'single') await onConfirmSingle()
      else await onConfirmRange(fromDate, toDate)
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Marcar vacaciones">
      <div className="space-y-4">
        {isPaid && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            El mes ya fue cobrado — se acreditará 1 día de recupero por cada día de vacación marcado.
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
          {[{ id: 'single', label: 'Día único' }, { id: 'range', label: 'Rango de fechas' }].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'single' ? (
          <div className="p-3 bg-gray-50 rounded-lg text-sm">
            <span className="text-gray-600">Fecha: </span>
            <span className="font-medium">{date ? format(new Date(date), "d 'de' MMMM, yyyy", { locale: es }) : ''}</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <p className="text-xs text-gray-500">Solo se marcarán los días asignados al plan del cliente.</p>
          </div>
        )}

        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

        <div className="flex gap-3 justify-end pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} loading={submitting} className="bg-orange-500 hover:bg-orange-600">
            Confirmar vacaciones
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ============================================================
// ConfirmModal (generic)
// ============================================================
function ConfirmModal({ isOpen, onClose, title, message, confirmLabel, confirmClass, onConfirm, loading, confirmDisabled }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-gray-600 text-sm">{message}</p>
        <div className="flex gap-3 justify-end pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>{confirmDisabled ? 'Cerrar' : 'Cancelar'}</Button>
          {!confirmDisabled && (
            <Button onClick={onConfirm} loading={loading} className={confirmClass}>
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
