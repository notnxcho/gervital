// Pipeline stages, in board order. label + color dot per stage.
export const STAGES = [
  { key: 'new', label: 'Nueva baja', color: '#e11d48' },
  { key: 'contacting', label: 'En seguimiento', color: '#d97706' },
  { key: 'negotiating', label: 'En negociación', color: '#2563eb' },
  { key: 'temporary_pause', label: 'Pausa temporal', color: '#7c3aed' },
  { key: 'lost', label: 'Perdido', color: '#94a3b8' }
]

export const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.key, s.label]))

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
