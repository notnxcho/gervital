import { useState, useEffect } from 'react'
import { formatCurrency } from '../../utils/format'
import { format, endOfMonth } from 'date-fns'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input, { Textarea } from '../../components/ui/Input'
import { emitInvoice, checkDgiStatus, voidInvoice, getInvoicePdf, calculateMonthBilling } from '../../services/api'

const SCHEDULE_LABEL = { morning: 'Mañana', afternoon: 'Tarde', full_day: 'Día completo' }
const DOC_TYPE_LABEL = { ci: 'CI', rut: 'RUT', dni: 'DNI', pasaporte: 'Pasaporte', otro: 'Doc' }

const DGI_LABEL = { accepted: 'Aceptado', rejected: 'Rechazado', pending_dgi: 'Pendiente' }
const DGI_COLOR = { accepted: 'text-green-700', rejected: 'text-red-700', pending_dgi: 'text-amber-700' }

function defaultAdenda(discountedDays) {
  if (!discountedDays || discountedDays.length === 0) return ''
  const list = discountedDays
    .slice()
    .sort((a, b) => a - b)
    .map(d => format(d, 'dd/MM'))
    .join(', ')
  return `Días no facturados: ${list}`
}

export default function EmitInvoiceModal({
  isOpen, onClose, client, plan, year, month, discountedDays, invoice, onRefresh, userRole
}) {
  const isInvoiced = !!invoice?.billerId

  // Billing en vivo (se trae al abrir en modo formulario)
  const [billing, setBilling] = useState(null)
  const [billingLoading, setBillingLoading] = useState(false)

  // Form state (modo formulario)
  const [attConcepto, setAttConcepto] = useState('')
  const [attAmount, setAttAmount] = useState('')
  const [transConcepto, setTransConcepto] = useState('')
  const [transAmount, setTransAmount] = useState('')
  const [adenda, setAdenda] = useState('')
  const [fechaEmision, setFechaEmision] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [emitting, setEmitting] = useState(false)
  const [error, setError] = useState(null)
  const [dgiLoading, setDgiLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const hasTransport = !!billing?.hasTransport

  // Traer billing en vivo al abrir en modo formulario
  useEffect(() => {
    if (!isOpen || isInvoiced || !client?.id) return
    let cancelled = false
    setBillingLoading(true)
    calculateMonthBilling(client.id, year, month)
      .then(b => { if (!cancelled) setBilling(b) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setBillingLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, isInvoiced, client, year, month])

  // Pre-populate when opening in form mode
  useEffect(() => {
    if (!isOpen || isInvoiced || !billing) return
    const freq = plan?.frequency ?? client?.plan?.frequency ?? ''
    const sched = plan?.schedule ?? client?.plan?.schedule ?? ''
    setAttConcepto(`Plan ${freq} días x semana – ${SCHEDULE_LABEL[sched] ?? sched}`)
    setAttAmount(String(Math.round(Number(billing.attendanceChargeableGross) || 0)))
    setTransConcepto('Transporte')
    setTransAmount(String(Math.round(Number(billing.transportChargeableGross) || 0)))
    setAdenda(defaultAdenda(discountedDays))
    setFechaEmision(format(endOfMonth(new Date(year, month, 1)), 'yyyy-MM-dd'))
    setFechaVencimiento('')
    setError(null)
  }, [isOpen, isInvoiced, billing, plan, client, discountedDays, year, month])

  const attNum = Number(attAmount) || 0
  const transNum = hasTransport ? (Number(transAmount) || 0) : 0
  const total = attNum + transNum
  const canEmit = attNum > 0 && total > 0 && !emitting

  const handleEmit = async () => {
    setError(null)
    setEmitting(true)
    try {
      await emitInvoice(client.id, year, month, {
        attendanceConcepto: attConcepto,
        attendanceAmount: attNum,
        transportConcepto: hasTransport ? transConcepto : undefined,
        transportAmount: hasTransport ? transNum : undefined,
        adenda: adenda || undefined,
        fechaEmision: fechaEmision || undefined,
        fechaVencimiento: fechaVencimiento || undefined
      })
      await onRefresh()
      // El modal queda abierto: al refrescar, invoice.billerId pasa a estar seteado → modo info.
    } catch (err) {
      setError(err.message)
    } finally {
      setEmitting(false)
    }
  }

  const handleCheckDgi = async () => {
    setDgiLoading(true)
    try { await checkDgiStatus(client.id, year, month); await onRefresh() }
    catch (e) { window.alert(e.message) }
    finally { setDgiLoading(false) }
  }

  const handlePdf = async () => {
    setPdfLoading(true)
    try {
      const { pdf } = await getInvoicePdf(client.id, year, month)
      const bytes = Uint8Array.from(atob(pdf), c => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      window.open(url, '_blank')
    } catch (e) {
      window.alert(`No se pudo obtener el PDF: ${e.message}`)
    } finally {
      setPdfLoading(false)
    }
  }

  const handleVoid = async () => {
    if (!window.confirm('¿Anular la factura? Se generará una nota de crédito en Biller.')) return
    setVoiding(true)
    try { await voidInvoice(client.id, year, month); await onRefresh(); onClose() }
    catch (e) { window.alert(`No se pudo anular: ${e.message}`) }
    finally { setVoiding(false) }
  }

  if (!client) return null

  const fullName = `${client.firstName || ''} ${client.lastName || ''}`.trim()
  const docLabel = client.documentNumber
    ? `${DOC_TYPE_LABEL[client.documentType] ?? 'Doc'} ${client.documentNumber}`
    : 'Sin documento'

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!emitting && !voiding) onClose() }}
      title={isInvoiced ? 'Factura emitida' : 'Emitir e-Ticket'}
      size="lg"
    >
      {/* Datos del receptor (siempre, locked) */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <div className="text-xs text-gray-500">Nombre</div>
          <div className="text-sm font-medium text-gray-900">{fullName || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Documento</div>
          <div className="text-sm font-medium text-gray-900">{docLabel}</div>
        </div>
      </div>

      {isInvoiced ? (
        // ── Modo info ──────────────────────────────────────────────
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500">Comprobante</div>
              <div className="text-sm font-semibold text-gray-900">{invoice.invoiceNumber || `${invoice.billerSerie}-${invoice.billerNumero}`}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Emitido</div>
              <div className="text-sm text-gray-900">{invoice.invoicedAt ? format(new Date(invoice.invoicedAt), 'd/M/yyyy') : '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-gray-500">DGI:</span>
            <span className={DGI_COLOR[invoice.dgiStatus] ?? 'text-gray-500'}>
              {DGI_LABEL[invoice.dgiStatus] ?? '—'}
            </span>
            <button onClick={handleCheckDgi} disabled={dgiLoading} className="text-indigo-600 hover:underline disabled:opacity-50">
              {dgiLoading ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
          <div className="flex justify-between pt-3 border-t border-gray-100">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handlePdf} loading={pdfLoading}>Ver PDF</Button>
              {userRole === 'superadmin' && (
                <Button variant="secondary" onClick={handleVoid} loading={voiding} className="text-red-600">
                  Anular
                </Button>
              )}
            </div>
            <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          </div>
        </div>
      ) : (billingLoading || !billing) ? (
        <div className="py-10 text-center text-sm text-gray-400">
          {error ? <span className="text-red-600">{error}</span> : 'Calculando montos…'}
        </div>
      ) : (
        // ── Modo formulario ────────────────────────────────────────
        <div className="space-y-4">
          {/* Línea asistencia */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Input label="Concepto (plan)" value={attConcepto} onChange={e => setAttConcepto(e.target.value)} />
            </div>
            <Input label="Monto (IVA 22%)" type="number" value={attAmount} onChange={e => setAttAmount(e.target.value)} />
          </div>

          {/* Línea transporte (solo si tiene) */}
          {hasTransport && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Input label="Concepto (transporte)" value={transConcepto} onChange={e => setTransConcepto(e.target.value)} />
              </div>
              <Input label="Monto (IVA 10%)" type="number" value={transAmount} onChange={e => setTransAmount(e.target.value)} />
            </div>
          )}

          <Textarea label="Adenda" value={adenda} onChange={e => setAdenda(e.target.value)} rows={2} placeholder="Días no facturados…" />

          <div className="grid grid-cols-2 gap-3">
            <Input label="Fecha de emisión" type="date" value={fechaEmision} onChange={e => setFechaEmision(e.target.value)} />
            <Input label="Fecha de vencimiento" type="date" value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)} />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <span className="text-sm font-semibold text-gray-900">Total: {formatCurrency(total)}</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={emitting}>Cancelar</Button>
              <Button onClick={handleEmit} loading={emitting} disabled={!canEmit}>Emitir e-Ticket</Button>
            </div>
          </div>

          {error && (
            <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>
          )}
        </div>
      )}
    </Modal>
  )
}
