// Segmented control to switch the breakdown dimension of a metric.
// Pill group matching the calm dashboard aesthetic: white active pill on a
// gray track. Purely presentational — the caller owns the selected value.
export default function MetricTabs({ options, value, onChange }) {
  return (
    <div className="inline-flex bg-gray-100 rounded-lg p-[3px]">
      {options.map(o => {
        const active = String(value) === String(o.value)
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={`text-[12.5px] font-semibold px-3 py-1 rounded-md transition-colors ${
              active ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
