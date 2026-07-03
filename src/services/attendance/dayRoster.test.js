import { buildDayRoster, classifyDay, isRecoveryAttendee, indexAttendanceByClientId, ABSENT_STATUSES, RECOVERY_STATUS } from './dayRoster'

// Helpers
const client = (id, days, schedule = 'morning', over = {}) => ({
  id,
  firstName: id,
  lastName: id,
  plan: { assignedDays: days, schedule },
  ...over
})

// morning shift predicate (as used by Grupos): morning or full_day
const morningShift = c => c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day'
const afternoonShift = c => c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day'

describe('buildDayRoster', () => {
  test('planned client with no attendance record is included', () => {
    const clients = [client('a', ['monday'])]
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: new Map() })
    expect(roster.map(c => c.id)).toEqual(['a'])
  })

  test('planned client is excluded when marked absent that day (justified)', () => {
    const clients = [client('hebe', ['monday'])]
    const att = new Map([['hebe', { status: 'absent', isJustified: true }]])
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('planned client is excluded when marked absent that day (unjustified)', () => {
    const clients = [client('a', ['monday'])]
    const att = new Map([['a', { status: 'absent', isJustified: false }]])
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('planned client is excluded when on vacation that day', () => {
    const clients = [client('a', ['monday'])]
    const att = new Map([['a', { status: 'vacation' }]])
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('planned client stays when attended or scheduled', () => {
    const clients = [client('a', ['monday']), client('b', ['monday'])]
    const att = new Map([
      ['a', { status: 'attended' }],
      ['b', { status: 'scheduled' }]
    ])
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id).sort()).toEqual(['a', 'b'])
  })

  test('non-planned client attending on a recovery day is included in matching shift', () => {
    // client assigned Mon/Wed but attends on Thursday as recovery
    const clients = [client('r', ['monday', 'wednesday'], 'morning')]
    const att = new Map([['r', { status: 'recovery' }]])
    const roster = buildDayRoster({ clients, dayName: 'thursday', matchesShift: morningShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual(['r'])
  })

  test('recovery-day attendee is not included in a non-matching shift', () => {
    // morning-schedule client recovering — should not appear in afternoon shift
    const clients = [client('r', ['monday'], 'morning')]
    const att = new Map([['r', { status: 'recovery' }]])
    const roster = buildDayRoster({ clients, dayName: 'thursday', matchesShift: afternoonShift, attendanceByClientId: att })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('non-planned client with no record is not included', () => {
    const clients = [client('a', ['monday'])]
    const roster = buildDayRoster({ clients, dayName: 'thursday', matchesShift: morningShift, attendanceByClientId: new Map() })
    expect(roster.map(c => c.id)).toEqual([])
  })

  test('full_day client appears in both morning and afternoon shifts', () => {
    const clients = [client('f', ['monday'], 'full_day')]
    const m = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: new Map() })
    const a = buildDayRoster({ clients, dayName: 'monday', matchesShift: afternoonShift, attendanceByClientId: new Map() })
    expect(m.map(c => c.id)).toEqual(['f'])
    expect(a.map(c => c.id)).toEqual(['f'])
  })

  test('empty attendance map behaves exactly like plan-only filtering (no regression)', () => {
    const clients = [
      client('a', ['monday'], 'morning'),
      client('b', ['tuesday'], 'morning'),
      client('c', ['monday'], 'afternoon')
    ]
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift })
    expect(roster.map(c => c.id)).toEqual(['a'])
  })

  test('preserves order of the input clients array', () => {
    const clients = [client('z', ['monday']), client('a', ['monday']), client('m', ['monday'])]
    const roster = buildDayRoster({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: new Map() })
    expect(roster.map(c => c.id)).toEqual(['z', 'a', 'm'])
  })
})

describe('classifyDay', () => {
  const morningShift = c => c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day'

  test('splits planned clients into present / absent / vacation', () => {
    const clients = [
      client('present', ['monday']),
      client('hebe', ['monday']),
      client('onvac', ['monday'])
    ]
    const att = new Map([
      ['hebe', { status: 'absent', isJustified: true }],
      ['onvac', { status: 'vacation' }]
    ])
    const { present, absent, vacation } = classifyDay({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(present.map(c => c.id)).toEqual(['present'])
    expect(absent.map(c => c.id)).toEqual(['hebe'])
    expect(vacation.map(c => c.id)).toEqual(['onvac'])
  })

  test('recovery attendee (non-planned day) lands in present, not absent/vacation', () => {
    const clients = [client('r', ['monday'], 'morning')]
    const att = new Map([['r', { status: 'recovery' }]])
    const { present, absent, vacation } = classifyDay({ clients, dayName: 'thursday', matchesShift: morningShift, attendanceByClientId: att })
    expect(present.map(c => c.id)).toEqual(['r'])
    expect(absent).toEqual([])
    expect(vacation).toEqual([])
  })

  test('present matches buildDayRoster output', () => {
    const clients = [
      client('a', ['monday']),
      client('b', ['monday']),
      client('r', ['tuesday'], 'morning')
    ]
    const att = new Map([
      ['b', { status: 'absent' }],
      ['r', { status: 'recovery' }]
    ])
    const args = { clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att }
    expect(classifyDay(args).present.map(c => c.id)).toEqual(buildDayRoster(args).map(c => c.id))
  })

  test('absent/vacation only include clients whose shift matches', () => {
    // afternoon-schedule absent client should NOT appear in a morning classification
    const clients = [client('pm', ['monday'], 'afternoon')]
    const att = new Map([['pm', { status: 'absent' }]])
    const { absent } = classifyDay({ clients, dayName: 'monday', matchesShift: morningShift, attendanceByClientId: att })
    expect(absent).toEqual([])
  })

  test('empty attendance map yields all-present, empty absent/vacation', () => {
    const clients = [client('a', ['monday']), client('b', ['monday'])]
    const { present, absent, vacation } = classifyDay({ clients, dayName: 'monday', matchesShift: morningShift })
    expect(present.map(c => c.id).sort()).toEqual(['a', 'b'])
    expect(absent).toEqual([])
    expect(vacation).toEqual([])
  })
})

describe('isRecoveryAttendee', () => {
  test('true only when the client has a recovery record', () => {
    const att = new Map([
      ['r', { status: 'recovery' }],
      ['a', { status: 'attended' }],
      ['x', { status: 'absent' }]
    ])
    expect(isRecoveryAttendee({ id: 'r' }, att)).toBe(true)
    expect(isRecoveryAttendee({ id: 'a' }, att)).toBe(false)
    expect(isRecoveryAttendee({ id: 'x' }, att)).toBe(false)
    expect(isRecoveryAttendee({ id: 'none' }, att)).toBe(false)
  })

  test('false when no attendance map is provided', () => {
    expect(isRecoveryAttendee({ id: 'r' })).toBe(false)
  })
})

describe('indexAttendanceByClientId', () => {
  test('builds a Map keyed by clientId', () => {
    const records = [
      { clientId: 'a', status: 'absent' },
      { clientId: 'b', status: 'recovery' }
    ]
    const map = indexAttendanceByClientId(records)
    expect(map.get('a').status).toBe('absent')
    expect(map.get('b').status).toBe('recovery')
  })

  test('returns an empty Map for empty or missing input', () => {
    expect(indexAttendanceByClientId([]).size).toBe(0)
    expect(indexAttendanceByClientId(undefined).size).toBe(0)
  })

  test('last record wins on duplicate clientId', () => {
    const map = indexAttendanceByClientId([
      { clientId: 'a', status: 'scheduled' },
      { clientId: 'a', status: 'absent' }
    ])
    expect(map.get('a').status).toBe('absent')
  })
})

describe('status constants', () => {
  test('absent statuses cover absent and vacation', () => {
    expect(ABSENT_STATUSES).toContain('absent')
    expect(ABSENT_STATUSES).toContain('vacation')
  })

  test('recovery status is "recovery"', () => {
    expect(RECOVERY_STATUS).toBe('recovery')
  })
})
