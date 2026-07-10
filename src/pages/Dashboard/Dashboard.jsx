import { useState, useMemo } from 'react'
import PlaceholderCard from './PlaceholderCard'
import FinanceSection from './sections/FinanceSection'
import AttendanceSection from './sections/AttendanceSection'
import CommercialSection from './sections/CommercialSection'
import PromotionsSection from './sections/PromotionsSection'
import { useAuth } from '../../context/AuthContext'
import MonthNavigator from '../../components/ui/MonthNavigator'
import { TODAY, WINDOW_START } from './monthWindow'

// Pestañas de secciones del dashboard, cada una gated por su feature.
const SECTIONS = [
  { id: 'finanzas', label: 'Finanzas', feature: 'dashboard_financials', Component: FinanceSection },
  { id: 'asistencia', label: 'Asistencia', feature: 'statistics', Component: AttendanceSection },
  { id: 'comercial', label: 'Comercial', feature: 'dashboard_financials', Component: CommercialSection },
  { id: 'promociones', label: 'Promociones', feature: 'promotions', Component: PromotionsSection }
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
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden">
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
                {active && <span className="absolute left-3 right-3 bottom-0 h-0.5 rounded bg-indigo-600" />}
              </button>
            )
          })}
        </div>
        <div className="pb-1.5 shrink-0">
          <MonthNavigator selected={selected} onChange={setSelected} minDate={WINDOW_START} maxDate={TODAY} />
        </div>
      </div>

      <ActiveComponent selected={selected} onSelectMonth={setSelected} />
    </div>
  )
}
