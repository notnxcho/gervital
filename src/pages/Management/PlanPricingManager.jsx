import { useState, useEffect, useMemo } from 'react'
import { Edit } from 'iconoir-react'
import {
  getPlanPricing, getPlanPriceSync, setPricing,
  getTransportPricing, getTransportPriceSync
} from '../../services/api'
import { DISTANCE_RANGES } from '../../services/transport/transportConstants'
import { formatCurrency } from '../../utils/format'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Select } from '../../components/ui/Input'

const FREQUENCIES = [1, 2, 3, 4, 5]
const SCHEDULES = [
  { id: 'morning', label: 'Mañana' },
  { id: 'afternoon', label: 'Tarde' },
  { id: 'full_day', label: 'Día completo' }
]

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Opciones de vigencia: mes actual + próximos 12 meses.
function buildEffectiveOptions() {
  const now = new Date()
  const opts = []
  for (let i = 0; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    opts.push({ value: `${y}-${m}`, label: `${MONTH_NAMES[m]} ${y}`, year: y, month: m })
  }
  return opts
}

// IVA por tipo: planes 22%, transporte 10% (mínimo). El neto en edición se previsualiza
// con la tasa correcta; en lectura se muestra el neto almacenado (autoritativo).
const PLAN_IVA_RATE = 1.22
const TRANSPORT_IVA_RATE = 1.10
const netFromGross = (gross, rate) => Math.round((Number(gross) || 0) / rate)

export default function PlanPricingManager() {
  const [planData, setPlanData] = useState([])
  const [transportData, setTransportData] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const effectiveOptions = useMemo(buildEffectiveOptions, [])
  const [effectiveKey, setEffectiveKey] = useState(effectiveOptions[0].value)
  // Draft de precios en edición: gross por celda. { plan: {"freq|schedule": gross}, transport: {"freq|range": gross} }
  const [draft, setDraft] = useState({ plan: {}, transport: {} })

  const now = new Date()
  const viewYear = now.getFullYear()
  const viewMonth = now.getMonth()

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [plan, transport] = await Promise.all([getPlanPricing(), getTransportPricing()])
      setPlanData(plan)
      setTransportData(transport)
    } catch (e) {
      setError(e.message || 'Error cargando precios')
    } finally {
      setLoading(false)
    }
  }

  // Precio vigente del mes actual para cada celda (lo que se muestra por defecto).
  const planPrice = (freq, schedule) => getPlanPriceSync(planData, freq, schedule, viewYear, viewMonth)
  const transportPrice = (freq, range) => getTransportPriceSync(transportData, freq, range, viewYear, viewMonth)

  const startEdit = () => {
    const plan = {}
    const transport = {}
    FREQUENCIES.forEach(f => {
      SCHEDULES.forEach(s => { plan[`${f}|${s.id}`] = String(planPrice(f, s.id).priceGross) })
      DISTANCE_RANGES.forEach(r => { transport[`${f}|${r.id}`] = String(transportPrice(f, r.id).priceGross) })
    })
    setDraft({ plan, transport })
    setError('')
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setError('') }

  const setPlanCell = (freq, schedule, value) =>
    setDraft(d => ({ ...d, plan: { ...d.plan, [`${freq}|${schedule}`]: value } }))
  const setTransportCell = (freq, range, value) =>
    setDraft(d => ({ ...d, transport: { ...d.transport, [`${freq}|${range}`]: value } }))

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const opt = effectiveOptions.find(o => o.value === effectiveKey)
      const planPrices = []
      const transportPrices = []
      FREQUENCIES.forEach(f => {
        SCHEDULES.forEach(s => {
          planPrices.push({ frequency: f, schedule: s.id, price_gross: Number(draft.plan[`${f}|${s.id}`]) || 0 })
        })
        DISTANCE_RANGES.forEach(r => {
          transportPrices.push({ frequency: f, distance_range: r.id, price_gross: Number(draft.transport[`${f}|${r.id}`]) || 0 })
        })
      })
      await setPricing(opt.year, opt.month, planPrices, transportPrices)
      await load()
      setEditing(false)
    } catch (e) {
      setError(e.message || 'No se pudieron guardar los precios')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Precios de planes y transporte</h2>
          <p className="text-sm text-gray-500 mt-1">
            {editing
              ? 'Ingresá los precios con IVA. El neto se calcula automáticamente (planes ÷1,22 · transporte ÷1,10).'
              : `Vigentes en ${MONTH_NAMES[viewMonth]} ${viewYear}.`}
          </p>
        </div>
        {editing ? (
          <div className="flex items-end gap-3">
            <Select
              label="Rige desde"
              value={effectiveKey}
              onChange={(e) => setEffectiveKey(e.target.value)}
              options={effectiveOptions.map(o => ({ value: o.value, label: o.label }))}
            />
            <Button variant="secondary" onClick={cancelEdit} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving}>Guardar</Button>
          </div>
        ) : (
          <Button onClick={startEdit}>
            <Edit className="w-5 h-5" />
            Editar
          </Button>
        )}
      </div>

      {editing && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          El precio nuevo rige desde el mes elegido en adelante. Los meses ya cobrados o facturados no cambian.
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Tabla de planes */}
      <Card className="p-4 mb-6 overflow-x-auto">
        <h3 className="font-medium text-gray-900 mb-3">Planes de asistencia</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4 font-medium">Frecuencia</th>
              {SCHEDULES.map(s => <th key={s.id} className="py-2 px-4 font-medium">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {FREQUENCIES.map(f => (
              <tr key={f} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-700">{f}× / semana</td>
                {SCHEDULES.map(s => (
                  <td key={s.id} className="py-2 px-4">
                    <PriceCell
                      editing={editing}
                      value={editing ? draft.plan[`${f}|${s.id}`] : planPrice(f, s.id).priceGross}
                      net={planPrice(f, s.id).priceNet}
                      rate={PLAN_IVA_RATE}
                      onChange={(v) => setPlanCell(f, s.id, v)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Tabla de transporte */}
      <Card className="p-4 overflow-x-auto">
        <h3 className="font-medium text-gray-900 mb-3">Transporte</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4 font-medium">Frecuencia</th>
              {DISTANCE_RANGES.map(r => <th key={r.id} className="py-2 px-4 font-medium">{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {FREQUENCIES.map(f => (
              <tr key={f} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-700">{f}× / semana</td>
                {DISTANCE_RANGES.map(r => (
                  <td key={r.id} className="py-2 px-4">
                    <PriceCell
                      editing={editing}
                      value={editing ? draft.transport[`${f}|${r.id}`] : transportPrice(f, r.id).priceGross}
                      net={transportPrice(f, r.id).priceNet}
                      rate={TRANSPORT_IVA_RATE}
                      onChange={(v) => setTransportCell(f, r.id, v)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// Celda: en lectura muestra gross (grande) + neto almacenado (chico, gris); en edición
// input de gross con previsualización de neto usando la tasa de IVA de esa tabla.
function PriceCell({ editing, value, net, rate, onChange }) {
  if (editing) {
    return (
      <div>
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="text-xs text-gray-400 mt-1">neto {formatCurrency(netFromGross(value, rate))}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="text-gray-900">{formatCurrency(value)}</div>
      <div className="text-xs text-gray-400">neto {formatCurrency(net)}</div>
    </div>
  )
}
