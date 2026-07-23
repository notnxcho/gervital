// Opciones compartidas del plan de asistencia (alta/edición de cliente y reintegro).

export const FREQUENCY_OPTIONS = [
  { value: '1', label: '1 vez por semana' },
  { value: '2', label: '2 veces por semana' },
  { value: '3', label: '3 veces por semana' },
  { value: '4', label: '4 veces por semana' },
  { value: '5', label: '5 veces por semana' }
]

export const SCHEDULE_OPTIONS = [
  { value: 'morning', label: 'Mañana' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'full_day', label: 'Día completo' }
]

export const DAYS_OPTIONS = [
  { value: 'monday', label: 'Lunes' },
  { value: 'tuesday', label: 'Martes' },
  { value: 'wednesday', label: 'Miércoles' },
  { value: 'thursday', label: 'Jueves' },
  { value: 'friday', label: 'Viernes' }
]

export const DISTANCE_LABELS = { '0_to_2km': '0 a 2 km', '2_to_5km': '2 a 5 km', '5_to_10km': '5 a 10 km' }

export const DISTANCE_OPTIONS = [
  { value: '0_to_2km', label: '0 a 2 km' },
  { value: '2_to_5km', label: '2 a 5 km' },
  { value: '5_to_10km', label: '5 a 10 km' }
]
