import { useState, useMemo, useEffect } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input, { Select } from '../../components/ui/Input'
import { formatCurrency } from '../../utils/format'
import { eligibleMonths, validateDiscountRange } from '../../services/invoices/discountRange'
import { applyPlanDiscount } from '../../services/api'

const monthLabel = (year, month) =>
  format(new Date(year, month, 1), 'MMMM yyyy', { locale: es })

const keyOf = (inv) => `${inv.year}-${inv.month}`

export default function ApplyDiscountModal({ isOpen, onClose, client, invoices, onRefresh }) {
  const months = useMemo(() => eligibleMonths(invoices), [invoices])
  const [startKey, setStartKey] = useState('')
  const [endKey, setEndKey] = useState('')
  const [percent, setPercent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen) return
    setStartKey(months[0] ? keyOf(months[0]) : '')
    setEndKey(months[1] ? keyOf(months[1]) : (months[0] ? keyOf(months[0]) : ''))
    setPercent('')
    setError(null)
  }, [isOpen, months])

  const start = months.find(m => keyOf(m) === startKey)
  const end = months.find(m => keyOf(m) === endKey)

  const validation = useMemo(() => {
    if (!start || !end) return { valid: false, error: null }
    return validateDiscountRange(invoices, {
      startYear: start.year, startMonth: start.month,
      endYear: end.year, endMonth: end.month,
      percent: Number(percent)
    })
  }, [invoices, start, end, percent])

  const pct = Number(percent)
  const preview = validation.valid
    ? validation.months.map(inv => ({
        key: keyOf(inv),
        label: monthLabel(inv.year, inv.month),
        before: inv.attendanceChargeableGross || 0,
        after: Math.round((inv.attendanceChargeableGross || 0) * (1 - pct / 100))
      }))
    : []

  const monthOptions = months.map(m => ({ value: keyOf(m), label: monthLabel(m.year, m.month) }))

  const handleApply = async () => {
    if (!validation.valid) return
    setSubmitting(true)
    setError(null)
    try {
      await applyPlanDiscount(client.id, start.year, start.month, end.year, end.month, pct)
      await onRefresh()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (months.length < 2) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Aplicar descuento" size="md">
        <p className="text-sm text-gray-500 py-6 text-center">
          Se necesitan al menos 2 meses sin cobrar ni facturar para aplicar un descuento.
        </p>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Aplicar descuento" size="md">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          El descuento aplica solo sobre el plan de asistencia. El transporte no se ve afectado.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Mes de inicio"
            value={startKey}
            onChange={e => setStartKey(e.target.value)}
            options={monthOptions}
          />
          <Select
            label="Mes de fin"
            value={endKey}
            onChange={e => setEndKey(e.target.value)}
            options={monthOptions}
          />
        </div>

        <Input
          label="Porcentaje de descuento"
          type="number"
          min="1"
          max="100"
          value={percent}
          onChange={e => setPercent(e.target.value)}
          placeholder="Ej: 15"
        />

        {validation.error && (
          <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">{validation.error}</div>
        )}

        {preview.length > 0 && (
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-100">
            {preview.map(p => (
              <div key={p.key} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="capitalize text-gray-700">{p.label}</span>
                <span className="text-gray-500">
                  <span className="line-through mr-2">{formatCurrency(p.before)}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(p.after)}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleApply} loading={submitting} disabled={!validation.valid}>Aplicar descuento</Button>
        </div>
      </div>
    </Modal>
  )
}
