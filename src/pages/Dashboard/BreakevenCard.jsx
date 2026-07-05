import Card from '../../components/ui/Card'
import { formatCurrency } from '../../utils/format'

// Costo por cliente + punto de equilibrio para el mes seleccionado.
// `analysis` viene de breakevenAnalysis() (financeSeries.js).
export default function BreakevenCard({ analysis, monthLabel }) {
  if (!analysis || analysis.activeClients === 0) {
    return (
      <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          Sin clientes activos este mes para calcular el costo por cliente.
        </div>
      </Card>
    )
  }

  const { activeClients, costPerClient, revenuePerClient, marginPerClient, breakevenClients, totalCosts } = analysis
  const noCosts = totalCosts === 0
  const be = breakevenClients == null ? null : Math.ceil(breakevenClients)
  const above = be != null && activeClients >= be
  const diff = be == null ? 0 : Math.abs(activeClients - be)

  // barra: posición de los clientes actuales vs umbral de equilibrio
  const scaleMax = be == null ? activeClients : Math.max(activeClients, be) * 1.15 || 1
  const clientsPct = Math.min(100, (activeClients / scaleMax) * 100)
  const bePct = be == null ? 0 : Math.min(100, (be / scaleMax) * 100)

  const Stat = ({ label, value, valueClass = 'text-gray-900' }) => (
    <div>
      <p className="text-[12.5px] font-medium text-gray-500">{label}</p>
      <p className={`text-[19px] leading-tight font-semibold tracking-tight tabular-nums mt-1 ${valueClass}`}>{value}</p>
    </div>
  )

  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900">Costo por cliente y punto de equilibrio</h3>
          <p className="text-xs text-gray-400 mt-0.5 capitalize">{monthLabel} · sobre ingreso neto previsto</p>
        </div>
        <span className="text-[12.5px] text-gray-500 tabular-nums shrink-0">{activeClients} clientes activos</span>
      </div>

      <div className="px-5 pb-2 grid grid-cols-3 gap-4">
        <Stat label="Costo por cliente" value={formatCurrency(costPerClient)} />
        <Stat label="Ingreso por cliente" value={formatCurrency(revenuePerClient)} />
        <Stat label="Margen por cliente" value={formatCurrency(marginPerClient)} valueClass={marginPerClient < 0 ? 'text-rose-600' : 'text-gray-900'} />
      </div>

      <div className="px-5 pb-5 pt-4">
        {noCosts ? (
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-[12.5px] text-gray-500">
            No hay costos cargados (sueldos ni gastos) para este mes. Cargalos en el módulo Costos para calcular el punto de equilibrio.
          </div>
        ) : be == null ? (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-[12.5px] text-amber-800">
            Con la estructura de costos actual no se alcanza el punto de equilibrio: la contribución por cliente no cubre el costo variable. Revisá precios o costos.
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[13px] font-medium text-gray-600">Punto de equilibrio</span>
              <span className="text-[13px] font-semibold text-gray-900 tabular-nums">
                {be} clientes
              </span>
            </div>
            {/* barra: fill = clientes actuales, marca = umbral de equilibrio */}
            <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden">
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${above ? 'bg-emerald-500' : 'bg-rose-400'}`}
                style={{ width: `${clientsPct}%` }}
              />
            </div>
            <div className="relative h-4">
              <span className="absolute -top-1 w-0.5 h-4 bg-gray-800" style={{ left: `calc(${bePct}% - 1px)` }} />
              <span
                className="absolute top-2 text-[10px] font-semibold text-gray-500 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${bePct}%` }}
              >
                equilibrio
              </span>
            </div>
            <p className={`mt-3 text-[12.5px] font-medium ${above ? 'text-emerald-700' : 'text-rose-600'}`}>
              {above
                ? `${diff} ${diff === 1 ? 'cliente' : 'clientes'} por encima del equilibrio`
                : `Faltan ${diff} ${diff === 1 ? 'cliente' : 'clientes'} para cubrir los costos`}
            </p>
          </>
        )}
      </div>
    </Card>
  )
}
