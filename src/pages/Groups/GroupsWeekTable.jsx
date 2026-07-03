import { useEffect, useState } from 'react'
import { Search, Xmark, Truck, RefreshDouble } from 'iconoir-react'
import { classifyDay, isRecoveryAttendee } from '../../services/attendance/dayRoster'
import './GroupsWeekTable.css'

const TIER_HEX = { A: '#34d399', B: '#38bdf8', C: '#fbbf24', D: '#fb7185' }
const TIER_ORDER = { A: 0, B: 1, C: 2, D: 3 }

const WEEK_DAYS = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' }
]

const SHIFT_ROWS = [
  { key: 'morning', label: 'Mañana' },
  { key: 'afternoon', label: 'Tarde' }
]

const sortRoster = (a, b) =>
  (TIER_ORDER[a.cognitiveLevel] ?? 9) - (TIER_ORDER[b.cognitiveLevel] ?? 9) ||
  `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)

// Same rule as shiftClients in DailyGroups — full_day clients match both shifts.
// Classifies the day into present / absent / vacation using real attendance.
function classifyForDayShift(clients, dayKey, shift, attendanceByClientId) {
  const matchesShift = c => shift === 'morning'
    ? (c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day')
    : (c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day')
  const { present, absent, vacation } = classifyDay({ clients, dayName: dayKey, matchesShift, attendanceByClientId })
  return {
    present: present.sort(sortRoster),
    absent: absent.sort(sortRoster),
    vacation: vacation.sort(sortRoster)
  }
}

function Cell({ present, absent, vacation, attMap, showAbsences }) {
  const extra = showAbsences ? absent.length + vacation.length : 0
  if (present.length === 0 && extra === 0) return <div className="gwk-empty">—</div>

  return (
    <>
      <div className="gwk-cell-head">
        <span className="gwk-count">{present.length} pers.</span>
      </div>
      {present.map(c => (
        <div key={c.id} className="gwk-chip">
          <span className="gwk-dot" style={{ background: TIER_HEX[c.cognitiveLevel] || '#cbd5e1' }} />
          <span className="gwk-name">{c.firstName} {c.lastName}</span>
          {isRecoveryAttendee(c, attMap) && <RefreshDouble className="gwk-recovery" title="Día de recupero" />}
          {c.plan?.hasTransport && <Truck className="gwk-truck" title="Con transporte" />}
        </div>
      ))}
      {showAbsences && absent.map(c => (
        <div key={c.id} className="gwk-chip gwk-chip-absent" title={c.isJustified ? 'Falta justificada' : 'Falta no justificada'}>
          <span className="gwk-dot" style={{ background: '#ef4444' }} />
          <span className="gwk-name">{c.firstName} {c.lastName}</span>
          <span className="gwk-tag gwk-tag-absent">falta</span>
        </div>
      ))}
      {showAbsences && vacation.map(c => (
        <div key={c.id} className="gwk-chip gwk-chip-vacation" title="Vacaciones">
          <span className="gwk-dot" style={{ background: '#f59e0b' }} />
          <span className="gwk-name">{c.firstName} {c.lastName}</span>
          <span className="gwk-tag gwk-tag-vacation">vac.</span>
        </div>
      ))}
    </>
  )
}

const normalize = (str) =>
  (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export default function GroupsWeekTable({ isOpen, onClose, clients, weekDates, attendanceByDate, showAbsences = false }) {
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setSearch('')
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const query = normalize(search.trim())
  const visibleClients = query
    ? clients.filter(c => normalize(`${c.firstName} ${c.lastName}`).includes(query))
    : clients

  // Attendance map (clientId → record) for a given weekday, if this week's data is loaded
  const attFor = (dayKey) => attendanceByDate?.get(weekDates?.[dayKey])

  // Unique attendees per day (full_day shows in both shifts, count once) + transport count
  const dayStats = {}
  WEEK_DAYS.forEach(d => {
    const ids = new Set()
    let transport = 0
    SHIFT_ROWS.forEach(s => classifyForDayShift(visibleClients, d.key, s.key, attFor(d.key)).present.forEach(c => {
      if (!ids.has(c.id)) {
        ids.add(c.id)
        if (c.plan?.hasTransport) transport += 1
      }
    }))
    dayStats[d.key] = { total: ids.size, transport }
  })

  return (
    <div className="gwk-overlay">
      <div className="gwk-backdrop" onClick={onClose} />
      <div className="gwk-panel">
        <div className="gwk-header">
          <div>
            <h3 className="gwk-title">Vista semanal de grupos</h3>
            <p className="gwk-subtitle">
              Asistentes por día y horario · día completo aparece en mañana y tarde · 🚚 = con transporte
            </p>
          </div>
          <div className="gwk-header-actions">
            <div className="gwk-search">
              <Search className="gwk-search-icon" />
              <input
                type="text"
                className="gwk-search-input"
                placeholder="Buscar persona..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && search) {
                    e.stopPropagation()
                    setSearch('')
                  }
                }}
              />
              {search && (
                <button className="gwk-search-clear" onClick={() => setSearch('')} aria-label="Limpiar búsqueda">
                  <Xmark className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button className="gwk-close" onClick={onClose} aria-label="Cerrar">
              <Xmark className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="gwk-scroll">
          <table className="gwk-table">
            <thead>
              <tr>
                <th className="gwk-corner" />
                {WEEK_DAYS.map(d => (
                  <th key={d.key} className="gwk-day">
                    <div className="gwk-day-name">{d.label}</div>
                    <div className="gwk-day-sub">
                      <span>{dayStats[d.key].total} asistentes</span>
                      {dayStats[d.key].transport > 0 && (
                        <span className="gwk-day-transport">
                          <Truck /> {dayStats[d.key].transport}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHIFT_ROWS.map((s, idx) => (
                <tr key={s.key} className={idx % 2 === 1 ? 'gwk-band' : ''}>
                  <th className="gwk-shift">
                    <div className="gwk-shift-label">{s.label}</div>
                  </th>
                  {WEEK_DAYS.map(d => {
                    const cls = classifyForDayShift(visibleClients, d.key, s.key, attFor(d.key))
                    return (
                      <td key={d.key} className="gwk-cell">
                        <Cell
                          present={cls.present}
                          absent={cls.absent}
                          vacation={cls.vacation}
                          attMap={attFor(d.key)}
                          showAbsences={showAbsences}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
