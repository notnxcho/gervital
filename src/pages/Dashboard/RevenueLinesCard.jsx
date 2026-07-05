import Card from '../../components/ui/Card'
import { Community, Bus } from 'iconoir-react'
import { formatCurrency } from '../../utils/format'

// Panel de ingreso por línea de negocio: Asistencia vs Transporte (tracks de facturación
// separados), lado a lado. `attendance` y `transport` vienen de lineRevenueKpis().
function Line({ icon: Icon, title, data }) {
  if (!data) return null
  const { revenue, clients, share, arpu, collectionRate } = data
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600">
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-[13px] font-semibold text-gray-700">{title}</span>
        <span className="ml-auto text-[11px] font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 tabular-nums">
          {share.toFixed(0)}% del ingreso
        </span>
      </div>
      <p className="text-[22px] leading-tight font-semibold tracking-tight tabular-nums text-emerald-700">{formatCurrency(revenue)}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <p className="text-[16px] font-semibold text-gray-900 tabular-nums leading-none">{clients}</p>
          <p className="text-[11px] text-gray-400 mt-1">clientes</p>
        </div>
        <div>
          <p className="text-[16px] font-semibold text-gray-900 tabular-nums leading-none">{formatCurrency(arpu)}</p>
          <p className="text-[11px] text-gray-400 mt-1">por cliente</p>
        </div>
        <div>
          <p className={`text-[16px] font-semibold tabular-nums leading-none ${collectionRate >= 80 ? 'text-emerald-700' : collectionRate >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{collectionRate.toFixed(0)}%</p>
          <p className="text-[11px] text-gray-400 mt-1">cobrado</p>
        </div>
      </div>
    </div>
  )
}

export default function RevenueLinesCard({ attendance, transport, arr, monthLabel, withIva }) {
  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-5 pt-5 pb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-gray-900">Ingreso por línea de negocio</h3>
        <span className="text-xs text-gray-400 capitalize shrink-0">{monthLabel} · {withIva ? 'con IVA' : 'neto'} · previsto</span>
      </div>
      <div className="px-5 pb-4 flex flex-col sm:flex-row gap-6 sm:gap-8">
        <Line icon={Community} title="Asistencia" data={attendance} />
        <div className="hidden sm:block w-px bg-gray-100 self-stretch" />
        <Line icon={Bus} title="Transporte" data={transport} />
      </div>
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-[12px] text-gray-500">Ingreso anualizado (ARR · neto)</span>
        <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{formatCurrency(arr || 0)}</span>
      </div>
    </Card>
  )
}
