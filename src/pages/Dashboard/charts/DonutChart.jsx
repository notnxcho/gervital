// Composition donut. Arcs are drawn as stroke-dasharray segments on stacked
// circles, rotated -90deg so the first slice starts at 12 o'clock. Center shows
// the total; the caller renders the legend separately.
export default function DonutChart({ rows, centerLabel = '' }) {
  const data = (rows || []).filter(r => r.value > 0)
  const total = data.reduce((s, r) => s + r.value, 0)

  const size = 170
  const stroke = 20
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r

  let offset = 0
  const segments = data.map((row, i) => {
    const frac = total > 0 ? row.value / total : 0
    const dash = frac * circumference
    const seg = { color: row.color, dash, gap: circumference - dash, rotation: offset }
    offset += frac * 360
    return { ...seg, key: `${row.label}-${i}` }
  })

  return (
    <div className="relative inline-block">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto" style={{ maxWidth: size }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        {segments.map(s => (
          <circle
            key={s.key}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${s.dash} ${s.gap}`}
            transform={`rotate(${s.rotation - 90} ${cx} ${cy})`}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[26px] font-bold text-gray-900 tabular-nums leading-none">{total}</span>
        {centerLabel && <span className="text-[12px] text-gray-400 mt-1">{centerLabel}</span>}
      </div>
    </div>
  )
}
