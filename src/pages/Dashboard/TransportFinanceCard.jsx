import Card from '../../components/ui/Card'
import { Bus } from 'iconoir-react'
import { formatCurrency } from '../../utils/format'

// Panel financiero del transporte (track de facturación separado de la asistencia).
// `kpis` viene de transportKpis(); `activeClients` para la penetración; `withIva` solo
// para la etiqueta neto/con IVA.
export default function TransportFinanceCard({ kpis, activeClients, monthLabel, withIva }) {
  if (!kpis) return null
  const { revenue, transportClients, share, arpu, collectionRate } = kpis
  const penetration = activeClients > 0 ? (transportClients / activeClients) * 100 : 0

  const Stat = ({ label, value, valueClass = 'text-gray-900', sub }) => (
    <div className="min-w-0">
      <p className="text-[12.5px] font-medium text-gray-500 truncate">{label}</p>
      <p className={`text-[19px] leading-tight font-semibold tracking-tight tabular-nums mt-1 truncate ${valueClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-1 truncate">{sub}</p>}
    </div>
  )

  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600">
          <Bus className="w-5 h-5" />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900">Transporte</h3>
          <p className="text-xs text-gray-400 capitalize">{monthLabel} · {withIva ? 'con IVA' : 'neto'} · previsto</p>
        </div>
      </div>
      <div className="px-5 pb-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Ingreso transporte"
          value={formatCurrency(revenue)}
          valueClass="text-emerald-700"
          sub={`${share.toFixed(0)}% del ingreso total`}
        />
        <Stat
          label="Clientes con transporte"
          value={String(transportClients)}
          sub={`${penetration.toFixed(0)}% de la base activa`}
        />
        <Stat
          label="Ingreso por cliente"
          value={formatCurrency(arpu)}
          sub="promedio con transporte"
        />
        <Stat
          label="Tasa de cobro"
          value={`${collectionRate.toFixed(0)}%`}
          valueClass={collectionRate >= 80 ? 'text-emerald-700' : collectionRate >= 50 ? 'text-amber-600' : 'text-rose-600'}
          sub="cobrado / previsto"
        />
      </div>
    </Card>
  )
}
