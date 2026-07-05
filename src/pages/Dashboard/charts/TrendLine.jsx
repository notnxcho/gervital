// Single-series line trend with a light area fill. Indigo brand accent, with
// faint gridlines + left axis labels and thinned x labels below. The last point
// is emphasized. Pure presentational SVG (viewBox, responsive width).

// Smooth cubic path through points {x,y} (Catmull-Rom → bezier).
function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  const d = [`M ${pts[0].x} ${pts[0].y}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x} ${p2.y}`)
  }
  return d.join(' ')
}

const ACCENT = '#4f46e5'

export default function TrendLine({ points, labels, min, max, suffix = '', format = v => v }) {
  const values = points || []
  const n = values.length

  const W = 300
  const H = 140
  const padL = 34
  const padR = 8
  const padT = 8
  const padB = 20
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const lo = min != null ? min : Math.min(...(n ? values : [0]))
  const hiRaw = max != null ? max : Math.max(...(n ? values : [1]))
  const hi = hiRaw === lo ? lo + 1 : hiRaw
  const span = hi - lo

  const px = i => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2)
  const py = v => padT + plotH - ((v - lo) / span) * plotH

  const pts = values.map((v, i) => ({ x: px(i), y: py(v) }))
  const lineD = smoothPath(pts)
  const areaD = pts.length
    ? `${lineD} L ${pts[pts.length - 1].x} ${padT + plotH} L ${pts[0].x} ${padT + plotH} Z`
    : ''

  const ticks = [hi, lo + span * 0.5, lo]

  // Thin x labels: keep every other + always the last, to avoid crowding.
  const showLabel = i => i === n - 1 || i % 2 === 0

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {ticks.map((t, i) => {
        const yy = py(t)
        return (
          <g key={i}>
            <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#f3f4f6" strokeWidth="1" />
            <text x={padL - 5} y={yy + 3} textAnchor="end" className="tabular-nums" fontSize="9" fill="#d1d5db">
              {format(t)}{suffix}
            </text>
          </g>
        )
      })}

      {areaD && <path d={areaD} fill={ACCENT} fillOpacity="0.06" stroke="none" />}
      {lineD && <path d={lineD} fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}

      {pts.length > 0 && (
        <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3.5" fill={ACCENT} />
      )}

      {(labels || []).map((lbl, i) =>
        showLabel(i) ? (
          <text key={i} x={px(i)} y={H - 5} textAnchor="middle" fontSize="9" fill="#9ca3af">
            {lbl}
          </text>
        ) : null
      )}
    </svg>
  )
}
