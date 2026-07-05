import { useState, useEffect, useRef, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowLeft, NavArrowRight } from 'iconoir-react'
import PlaceholderCard from './PlaceholderCard'
import FinanceSection from './sections/FinanceSection'
import AttendanceSection from './sections/AttendanceSection'
import CommercialSection from './sections/CommercialSection'
import { useAuth } from '../../context/AuthContext'
import { TODAY, WINDOW_START, inWindow } from './monthWindow'

// Navegación de mes en el header: chevrons (secuencial) + chip clickeable que abre
// un selector de mes/año. Solo mueve el mes seleccionado dentro de la ventana de datos,
// compartido por todas las pestañas del dashboard.
function MonthNavigator({ selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(selected.year)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = new Date(selected.year, selected.month, 1)
  const atMin = current <= WINDOW_START
  const atMax = current >= TODAY
  const shift = (delta) => {
    const d = new Date(selected.year, selected.month + delta, 1)
    const clamped = d < WINDOW_START ? WINDOW_START : d > TODAY ? TODAY : d
    onChange({ year: clamped.getFullYear(), month: clamped.getMonth() })
  }

  const toggle = () => { setViewYear(selected.year); setOpen(o => !o) }
  const pick = (m) => {
    if (!inWindow(viewYear, m)) return
    onChange({ year: viewYear, month: m })
    setOpen(false)
  }

  const minYear = WINDOW_START.getFullYear()
  const maxYear = TODAY.getFullYear()
  const label = format(current, 'MMMM yyyy', { locale: es })
  const chevronCls = 'flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent'

  return (
    <div className="flex items-center gap-1" ref={ref}>
      <button type="button" onClick={() => shift(-1)} disabled={atMin} title="Mes anterior" className={chevronCls}>
        <NavArrowLeft className="w-5 h-5" />
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={toggle}
          title="Elegir mes"
          className="flex items-center rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-700 capitalize transition-colors hover:bg-gray-100"
        >
          {label}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 z-20 w-64 rounded-xl border border-gray-100 bg-white p-3 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setViewYear(y => y - 1)} disabled={viewYear <= minYear} className={chevronCls}>
                <NavArrowLeft className="w-5 h-5" />
              </button>
              <span className="text-sm font-bold text-gray-800 tabular-nums">{viewYear}</span>
              <button type="button" onClick={() => setViewYear(y => y + 1)} disabled={viewYear >= maxYear} className={chevronCls}>
                <NavArrowRight className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, m) => {
                const enabled = inWindow(viewYear, m)
                const isSel = selected.year === viewYear && selected.month === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pick(m)}
                    disabled={!enabled}
                    className={`px-2 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                      isSel ? 'bg-indigo-600 text-white'
                        : enabled ? 'text-gray-700 hover:bg-gray-100'
                        : 'text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    {format(new Date(viewYear, m, 1), 'LLL', { locale: es })}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <button type="button" onClick={() => shift(1)} disabled={atMax} title="Mes siguiente" className={chevronCls}>
        <NavArrowRight className="w-5 h-5" />
      </button>
    </div>
  )
}

// Pestañas de secciones del dashboard, cada una gated por su feature.
const SECTIONS = [
  { id: 'finanzas', label: 'Finanzas', feature: 'dashboard_financials', Component: FinanceSection },
  { id: 'asistencia', label: 'Asistencia', feature: 'statistics', Component: AttendanceSection },
  { id: 'comercial', label: 'Comercial', feature: 'dashboard_financials', Component: CommercialSection }
]

export default function Dashboard() {
  const { hasAccess } = useAuth()

  const available = useMemo(() => SECTIONS.filter(s => hasAccess(s.feature)), [hasAccess])
  const [tab, setTab] = useState(() => available[0]?.id)
  const [selected, setSelected] = useState(() => ({ year: TODAY.getFullYear(), month: TODAY.getMonth() }))

  // Si el rol no habilita ninguna sección analítica, caemos al resumen operativo.
  if (available.length === 0) {
    return (
      <div className="-mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8 min-h-full bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PlaceholderCard title="Turnos de hoy" hint="Resumen de asistencia del día." minHeight={130} />
          <PlaceholderCard title="Transporte de hoy" hint="Resumen de viajes y autos del día." minHeight={130} />
        </div>
      </div>
    )
  }

  const activeTab = available.some(s => s.id === tab) ? tab : available[0].id
  const ActiveComponent = SECTIONS.find(s => s.id === activeTab).Component

  return (
    <div className="-mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8 min-h-full bg-gray-50">
      {/* pestañas de sección + navegador de mes en una sola fila (sin título redundante) */}
      <div className="flex items-end justify-between gap-4 border-b border-gray-200 mb-6">
        <div className="flex gap-1 overflow-x-auto">
          {available.map(s => {
            const active = s.id === activeTab
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setTab(s.id)}
                className={`relative px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                  active ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {s.label}
                {active && <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded bg-indigo-600" />}
              </button>
            )
          })}
        </div>
        <div className="pb-1.5 shrink-0">
          <MonthNavigator selected={selected} onChange={setSelected} />
        </div>
      </div>

      <ActiveComponent selected={selected} onSelectMonth={setSelected} />
    </div>
  )
}
