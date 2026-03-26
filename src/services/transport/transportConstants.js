// Club location: Alejo Rosell y Rius 1663 esq 4 de Julio, Montevideo
export const CLUB_LOCATION = { lat: -34.8969, lng: -56.1470 }

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

export const DISTANCE_RANGES = [
  { id: 'under_1km', label: 'Menos de 1 km' },
  { id: '1_to_5km', label: '1 a 5 km' },
  { id: '5_to_10km', label: '5 a 10 km' },
  { id: 'over_10km', label: 'Más de 10 km' }
]

// Per-trip prices: frequency → schedule → distanceRange → price
export const TRANSPORT_TRIP_PRICES = {
  1: {
    morning:   { under_1km: 2500, '1_to_5km': 3000, '5_to_10km': 3500, over_10km: 4500 },
    afternoon: { under_1km: 2500, '1_to_5km': 3000, '5_to_10km': 3500, over_10km: 4500 },
    full_day:  { under_1km: 2500, '1_to_5km': 3000, '5_to_10km': 3500, over_10km: 4500 }
  },
  2: {
    morning:   { under_1km: 2200, '1_to_5km': 2700, '5_to_10km': 3200, over_10km: 4000 },
    afternoon: { under_1km: 2200, '1_to_5km': 2700, '5_to_10km': 3200, over_10km: 4000 },
    full_day:  { under_1km: 2200, '1_to_5km': 2700, '5_to_10km': 3200, over_10km: 4000 }
  },
  3: {
    morning:   { under_1km: 1900, '1_to_5km': 2400, '5_to_10km': 2800, over_10km: 3500 },
    afternoon: { under_1km: 1900, '1_to_5km': 2400, '5_to_10km': 2800, over_10km: 3500 },
    full_day:  { under_1km: 1900, '1_to_5km': 2400, '5_to_10km': 2800, over_10km: 3500 }
  },
  4: {
    morning:   { under_1km: 1600, '1_to_5km': 2100, '5_to_10km': 2500, over_10km: 3000 },
    afternoon: { under_1km: 1600, '1_to_5km': 2100, '5_to_10km': 2500, over_10km: 3000 },
    full_day:  { under_1km: 1600, '1_to_5km': 2100, '5_to_10km': 3500, over_10km: 3000 }
  }
}
