export const SHIFTS = [
  { id: 'morning_arrive', label: 'Llegada mañana', time: '9:00', type: 'arrive', period: 'morning' },
  { id: 'morning_leave', label: 'Salida mañana', time: '14:00', type: 'leave', period: 'morning' },
  { id: 'afternoon_arrive', label: 'Llegada tarde', time: '15:00', type: 'arrive', period: 'afternoon' },
  { id: 'afternoon_leave', label: 'Salida tarde', time: '19:00', type: 'leave', period: 'afternoon' }
]

export const CAR_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308',
  '#8b5cf6', '#f97316', '#ec4899', '#06b6d4'
]

export const UNASSIGNED_COLOR = '#9ca3af'

export const DEFAULT_FLEET = [
  { name: 'Combi Grande', seatCount: 7 },
  { name: 'Auto 2', seatCount: 4 },
  { name: 'Auto 3', seatCount: 4 },
  { name: 'Auto 4', seatCount: 4 }
]

export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export const DAY_LABELS_ES = {
  monday: 'lunes', tuesday: 'martes', wednesday: 'miércoles',
  thursday: 'jueves', friday: 'viernes'
}

export function getShiftsForSchedule(schedule) {
  switch (schedule) {
    case 'morning': return ['morning_arrive', 'morning_leave']
    case 'afternoon': return ['afternoon_arrive', 'afternoon_leave']
    case 'full_day': return ['morning_arrive', 'afternoon_leave']
    default: return []
  }
}

export const TRANSPORT_TRIP_PRICES = {
  1: { morning: 3500, afternoon: 3500, full_day: 3500 },
  2: { morning: 3200, afternoon: 3200, full_day: 3200 },
  3: { morning: 2800, afternoon: 2800, full_day: 2800 },
  4: { morning: 2500, afternoon: 2500, full_day: 2500 }
}
