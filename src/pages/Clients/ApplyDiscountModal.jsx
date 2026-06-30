import { useState, useMemo, useEffect } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Percentage } from 'iconoir-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { formatCurrency } from '../../utils/format'
import { ordinalOf, eligibleMonths, isEligible, validateDiscountRange } from '../../services/invoices/discountRange'
import { applyPlanDiscount, calculateMonthBilling } from '../../services/api'

const PRESETS = [10, 15, 20, 25]

const monthLabel = (year, month) => format(new Date(year, month, 1), 'MMM yyyy', { locale: es })
const ymFromOrdinal = (ord) => ({ year: Math.floor(ord / 12), month: ord % 12 })

// Undiscounted prorated attendance gross. Live billing already reflects any existing
// discount on the month, so we reverse it to show the true "before" amount.
const baseAttendance = (billing) => {
  const att = billing?.attendanceChargeableGross || 0
  const cur = billing?.discountPercent || 0
  return cur > 0 ? Math.round(att / (1 - cur / 100)) : att
}

export default function ApplyDiscountModal({ isOpen, onClose, client, invoices, onRefresh }) {
  const eligible = useMemo(() => eligibleMonths(invoices), [invoices])

  // Timeline spans first→last eligible month, surfacing any blocked (paid/invoiced)
  // months in between so the "corrido" rule is visible, not just validated.
  const timeline = useMemo(() => {
    if (eligible.length === 0) return []
    const min = ordinalOf(eligible[0].year, eligible[0].month)
    const max = ordinalOf(eligible[eligible.length - 1].year, eligible[eligible.length - 1].month)
    return (invoices || [])
      .filter(inv => {
        const o = ordinalOf(inv.year, inv.month)
        return o >= min && o <= max
      })
      .slice()
      .sort((a, b) => ordinalOf(a.year, a.month) - ordinalOf(b.year, b.month))
  }, [invoices, eligible])

  const [anchor, setAnchor] = useState(null)
  const [head, setHead] = useState(null)
  const [percent, setPercent] = useState(15)
  const [amounts, setAmounts] = useState({}) // ordinal → base attendance gross
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Reset + fetch live amounts on open
  useEffect(() => {
    if (!isOpen) return
    setAnchor(null)
    setHead(null)
    setPercent(15)
    setError(null)
    if (eligible.length === 0) return
    setLoading(true)
    Promise.all(eligible.map(m =>
      calculateMonthBilling(client.id, m.year, m.month)
        .then(b => [ordinalOf(m.year, m.month), baseAttendance(b)])
        .catch(() => [ordinalOf(m.year, m.month), 0])
    ))
      .then(entries => setAmounts(Object.fromEntries(entries)))
      .finally(() => setLoading(false))
  }, [isOpen, eligible, client])

  const range = useMemo(() => {
    if (anchor === null) return null
    const a = anchor
    const b = head === null ? anchor : head
    return { start: Math.min(a, b), end: Math.max(a, b) }
  }, [anchor, head])

  const handleClick = (ord) => {
    if (anchor === null) { setAnchor(ord); setHead(null); return }
    if (head === null) {
      if (ord === anchor) { setAnchor(null); return } // deselect single
      setHead(ord); return
    }
    setAnchor(ord); setHead(null) // start a new selection
  }

  const validation = useMemo(() => {
    if (!range) return { valid: false, error: null }
    const s = ymFromOrdinal(range.start)
    const e = ymFromOrdinal(range.end)
    return validateDiscountRange(invoices, {
      startYear: s.year, startMonth: s.month,
      endYear: e.year, endMonth: e.month,
      percent: Number(percent)
    })
  }, [invoices, range, percent])

  const pct = Number(percent)
  const summary = useMemo(() => {
    if (!validation.valid) return null
    let before = 0
    const rows = validation.months.map(inv => {
      const b = amounts[ordinalOf(inv.year, inv.month)] || 0
      const after = Math.round(b * (1 - pct / 100))
      before += b
      return { key: `${inv.year}-${inv.month}`, label: monthLabel(inv.year, inv.month), before: b, after }
    })
    const after = Math.round(before * (1 - pct / 100))
    return { rows, before, after, savings: before - after }
  }, [validation, amounts, pct])

  const handleApply = async () => {
    if (!validation.valid) return
    const s = ymFromOrdinal(range.start)
    const e = ymFromOrdinal(range.end)
    setSubmitting(true)
    setError(null)
    try {
      await applyPlanDiscount(client.id, s.year, s.month, e.year, e.month, pct)
      await onRefresh()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const rangeCount = range ? range.end - range.start + 1 : 0

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Aplicar descuento" size="lg">
      {eligible.length < 2 ? (
        <div className="py-10 text-center">
          <div className="mx-auto mb-3 w-11 h-11 rounded-full bg-violet-50 flex items-center justify-center">
            <Percentage className="w-5 h-5 text-violet-500" />
          </div>
          <p className="text-sm text-gray-500">
            Se necesitan al menos 2 meses sin cobrar ni facturar para aplicar un descuento.
          </p>
          <div className="mt-5 flex justify-center">
            <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-gray-500">
            El descuento aplica solo sobre el <span className="font-medium text-gray-700">plan de asistencia</span>. El transporte no se ve afectado.
          </p>

          {/* Step 1 — month timeline */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Meses</span>
              <span className="text-xs text-gray-400">Tocá el inicio y el fin del rango</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {timeline.map(inv => {
                const ord = ordinalOf(inv.year, inv.month)
                const elig = isEligible(inv)
                const inRange = range && ord >= range.start && ord <= range.end
                const isEndpoint = range && (ord === range.start || ord === range.end)
                const amount = amounts[ord]

                let cls = 'bg-white border-gray-200 text-gray-700 hover:border-violet-400 hover:bg-violet-50'
                if (!elig) cls = 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
                else if (isEndpoint) cls = 'bg-violet-600 border-violet-600 text-white shadow-sm'
                else if (inRange) cls = 'bg-violet-100 border-violet-200 text-violet-800'

                return (
                  <button
                    key={ord}
                    type="button"
                    disabled={!elig}
                    onClick={() => handleClick(ord)}
                    className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-all ${cls}`}
                  >
                    <span className="text-xs font-semibold capitalize leading-tight">{monthLabel(inv.year, inv.month)}</span>
                    <span className={`text-[11px] leading-tight ${isEndpoint ? 'text-violet-100' : elig ? 'text-gray-400' : 'text-gray-300'}`}>
                      {!elig
                        ? (inv.invoiceStatus === 'invoiced' ? 'Facturado' : 'Cobrado')
                        : loading ? '···' : formatCurrency(amount || 0)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Step 2 — percentage */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Porcentaje</span>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {PRESETS.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPercent(p)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    pct === p
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-violet-400'
                  }`}
                >
                  {p}%
                </button>
              ))}
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={percent}
                  onChange={e => setPercent(e.target.value)}
                  className="w-20 pl-3 pr-6 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
            </div>
          </div>

          {validation.error && (
            <div className="p-2.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg">
              {validation.error}
            </div>
          )}

          {/* Summary */}
          {summary && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-violet-900">
                  {rangeCount} {rangeCount === 1 ? 'mes' : 'meses'} · {pct}% dto
                </span>
                <span className="text-sm font-semibold text-violet-700">
                  Ahorro {formatCurrency(summary.savings)}
                </span>
              </div>
              <div className="space-y-1">
                {summary.rows.map(r => (
                  <div key={r.key} className="flex items-center justify-between text-xs">
                    <span className="capitalize text-gray-500">{r.label}</span>
                    <span className="text-gray-400">
                      <span className="line-through mr-2">{formatCurrency(r.before)}</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(r.after)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-violet-200 flex items-center justify-between text-sm">
                <span className="text-gray-500">Total asistencia</span>
                <span>
                  <span className="line-through mr-2 text-gray-400">{formatCurrency(summary.before)}</span>
                  <span className="font-bold text-violet-900">{formatCurrency(summary.after)}</span>
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="p-2.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Button>
            <Button onClick={handleApply} loading={submitting} disabled={!validation.valid}>
              {validation.valid ? `Aplicar ${pct}% a ${rangeCount} meses` : 'Aplicar descuento'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
