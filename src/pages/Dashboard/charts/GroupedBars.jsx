// Two bars per category (e.g. altas vs bajas). Faint gridlines + numeric y axis
// + category labels below. The caller renders the legend separately.
export default function GroupedBars({ data, aLabel = '', bLabel = '', aColor = '#4f46e5', bColor = '#e11d48' }) {
  const rows = data || []
  const n = rows.length

  const W = 320
  const H = 160
  const padL = 30
  const padR = 8
  const padT = 8
  const padB = 22
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const max = rows.reduce((m, r) => Math.max(m, r.a, r.b), 0) || 1
  const ticks = [max, max * 0.5, 0]

  const groupW = n > 0 ? plotW / n : plotW
  const barW = Math.min(14, (groupW - 8) / 2)
  const gap = 3

  const yOf = v => padT + plotH - (v / max) * plotH

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" aria-label={`${aLabel} vs ${bLabel}`}>
      {ticks.map((t, i) => {
        const yy = yOf(t)
        return (
          <g key={i}>
            <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#f3f4f6" strokeWidth="1" />
            <text x={padL - 5} y={yy + 3} textAnchor="end" className="tabular-nums" fontSize="9" fill="#d1d5db">
              {Math.round(t)}
            </text>
          </g>
        )
      })}

      {rows.map((row, i) => {
        const cx = padL + groupW * i + groupW / 2
        const aX = cx - barW - gap / 2
        const bX = cx + gap / 2
        const aH = (row.a / max) * plotH
        const bH = (row.b / max) * plotH
        return (
          <g key={`${row.label}-${i}`}>
            <rect x={aX} y={yOf(row.a)} width={barW} height={aH} rx="2" fill={aColor} />
            <rect x={bX} y={yOf(row.b)} width={barW} height={bH} rx="2" fill={bColor} />
            <text x={cx} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">
              {row.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
