// Pure attendance analytics over camelCase rows from getAttendanceStats.
// No supabase import — everything here is deterministic transformation.

const MONTH_LABELS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const FREQUENCY_LABELS = {
  1: '1× semana',
  2: '2× semana',
  3: '3× semana',
  4: '4× semana',
  5: '5× semana'
}

const SCHEDULE_LABELS = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  full_day: 'Día completo'
}

const TIER_LABELS = {
  A: 'Tier A',
  B: 'Tier B',
  C: 'Tier C',
  D: 'Tier D'
}

const DIMENSION_CONFIG = {
  frequency: { field: 'frequency', labels: FREQUENCY_LABELS, order: [1, 2, 3, 4, 5] },
  schedule: { field: 'schedule', labels: SCHEDULE_LABELS, order: ['morning', 'afternoon', 'full_day'] },
  cognitiveLevel: { field: 'cognitiveLevel', labels: TIER_LABELS, order: ['A', 'B', 'C', 'D'] }
}

// rate = (attended + recovery) / (attended + recovery + absentJustified + absentUnjustified)
// Vacation and scheduled are excluded from the denominator. 0 denom → null.
export function attendanceRate({ attended = 0, recovery = 0, absentJustified = 0, absentUnjustified = 0 }) {
  const numerator = attended + recovery
  const denominator = numerator + absentJustified + absentUnjustified
  if (denominator === 0) return null
  return numerator / denominator
}

function sumRows(rows) {
  return rows.reduce(
    (acc, r) => ({
      attended: acc.attended + (r.attended || 0),
      absentJustified: acc.absentJustified + (r.absentJustified || 0),
      absentUnjustified: acc.absentUnjustified + (r.absentUnjustified || 0),
      recovery: acc.recovery + (r.recovery || 0),
      vacation: acc.vacation + (r.vacation || 0),
      scheduled: acc.scheduled + (r.scheduled || 0)
    }),
    { attended: 0, absentJustified: 0, absentUnjustified: 0, recovery: 0, vacation: 0, scheduled: 0 }
  )
}

// KPIs summed over a single (year, month).
export function monthKpis(rows, year, month) {
  const monthRows = (rows || []).filter(r => r.year === year && r.month === month)
  const totals = sumRows(monthRows)
  return {
    attended: totals.attended,
    absentJustified: totals.absentJustified,
    absentUnjustified: totals.absentUnjustified,
    recovery: totals.recovery,
    vacation: totals.vacation,
    attendanceRate: attendanceRate(totals)
  }
}

// Per-segment breakdown for a month across a dimension.
// dimension ∈ 'frequency' | 'schedule' | 'cognitiveLevel'.
export function breakdownByDimension(rows, year, month, dimension) {
  const config = DIMENSION_CONFIG[dimension]
  if (!config) return []

  const monthRows = (rows || []).filter(r => r.year === year && r.month === month)
  const groups = new Map()
  for (const r of monthRows) {
    const key = r[config.field]
    if (key == null) continue // skip records without a matching plan segment
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const orderIndex = k => {
    const i = config.order.indexOf(k)
    return i === -1 ? config.order.length : i
  }

  return [...groups.entries()]
    .sort((a, b) => orderIndex(a[0]) - orderIndex(b[0]))
    .map(([key, segRows]) => {
      const totals = sumRows(segRows)
      return {
        key,
        label: config.labels[key] || String(key),
        rate: attendanceRate(totals),
        attended: totals.attended,
        absences: totals.absentJustified + totals.absentUnjustified
      }
    })
}

// Trailing window of monthly attendance rates ending at (endYear, endMonth) inclusive.
export function trendSeries(rows, monthsBack, endYear, endMonth) {
  const out = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const total = endYear * 12 + endMonth - i
    const year = Math.floor(total / 12)
    const month = ((total % 12) + 12) % 12
    const monthRows = (rows || []).filter(r => r.year === year && r.month === month)
    const totals = sumRows(monthRows)
    out.push({
      year,
      month,
      label: MONTH_LABELS_ES[month],
      rate: attendanceRate(totals)
    })
  }
  return out
}
