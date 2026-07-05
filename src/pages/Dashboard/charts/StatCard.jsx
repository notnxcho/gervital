import Card from '../../../components/ui/Card'

// Reusable KPI card matching KpiRow's `Kpi`: label + optional delta pill, big
// tabular value, muted sub. `value` arrives already formatted.
export default function StatCard({ label, value, valueClass = 'text-gray-900', sub, pill }) {
  return (
    <Card className="rounded-2xl border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-gray-500 truncate">{label}</p>
          {pill}
        </div>
        <p className={`text-[22px] leading-tight font-semibold tracking-tight tabular-nums mt-1.5 truncate ${valueClass}`}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-gray-400 mt-1">{sub}</p>}
      </div>
    </Card>
  )
}
