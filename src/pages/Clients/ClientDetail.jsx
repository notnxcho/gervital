import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit, Phone, MapPin, Calendar, MoreVert, Trash, WarningCircle, Check, NavArrowDown } from 'iconoir-react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  getClientById,
  getClientAttendance,
  getClientInvoices,
  getPlanPricing,
  calculatePlanPriceSync,
  advanceScheduledAttendance,
  ensureClientMonths,
  calculateMonthBilling,
  markMonthPaid,
  markMonthInvoiced,
  unmarkMonthPaid,
  markDayAbsent,
  unmarkDayAbsent,
  markDayVacation,
  unmarkDayVacation,
  markVacationRange,
  markDayRecoveryAttended,
  unmarkDayRecoveryAttended,
  deleteClient
} from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import Button from '../../components/ui/Button'
import Card, { CardContent, CardHeader } from '../../components/ui/Card'
import Tabs from '../../components/ui/Tabs'
import Modal from '../../components/ui/Modal'

const SCHEDULE_LABELS = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  full_day: 'Día completo'
}

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

function getDayTooltip(status, isJustified) {
  if (status === 'attended') return 'Asistió'
  if (status === 'absent') return isJustified ? 'Falta justificada (+1 recupero)' : 'Falta no justificada'
  if (status === 'vacation') return 'Vacaciones'
  if (status === 'recovery') return 'Día recuperado'
  if (status === 'scheduled') return 'Programado'
  return ''
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [client, setClient] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [invoices, setInvoices] = useState([])
  const [pricingData, setPricingData] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('general')
  const [showOptionsMenu, setShowOptionsMenu] = useState(false)
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const optionsMenuRef = useRef(null)

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
      const [clientData, attendanceData, invoicesData, pricing] = await Promise.all([
        getClientById(id),
        getClientAttendance(id),
        getClientInvoices(id),
        getPlanPricing()
      ])
      // Run setup functions (non-blocking, best-effort)
      Promise.all([
        advanceScheduledAttendance().catch(() => {}),
        ensureClientMonths(id).catch(() => {})
      ]).then(() => {
        // Reload invoices after ensureClientMonths creates new rows
        getClientInvoices(id).then(updated => setInvoices(updated)).catch(() => {})
      })

      setClient(clientData)
      setAttendance(attendanceData)
      setInvoices(invoicesData)
      setPricingData(pricing)
    } catch (error) {
      console.error('Error cargando datos del cliente:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteClient = async () => {
    setDeleting(true)
    try {
      await deleteClient(id)
      navigate('/clientes')
    } catch (error) {
      console.error('Error eliminando cliente:', error)
    } finally {
      setDeleting(false)
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/clientes')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            {client.firstName} {client.lastName}
          </h1>
          <p className="text-sm text-gray-500">
            Cliente desde {format(new Date(client.startDate), "d 'de' MMMM, yyyy", { locale: es })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => navigate(`/clientes/${id}/editar`)}>
            <Edit className="w-4 h-4" />
            Editar
          </Button>
          <div className="relative" ref={optionsMenuRef}>
            <Button variant="ghost" size="sm" onClick={() => setShowOptionsMenu(!showOptionsMenu)} className="p-2">
              <MoreVert className="w-5 h-5" />
            </Button>
            {showOptionsMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1">
                <button
                  onClick={() => { setShowOptionsMenu(false); setDeleteModal(true) }}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash className="w-4 h-4" />
                  Dar de baja
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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
              <p className="font-semibold text-gray-900">{client.plan.hasTransport ? 'Incluido' : 'No incluido'}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Días de recupero</p>
            <p className="text-2xl font-bold text-indigo-600">{client.recoveryDaysAvailable}</p>
          </div>
        </CardContent>
      </Card>

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
            </div>
          )}
          {activeTab === 'contact' && (
            <div className="space-y-6">
              <div>
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <Phone className="w-4 h-4" /> Contacto de emergencia
                </h4>
                <div className="grid grid-cols-3 gap-4 pl-6">
                  <div><p className="text-sm text-gray-500">Nombre</p><p className="font-medium text-gray-900">{client.emergencyContact?.name}</p></div>
                  <div><p className="text-sm text-gray-500">Vínculo</p><p className="font-medium text-gray-900">{client.emergencyContact?.relationship}</p></div>
                  <div><p className="text-sm text-gray-500">Teléfono</p><p className="font-medium text-gray-900">{client.emergencyContact?.phone}</p></div>
                </div>
              </div>
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
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-gray-500">Restricciones alimentarias</p><p className="font-medium text-gray-900">{client.medicalInfo?.dietaryRestrictions || '-'}</p></div>
                <div><p className="text-sm text-gray-500">Restricciones médicas</p><p className="font-medium text-gray-900">{client.medicalInfo?.medicalRestrictions || '-'}</p></div>
                <div><p className="text-sm text-gray-500">Restricciones de movilidad</p><p className="font-medium text-gray-900">{client.medicalInfo?.mobilityRestrictions || '-'}</p></div>
                <div><p className="text-sm text-gray-500">Medicación</p><p className="font-medium text-gray-900">{client.medicalInfo?.medication || '-'}</p></div>
                <div><p className="text-sm text-gray-500">Horario de medicación</p><p className="font-medium text-gray-900">{client.medicalInfo?.medicationSchedule || '-'}</p></div>
              </div>
              {client.medicalInfo?.notes && (
                <div><p className="text-sm text-gray-500">Notas adicionales</p><p className="font-medium text-gray-900">{client.medicalInfo.notes}</p></div>
              )}
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
              user={user}
              onRefresh={loadClientData}
            />
          ))
        )}
      </div>

      {/* Delete modal */}
      <Modal isOpen={deleteModal} onClose={() => setDeleteModal(false)} title="Dar de baja cliente">
        <div className="flex items-start gap-4 mb-6">
          <div className="p-3 bg-red-100 rounded-full">
            <WarningCircle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <p className="text-gray-900 font-medium">
              ¿Estás seguro de que deseas dar de baja a {client?.firstName} {client?.lastName}?
            </p>
            <p className="text-gray-500 text-sm mt-1">
              Esta acción eliminará todos los datos del cliente y no se puede deshacer.
            </p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setDeleteModal(false)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDeleteClient} loading={deleting}>Dar de baja</Button>
        </div>
      </Modal>
    </div>
  )
}

