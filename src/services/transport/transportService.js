import { supabase } from '../supabase/client'
import { CAR_COLORS, DEFAULT_FLEET } from './transportConstants'

export async function getTransportClients() {
  const { data, error } = await supabase
    .from('clients_full')
    .select('*')
  if (error) throw new Error(error.message)
  return data
    .filter(c => c.plan?.hasTransport)
    .map(c => ({
      ...c,
      latitude: c.address?.latitude || null,
      longitude: c.address?.longitude || null
    }))
}

export function filterClientsForShift(clients, shiftId, dayName) {
  return clients.filter(c => {
    if (!c.plan?.assignedDays?.includes(dayName)) return false
    const schedule = c.plan?.schedule
    switch (shiftId) {
      case 'morning_arrive': return schedule === 'morning' || schedule === 'full_day'
      case 'morning_leave': return schedule === 'morning'
      case 'afternoon_arrive': return schedule === 'afternoon'
      case 'afternoon_leave': return schedule === 'afternoon' || schedule === 'full_day'
      default: return false
    }
  })
}

export async function getArrangementForDate(dateStr) {
  const { data: arrangement, error: arrError } = await supabase
    .from('transport_day_arrangements')
    .select('id, date')
    .eq('date', dateStr)
    .maybeSingle()
  if (arrError) throw new Error(arrError.message)
  if (!arrangement) return null

  const { data: cars, error: carsError } = await supabase
    .from('transport_shift_cars')
    .select(`
      id, shift, name, seat_count, color, position,
      transport_shift_assignments ( client_id, position )
    `)
    .eq('arrangement_id', arrangement.id)
    .order('position', { ascending: true })
  if (carsError) throw new Error(carsError.message)

  const shifts = {
    morning_arrive: { cars: [] }, morning_leave: { cars: [] },
    afternoon_arrive: { cars: [] }, afternoon_leave: { cars: [] }
  }

  for (const car of (cars || [])) {
    const shiftData = shifts[car.shift]
    if (!shiftData) continue
    shiftData.cars.push({
      id: car.id, name: car.name, seatCount: car.seat_count,
      color: car.color, position: car.position,
      memberIds: (car.transport_shift_assignments || [])
        .sort((a, b) => a.position - b.position)
        .map(a => a.client_id)
    })
  }

  return { id: arrangement.id, date: arrangement.date, shifts }
}

export async function saveTransportDay(dateStr, shifts) {
  const payload = { date: dateStr, shifts: {} }
  for (const [shiftId, shiftData] of Object.entries(shifts)) {
    payload.shifts[shiftId] = {
      cars: shiftData.cars.map((car, i) => ({
        name: car.name, seatCount: car.seatCount,
        color: car.color, position: i,
        memberIds: car.memberIds || []
      }))
    }
  }
  const { data, error } = await supabase.rpc('save_transport_day', { p_data: payload })
  if (error) throw new Error(error.message)
  return data
}

export async function findLastWeekdayArrangement(dateStr) {
  const date = new Date(dateStr + 'T12:00:00')
  const dow = date.getDay()
  const { data, error } = await supabase
    .from('transport_day_arrangements')
    .select('id, date')
    .lt('date', dateStr)
    .order('date', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  for (const arr of (data || [])) {
    const arrDate = new Date(arr.date + 'T12:00:00')
    if (arrDate.getDay() === dow) return arr
  }
  return null
}

export async function copyArrangementFromDate(sourceDateStr) {
  return getArrangementForDate(sourceDateStr)
}

export function buildDefaultFleet() {
  return DEFAULT_FLEET.map((car, i) => ({
    id: `temp-${Date.now()}-${i}`,
    name: car.name, seatCount: car.seatCount,
    color: CAR_COLORS[i] || CAR_COLORS[0],
    position: i, memberIds: []
  }))
}

export function getNextCarColor(existingCars) {
  const usedColors = new Set(existingCars.map(c => c.color))
  return CAR_COLORS.find(c => !usedColors.has(c)) || CAR_COLORS[existingCars.length % CAR_COLORS.length]
}
