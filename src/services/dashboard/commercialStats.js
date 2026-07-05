// Pure commercial / churn analytics over client arrays (shape from getClients).
// No supabase import. Pricing lookups go through getPlanPriceSync.
import { getPlanPriceSync } from '../pricing/pricingService'

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

const TIER_COLORS = {
  A: '#16a34a',
  B: '#2563eb',
  C: '#d97706',
  D: '#dc2626'
}

const CATEGORICAL_PALETTE = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#7c3aed']

const REASON_LABELS = {
  death: 'Fallecimiento',
  transfer_to_other_center: 'Cambio de institución',
  relocation: 'Mudanza',
  health_decline: 'Deterioro / internación',
  family_decision: 'Decisión familiar',
  financial: 'Razones económicas',
  service_dissatisfaction: 'Insatisfacción',
  other: 'Otro'
}

const REASON_ORDER = [
  'death',
  'transfer_to_other_center',
  'relocation',
  'health_decline',
  'family_decision',
  'financial',
  'service_dissatisfaction',
  'other'
]

const DIMENSION_CONFIG = {
  frequency: { get: c => c.plan?.frequency, labels: FREQUENCY_LABELS, order: [1, 2, 3, 4, 5] },
  schedule: { get: c => c.plan?.schedule, labels: SCHEDULE_LABELS, order: ['morning', 'afternoon', 'full_day'] },
  cognitiveLevel: { get: c => c.cognitiveLevel, labels: TIER_LABELS, order: ['A', 'B', 'C', 'D'] }
}

const isActive = c => !c.deletedAt

// 'YYYY-MM-DD' → { year, month } (0-indexed month), or null.
function parseYearMonth(dateStr) {
  if (!dateStr) return null
  const y = Number(dateStr.slice(0, 4))
  const m = Number(dateStr.slice(5, 7))
  if (!y || !m) return null
  return { year: y, month: m - 1 }
}

function isSameMonth(dateStr, year, month) {
  const ym = parseYearMonth(dateStr)
  return !!ym && ym.year === year && ym.month === month
}

// Composition of ACTIVE clients grouped by dimension.
export function baseComposition(clients, dimension) {
  const config = DIMENSION_CONFIG[dimension]
  if (!config) return []

  const counts = new Map()
  for (const c of (clients || [])) {
    if (!isActive(c)) continue
    const key = config.get(c)
    if (key == null) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const orderIndex = k => {
    const i = config.order.indexOf(k)
    return i === -1 ? config.order.length : i
  }

  const useTierColors = dimension === 'cognitiveLevel'
  return [...counts.entries()]
    .sort((a, b) => orderIndex(a[0]) - orderIndex(b[0]))
    .map(([key, value], i) => ({
      key,
      label: config.labels[key] || String(key),
      value,
      color: useTierColors
        ? (TIER_COLORS[key] || CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length])
        : CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]
    }))
}

// Gross monthly attendance MRR for a client's current plan. 0 if unknown.
export function mrrForClient(client, pricing) {
  const freq = client?.plan?.frequency
  const schedule = client?.plan?.schedule
  if (freq == null || schedule == null) return 0
  const { priceGross } = getPlanPriceSync(pricing || [], freq, schedule)
  return priceGross || 0
}

// Total gross MRR over ACTIVE clients.
export function mrrTotal(clients, pricing) {
  return (clients || [])
    .filter(isActive)
    .reduce((sum, c) => sum + mrrForClient(c, pricing), 0)
}

// Trailing window of monthly altas (startDate) / bajas (deactivationDate).
export function flowSeries(clients, monthsBack, endYear, endMonth) {
  const list = clients || []
  const out = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const total = endYear * 12 + endMonth - i
    const year = Math.floor(total / 12)
    const month = ((total % 12) + 12) % 12
    const altas = list.filter(c => isSameMonth(c.startDate, year, month)).length
    const bajas = list.filter(c => isSameMonth(c.deactivationDate, year, month)).length
    out.push({ year, month, label: MONTH_LABELS_ES[month], altas, bajas })
  }
  return out
}

// KPIs for a single (year, month).
// base-at-start-of-month = clients whose startDate is before this month and who
// were not already deactivated before this month.
export function churnKpis(clients, year, month, pricing) {
  const list = clients || []
  const monthStartTotal = year * 12 + month

  const activeCount = list.filter(isActive).length

  const altasClients = list.filter(c => isSameMonth(c.startDate, year, month))
  const bajasClients = list.filter(c => isSameMonth(c.deactivationDate, year, month))
  const altas = altasClients.length
  const bajas = bajasClients.length

  const baseAtStart = list.filter(c => {
    const start = parseYearMonth(c.startDate)
    if (!start) return false
    if (start.year * 12 + start.month >= monthStartTotal) return false // joined this month or later
    const deact = parseYearMonth(c.deactivationDate)
    if (deact && deact.year * 12 + deact.month < monthStartTotal) return false // left before this month
    return true
  }).length

  const churnRate = baseAtStart > 0 ? (bajas / baseAtStart) * 100 : 0

  const mrrGained = altasClients.reduce((sum, c) => sum + mrrForClient(c, pricing), 0)
  const mrrLost = bajasClients.reduce((sum, c) => sum + mrrForClient(c, pricing), 0)

  const avgTenureMonths = meanTenureMonths(list)

  return { activeCount, altas, bajas, churnRate, mrrGained, mrrLost, avgTenureMonths }
}

// Mean tenure in months (startDate → deactivationDate|today) over all clients ever.
function meanTenureMonths(clients, now = new Date()) {
  const withStart = (clients || []).filter(c => c.startDate)
  if (withStart.length === 0) return 0
  const nowTotal = now.getFullYear() * 12 + now.getMonth()
  let sum = 0
  for (const c of withStart) {
    const start = parseYearMonth(c.startDate)
    const end = parseYearMonth(c.deactivationDate)
    const endTotal = end ? end.year * 12 + end.month : nowTotal
    sum += Math.max(0, endTotal - (start.year * 12 + start.month))
  }
  return sum / withStart.length
}

// Deactivations grouped by reason within an inclusive (year, month) range.
export function bajasByReason(clients, fromYear, fromMonth, toYear, toMonth) {
  const fromTotal = fromYear * 12 + fromMonth
  const toTotal = toYear * 12 + toMonth

  const counts = new Map()
  for (const c of (clients || [])) {
    const deact = parseYearMonth(c.deactivationDate)
    if (!deact) continue
    const t = deact.year * 12 + deact.month
    if (t < fromTotal || t > toTotal) continue
    const reason = c.deactivationReason || 'other'
    counts.set(reason, (counts.get(reason) || 0) + 1)
  }

  const orderIndex = k => {
    const i = REASON_ORDER.indexOf(k)
    return i === -1 ? REASON_ORDER.length : i
  }

  return [...counts.entries()]
    .sort((a, b) => orderIndex(a[0]) - orderIndex(b[0]))
    .map(([reason, value]) => ({
      reason,
      label: REASON_LABELS[reason] || reason,
      value,
      color: CATEGORICAL_PALETTE[orderIndex(reason) % CATEGORICAL_PALETTE.length]
    }))
}
