// Pipeline stages, in board order. label + color dot per stage.
export const STAGES = [
  { key: 'new', label: 'Nueva baja', color: '#e11d48' },
  { key: 'contacting', label: 'En seguimiento', color: '#d97706' },
  { key: 'negotiating', label: 'En negociación', color: '#2563eb' },
  { key: 'recovered', label: 'Recuperado', color: '#059669' },
  { key: 'lost', label: 'Perdido', color: '#94a3b8' }
]

export const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.key, s.label]))

// Deactivation reasons → Spanish label + badge color.
export const REASON_CONFIG = {
  death: { label: 'Fallecimiento', color: '#64748b' },
  transfer_to_other_center: { label: 'Cambio de institución', color: '#7c3aed' },
  relocation: { label: 'Mudanza', color: '#0891b2' },
  health_decline: { label: 'Deterioro / internación', color: '#dc2626' },
  family_decision: { label: 'Decisión familiar', color: '#d97706' },
  financial: { label: 'Razones económicas', color: '#2563eb' },
  service_dissatisfaction: { label: 'Insatisfacción', color: '#e11d48' },
  other: { label: 'Otro', color: '#94a3b8' }
}

// Cognitive tier → color hex.
export const TIER_HEX = {
  A: '#16a34a',
  B: '#2563eb',
  C: '#d97706',
  D: '#dc2626'
}

export const SCHEDULE_LABEL = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  full_day: 'Día completo'
}

// "3× · Mañana · Tier B" — handles null plan fields gracefully.
export function planSubtitle({ frequency, schedule, cognitiveLevel }) {
  const parts = []
  if (frequency) parts.push(`${frequency}×`)
  if (schedule && SCHEDULE_LABEL[schedule]) parts.push(SCHEDULE_LABEL[schedule])
  if (cognitiveLevel) parts.push(`Tier ${cognitiveLevel}`)
  return parts.join(' · ')
}
