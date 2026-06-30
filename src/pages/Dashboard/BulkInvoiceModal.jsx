import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { formatCurrency } from '../../utils/format'
import { lastBusinessDayOfMonth } from '../../utils/date'
import { emitInvoice, markMonthPaid } from '../../services/api'

const RATE_LIMIT_MS = 1100 // delay entre llamadas (rate-limit de Biller)

// runStatus por fila: idle | queued | running | success | error | skipped
function eligibilityBadge(eligibility) {
  if (eligibility === 'sin CI') return { label: 'sin CI', cls: 'bg-red-50 text-red-700' }
  if (eligibility === 'monto 0') return { label: 'monto 0', cls: 'bg-gray-100 text-gray-500' }
  return { label: 'listo', cls: 'bg-green-50 text-green-700' }
}

export default function BulkInvoiceModal({
  isOpen, onClose, mode, rows, year, month, monthLabel, onComplete
}) {
  const isPay = mode === 'pay'

  // Estado de las filas (se reinicia cada vez que se abre el modal)
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [running, setRunning] = useState(false)
  const [hasRun, setHasRun] = useState(false)

  // Settings globales de la corrida (solo emit)
  const [fechaEmision, setFechaEmision] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setItems(rows.map(r => ({
      ...r,
      runStatus: r.eligibility === 'listo' ? 'idle' : 'skipped',
      runError: null,
      selected: r.eligibility === 'listo'
    })))
    setSearch('')
    setRunning(false)
    setHasRun(false)
    setFechaEmision(format(lastBusinessDayOfMonth(year, month), 'yyyy-MM-dd'))
    setFechaVencimiento('')
  }, [isOpen, rows, year, month])

  const setItem = (id, patch) =>
    setItems(curr => curr.map(it => it.id === id ? { ...it, ...patch } : it))

  // Corre un lote secuencial sobre las filas dadas (por id).
  const processIds = async (ids) => {
    setRunning(true)
    setHasRun(true)
    setItems(curr => curr.map(it => ids.includes(it.id) ? { ...it, runStatus: 'queued', runError: null } : it))
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const target = items.find(it => it.id === id)
      setItem(id, { runStatus: 'running' })
      try {
        if (isPay) {
          await markMonthPaid(id, year, month, target.amount)
        } else {
          await emitInvoice(id, year, month, {
            fechaEmision: fechaEmision || undefined,
            fechaVencimiento: fechaVencimiento || undefined
          })
        }
        setItem(id, { runStatus: 'success' })
      } catch (e) {
        setItem(id, { runStatus: 'error', runError: e.message })
      }
      if (i < ids.length - 1) await new Promise(res => setTimeout(res, RATE_LIMIT_MS))
    }
    setRunning(false)
  }

  const runSelected = () => {
    const ids = items.filter(it => it.selected && it.runStatus !== 'skipped').map(it => it.id)
    if (ids.length) processIds(ids)
  }
  const retryFailed = () => {
    const ids = items.filter(it => it.runStatus === 'error').map(it => it.id)
    if (ids.length) processIds(ids)
  }

  const handleClose = () => {
    if (running) return
    onClose()
    if (hasRun) onComplete()
  }

  const selectedCount = items.filter(it => it.selected && it.runStatus !== 'skipped').length
  const failedCount = items.filter(it => it.runStatus === 'error').length
  const successCount = items.filter(it => it.runStatus === 'success').length
  const processedCount = successCount + failedCount
  const runTotal = items.filter(it => ['queued', 'running', 'success', 'error'].includes(it.runStatus)).length

  const query = search.trim().toLowerCase()
  const visible = useMemo(() => query
    ? items.filter(it => it.name.toLowerCase().includes(query) || (it.transferResponsible || '').toLowerCase().includes(query))
    : items, [items, query])

  const actionVerb = isPay ? 'Marcar cobradas' : 'Emitir seleccionadas'

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`${isPay ? 'Marcar cobrado' : 'Facturar'} — ${monthLabel}`} size="xl">
      <div className="space-y-4">
        {/* Progreso */}
        {runTotal > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{isPay ? 'Cobradas' : 'Emitidas'} {processedCount}/{runTotal}</span>
              <span className="text-xs">
                <span className="text-green-700">✓ {successCount}</span>
                {failedCount > 0 && <span className="text-red-600"> · ✕ {failedCount}</span>}
              </span>
            </div>
            <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all"
                style={{ width: `${runTotal ? (processedCount / runTotal) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o responsable…"
          disabled={running}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-gray-50"
        />

        <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">No hay clientes</div>
          ) : visible.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">Sin resultados</div>
          ) : visible.map((it) => {
            const selectable = it.runStatus !== 'skipped' && !running
            return (
              <label key={it.id} className={`flex items-center gap-3 px-3 py-3 text-sm ${it.runStatus === 'skipped' ? 'opacity-60' : selectable ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
                <input type="checkbox" checked={it.selected} disabled={!selectable}
                  onChange={(e) => setItem(it.id, { selected: e.target.checked })} />
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <p className="text-gray-900 truncate">{it.name}</p>
                  <p className={`text-xs truncate ${it.transferResponsible ? 'font-medium text-gray-600' : 'text-gray-400'}`}>
                    {it.transferResponsible || 'Sin responsable de transferencia'}
                  </p>
                  {it.runStatus === 'error' && it.runError && (
                    <p className="text-xs text-red-600 break-words">{it.runError}</p>
                  )}
                </div>
                <span className="text-gray-600 whitespace-nowrap">{formatCurrency(it.amount)}</span>
                <RowStatus item={it} isPay={isPay} />
              </label>
            )
          })}
        </div>

        {/* Settings globales (solo emit) — junto a los botones */}
        {!isPay && (
          <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
            <Input label="Fecha de emisión" type="date" value={fechaEmision}
              onChange={e => setFechaEmision(e.target.value)} disabled={running} />
            <Input label="Fecha de vencimiento" type="date" value={fechaVencimiento}
              onChange={e => setFechaVencimiento(e.target.value)} disabled={running} />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={running}>Cerrar</Button>
          {failedCount > 0 && !running ? (
            <Button onClick={retryFailed}>Reintentar fallidas ({failedCount})</Button>
          ) : (
            <Button onClick={runSelected} loading={running} disabled={running || selectedCount === 0}>
              {actionVerb} ({selectedCount})
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function RowStatus({ item, isPay }) {
  const { runStatus } = item
  if (runStatus === 'running') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-indigo-600 whitespace-nowrap">
        <span className="h-3 w-3 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
        {isPay ? 'cobrando…' : 'emitiendo…'}
      </span>
    )
  }
  if (runStatus === 'success') {
    return <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700 whitespace-nowrap">{isPay ? 'cobrada' : 'emitida'}</span>
  }
  if (runStatus === 'error') {
    return <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700 whitespace-nowrap">error</span>
  }
  if (runStatus === 'queued') {
    return <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 whitespace-nowrap">en cola</span>
  }
  if (runStatus === 'skipped') {
    const b = eligibilityBadge(item.eligibility)
    return <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${b.cls}`}>{b.label}</span>
  }
  // idle
  return <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700 whitespace-nowrap">listo</span>
}