// ============================================================
// MonthCard
// ============================================================
function MonthCard({ client, year, month, invoice, attendance, pricingData, user, onRefresh }) {
  const [processing, setProcessing] = useState(false)
  // Modal state: null | 'payment' | 'undoPayment' | 'invoice' | 'absence' | 'undoAbsence' | 'vacation' | 'undoVacation' | 'recovery' | 'undoRecovery'
  const [modal, setModal] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [paymentDropOpen, setPaymentDropOpen] = useState(false)
  const [invoiceDropOpen, setInvoiceDropOpen] = useState(false)
  const paymentDropRef = useRef(null)
  const invoiceDropRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (paymentDropRef.current && !paymentDropRef.current.contains(e.target)) setPaymentDropOpen(false)
      if (invoiceDropRef.current && !invoiceDropRef.current.contains(e.target)) setInvoiceDropOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const monthStart = startOfMonth(new Date(year, month, 1))
  const monthEnd = endOfMonth(monthStart)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  const startDay = getDay(monthStart)
  const paddingDays = startDay === 0 ? 6 : startDay - 1

  const today = new Date()
  const isPaid = invoice?.paymentStatus === 'paid'
  const isInvoiced = invoice?.invoiceStatus === 'invoiced'

  // --- Billing calculation (local, for unpaid months) ---
  const clientStart = new Date(client.startDate)
  const effectiveStart = clientStart > monthStart ? clientStart : monthStart

  const fullMonthDays = days.filter(d => {
    const name = DAY_INDEX_TO_NAME[getDay(d)]
    return name && client.plan.assignedDays.includes(name)
  }).length

  const vacationDays = days.filter(d => {
    const dateStr = format(d, 'yyyy-MM-dd')
    const rec = attendance.find(a => a.date === dateStr)
    const name = DAY_INDEX_TO_NAME[getDay(d)]
    return name && client.plan.assignedDays.includes(name) && d >= effectiveStart && rec?.status === 'vacation'
  }).length

  const plannedDays = days.filter(d => {
    const dateStr = format(d, 'yyyy-MM-dd')
    const rec = attendance.find(a => a.date === dateStr)
    const name = DAY_INDEX_TO_NAME[getDay(d)]
    if (!name || !client.plan.assignedDays.includes(name)) return false
    if (d < effectiveStart) return false
    return rec?.status !== 'vacation'
  }).length

  const chargeableDays = plannedDays - vacationDays
  const recoveryDays = days.filter(d => {
    const dateStr = format(d, 'yyyy-MM-dd')
    return attendance.find(a => a.date === dateStr)?.status === 'recovery'
  }).length

  const monthlyRate = calculatePlanPriceSync(pricingData, client.plan.frequency, client.plan.schedule, client.plan.hasTransport)
  const liveChargeableAmount = fullMonthDays > 0
    ? Math.round((chargeableDays / fullMonthDays) * monthlyRate)
    : 0

  // If paid: use snapshot from invoice; otherwise live calculation
  const displayAmount = isPaid ? (invoice.paidAmount ?? invoice.chargeableAmount) : liveChargeableAmount
  const vacationPct = fullMonthDays > 0 && vacationDays > 0
    ? Math.round((vacationDays / fullMonthDays) * 100)
    : 0

  const isProrated = clientStart > monthStart && clientStart <= monthEnd

  // --- Day status lookup ---
  const getDayStatus = (day) => {
    const dateStr = format(day, 'yyyy-MM-dd')
    const rec = attendance.find(a => a.date === dateStr)
    const name = DAY_INDEX_TO_NAME[getDay(day)]
    const isAssigned = name && client.plan.assignedDays.includes(name)

    if (rec?.status === 'recovery') return { status: 'recovery', isJustified: false, isAssigned: false }
    if (!isAssigned) return { status: 'not_scheduled', isJustified: false, isAssigned: false }
    if (day < clientStart) return { status: 'not_scheduled', isJustified: false, isAssigned: false }
    if (rec) return { status: rec.status, isJustified: rec.isJustified ?? false, isAssigned: true }
    if (day > today) return { status: 'scheduled', isJustified: false, isAssigned: true }
    return { status: 'attended', isJustified: false, isAssigned: true }
  }

  const handleDayClick = (day) => {
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
      // Non-assigned day
      if (status === 'recovery') setModal('undoRecovery')
      else if (client.recoveryDaysAvailable > 0) setModal('recovery')
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

  return (
    <>
      <Card className="flex-shrink-0 w-80 snap-center">
        <CardHeader className="pb-2">
          {/* Month title */}
          <h3 className="font-semibold text-gray-900 capitalize mb-2">
            {format(new Date(year, month, 1), 'MMMM yyyy', { locale: es })}
            {isProrated && <span className="ml-2 text-xs font-normal text-blue-600">(prorrateado)</span>}
          </h3>

          {/* Payment + Invoice badges */}
          <div className="flex gap-2">
            {/* Payment badge */}
            <div className="relative flex-1" ref={paymentDropRef}>
              <button
                onClick={() => { setPaymentDropOpen(!paymentDropOpen); setInvoiceDropOpen(false) }}
                className={`w-full flex items-center justify-between gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  isPaid
                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                }`}
              >
                <span>{isPaid ? 'Cobrado' : 'Pendiente'}</span>
                <NavArrowDown className="w-3 h-3" />
              </button>
              {paymentDropOpen && (
                <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1">
                  {isPaid ? (
                    <>
                      <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                        <div>Cobrado el {format(new Date(invoice.paidAt), "d/M/yyyy")}</div>
                        {invoice.paidAmount && <div className="font-semibold text-gray-900">${invoice.paidAmount.toLocaleString()}</div>}
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

            {/* Invoice badge */}
            <div className="relative flex-1" ref={invoiceDropRef}>
              <button
                onClick={() => { setInvoiceDropOpen(!invoiceDropOpen); setPaymentDropOpen(false) }}
                className={`w-full flex items-center justify-between gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  isInvoiced
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                }`}
              >
                <span>{isInvoiced ? 'Facturado' : 'Sin factura'}</span>
                <NavArrowDown className="w-3 h-3" />
              </button>
              {invoiceDropOpen && (
                <div className="absolute top-full right-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1">
                  {isInvoiced ? (
                    <>
                      <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                        {invoice.invoiceNumber && <div className="font-semibold text-gray-900">Nro: {invoice.invoiceNumber}</div>}
                        <div>Facturado el {format(new Date(invoice.invoicedAt), "d/M/yyyy")}</div>
                      </div>
                      {invoice.invoiceUrl && (
                        <a
                          href={invoice.invoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
                        >
                          Ver factura
                        </a>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => { setInvoiceDropOpen(false); setModal('invoice') }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Marcar como facturado
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-sm font-medium text-gray-700">
              {chargeableDays}/{fullMonthDays}
            </span>
            {recoveryDays > 0 && (
              <span className="text-sm text-blue-600 font-medium">+{recoveryDays}</span>
            )}
            {vacationPct > 0 && (
              <span className="text-xs text-orange-600">(-{vacationPct}%)</span>
            )}
            <span className="ml-auto text-base font-bold text-gray-900">
              ${displayAmount.toLocaleString()}
            </span>
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
              const { status, isJustified, isAssigned } = getDayStatus(day)
              const isStartDate = format(day, 'yyyy-MM-dd') === format(clientStart, 'yyyy-MM-dd')
              const canClick = !isWeekend && (
                isAssigned ||
                status === 'recovery' ||
                (!isAssigned && client.recoveryDaysAvailable > 0 && status === 'not_scheduled' && !isWeekend)
              )

              const colorClass = isWeekend
                ? 'text-gray-300'
                : status === 'not_scheduled'
                  ? 'text-gray-300'
                  : getDayStyle(status, isJustified)

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
                  title={isStartDate ? 'Primer día' : getDayTooltip(status, isJustified)}
                >
                  {format(day, 'd')}
                  {getDayTooltip(status, isJustified) && (
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-900 text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      {getDayTooltip(status, isJustified)}
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
        onConfirm={(amount, method, notes) =>
          withProcessing(() => markMonthPaid(client.id, year, month, amount, method, notes))
        }
      />

      {/* ── InvoiceModal ── */}
      <InvoiceModal
        isOpen={modal === 'invoice'}
        onClose={closeModal}
        onConfirm={(number, url) =>
          withProcessing(() => markMonthInvoiced(client.id, year, month, number, url))
        }
      />

      {/* ── AbsenceModal ── */}
      <AbsenceModal
        isOpen={modal === 'absence'}
        onClose={closeModal}
        date={selectedDate}
        onConfirm={(isJustified) =>
          withProcessing(() => markDayAbsent(client.id, selectedDate, isJustified, user?.name))
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
        message={`¿Marcar el ${selectedDate ? format(new Date(selectedDate), "d 'de' MMMM", { locale: es }) : ''} como día de recupero? Se usará 1 día de recupero (disponibles: ${client.recoveryDaysAvailable}).`}
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
  const [loadingBilling, setLoadingBilling] = useState(false)
  const [billing, setBilling] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) { setAmount(''); setMethod(''); setNotes(''); setBilling(null); setError(''); return }
    // Fetch authoritative billing from server
    setLoadingBilling(true)
    calculateMonthBilling(clientId, year, month)
      .then(b => { setBilling(b); setAmount(String(b.chargeableAmount)) })
      .catch(() => setAmount(String(liveAmount)))
      .finally(() => setLoadingBilling(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleSubmit = async () => {
    const num = Number(amount)
    if (isNaN(num) || num < 0) { setError('Ingresa un monto válido'); return }
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(num, method || null, notes || null)
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
              <span>Días planificados:</span><span>{billing.plannedDays}/{billing.fullMonthDays}</span>
            </div>
            {billing.vacationDays > 0 && (
              <div className="flex justify-between text-orange-600">
                <span>Vacaciones:</span><span>-{billing.vacationDays} días</span>
              </div>
            )}
            <div className="flex justify-between font-medium text-gray-800 border-t border-gray-200 pt-1">
              <span>Días a cobrar:</span><span>{billing.chargeableDays}</span>
            </div>
            <div className="flex justify-between font-semibold text-gray-900">
              <span>Monto calculado:</span><span>${billing.chargeableAmount.toLocaleString()}</span>
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
  const [submitting, setSubmitting] = useState(false)

  const handleSelect = async (isJustified) => {
    setSubmitting(true)
    try {
      await onConfirm(isJustified)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Registrar falta — ${date ? format(new Date(date), "d 'de' MMMM", { locale: es }) : ''}`}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">El cliente no asistió. ¿Fue una falta justificada?</p>
        <button
          onClick={() => handleSelect(true)}
          disabled={submitting}
          className="w-full p-4 rounded-lg border border-green-200 text-left hover:bg-green-50 transition-colors"
        >
          <p className="font-medium text-gray-900">Justificada</p>
          <p className="text-sm text-gray-500 mt-0.5">El cliente gana 1 día de recupero</p>
        </button>
        <button
          onClick={() => handleSelect(false)}
          disabled={submitting}
          className="w-full p-4 rounded-lg border border-red-200 text-left hover:bg-red-50 transition-colors"
        >
          <p className="font-medium text-gray-900">No justificada</p>
          <p className="text-sm text-gray-500 mt-0.5">Sin crédito de recupero</p>
        </button>
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
function ConfirmModal({ isOpen, onClose, title, message, confirmLabel, confirmClass, onConfirm, loading }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-gray-600 text-sm">{message}</p>
        <div className="flex gap-3 justify-end pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={onConfirm} loading={loading} className={confirmClass}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
