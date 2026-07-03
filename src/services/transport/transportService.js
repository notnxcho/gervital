import { supabase } from '../supabase/client'
import { CAR_COLORS, DEFAULT_FLEET, CLUB_LOCATION } from './transportConstants'
import { buildDayRoster } from '../attendance/dayRoster'

export async function getTransportClients() {
  const { data, error } = await supabase
    .from('clients_full')
    .select('*')
    .is('deletedAt', null)
  if (error) throw new Error(error.message)
  return data
    .filter(c => c.plan?.hasTransport)
    .map(c => ({
      ...c,
      latitude: c.address?.latitude || null,
      longitude: c.address?.longitude || null
    }))
}

export function shiftMatchesSchedule(shiftId, schedule) {
  switch (shiftId) {
    case 'morning_arrive': return schedule === 'morning' || schedule === 'full_day'
    case 'morning_leave': return schedule === 'morning'
    case 'afternoon_arrive': return schedule === 'afternoon'
    case 'afternoon_leave': return schedule === 'afternoon' || schedule === 'full_day'
    default: return false
  }
}

// Roster for a shift on a day. When attendanceByClientId (records for that date)
// is provided, absences are excluded and recovery-day attendees are included.
export function filterClientsForShift(clients, shiftId, dayName, attendanceByClientId) {
  const matchesShift = c => shiftMatchesSchedule(shiftId, c.plan?.schedule)
  return buildDayRoster({ clients, dayName, matchesShift, attendanceByClientId })
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

// A car is the "combi" (low-priority, big vehicle) when it seats more than a regular car
const REGULAR_SEAT_COUNT = 4
const isCombi = car => car.seatCount > REGULAR_SEAT_COUNT

// Auto-assign the unassigned clients of a shift into cars, grouped by geographic zone.
// Preferences: fill regular 4-seat cars first, use the combi only when they overflow,
// and add new 4-seat cars only when even the combi is full. Manual assignments are kept;
// clients without coordinates stay unassigned.
export function autoAssignByZone(shiftState, clientsById) {
  const next = {
    cars: shiftState.cars.map(c => ({ ...c, memberIds: [...(c.memberIds || [])] })),
    unassigned: [...shiftState.unassigned]
  }

  const pool = []
  const noGeo = []
  for (const id of next.unassigned) {
    const c = clientsById.get(id)
    if (c && c.latitude != null && c.longitude != null) pool.push({ id, lat: c.latitude, lng: c.longitude })
    else noGeo.push(id)
  }

  if (pool.length === 0) {
    next.unassigned = noGeo
    return { state: next, placed: 0, skipped: noGeo.length }
  }

  // Local planar projection (good enough at city scale): correct lng by cos(lat)
  const kx = Math.cos(CLUB_LOCATION.lat * Math.PI / 180)
  const dist2 = (a, b) => {
    const dx = (a.lng - b.lng) * kx
    const dy = a.lat - b.lat
    return dx * dx + dy * dy
  }

  const ptById = new Map(pool.map(p => [p.id, p]))
  const remaining = new Set(pool.map(p => p.id))

  function centroidOf(car) {
    const pts = car.memberIds
      .map(id => clientsById.get(id))
      .filter(c => c && c.latitude != null && c.longitude != null)
    if (pts.length === 0) return null
    const lat = pts.reduce((s, c) => s + c.latitude, 0) / pts.length
    const lng = pts.reduce((s, c) => s + c.longitude, 0) / pts.length
    return { lat, lng }
  }

  function activeCentroids() {
    return next.cars.map(centroidOf).filter(Boolean)
  }

  function nearestRemainingTo(target) {
    let best = null, bestD = Infinity
    for (const id of remaining) {
      const d = dist2(ptById.get(id), target)
      if (d < bestD) { bestD = d; best = id }
    }
    return best
  }

  // Seed an empty car with the remaining client farthest from every open zone
  // (k-means++ style spread), or farthest from the club when no zones exist yet.
  function pickSeed() {
    const cents = activeCentroids()
    let best = null, bestScore = -Infinity
    for (const id of remaining) {
      const p = ptById.get(id)
      const score = cents.length === 0
        ? dist2(p, CLUB_LOCATION)
        : Math.min(...cents.map(c => dist2(p, c)))
      if (score > bestScore) { bestScore = score; best = id }
    }
    return best
  }

  function fillCar(car) {
    while (car.memberIds.length < car.seatCount && remaining.size > 0) {
      const centroid = centroidOf(car)
      const pickId = centroid ? nearestRemainingTo(centroid) : pickSeed()
      if (pickId == null) break
      car.memberIds.push(pickId)
      remaining.delete(pickId)
    }
  }

  // Fill priority: regular cars with members → empty regular cars → combi(s)
  const regWith = next.cars.filter(c => !isCombi(c) && c.memberIds.length > 0)
  const regEmpty = next.cars.filter(c => !isCombi(c) && c.memberIds.length === 0)
  const combis = next.cars.filter(isCombi)

  for (const car of [...regWith, ...regEmpty, ...combis]) {
    if (remaining.size === 0) break
    if (car.memberIds.length >= car.seatCount) continue
    fillCar(car)
  }

  // Still clients left → add new 4-seat cars as needed
  while (remaining.size > 0) {
    const newCar = {
      id: `temp-${Date.now()}-${next.cars.length}`,
      name: `Auto ${next.cars.length + 1}`,
      seatCount: REGULAR_SEAT_COUNT,
      color: getNextCarColor(next.cars),
      position: next.cars.length,
      memberIds: []
    }
    next.cars.push(newCar)
    fillCar(newCar)
  }

  next.unassigned = [...noGeo, ...remaining]
  return { state: next, placed: pool.length - remaining.size, skipped: next.unassigned.length }
}
