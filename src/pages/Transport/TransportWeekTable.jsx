import { Fragment, useEffect, useState } from 'react'
import { Search, Xmark, RefreshDouble } from 'iconoir-react'
import { SHIFTS } from '../../services/transport/transportConstants'
import { shiftMatchesSchedule } from '../../services/transport/transportService'
import { classifyDay, isRecoveryAttendee } from '../../services/attendance/dayRoster'
import './TransportWeekTable.css'

const TIER_HEX = { A: '#34d399', B: '#38bdf8', C: '#fbbf24', D: '#fb7185' }
const SEAT_CAP = 4

const WEEK_DAYS = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' }
]

function classifyForDayShift(clients, shiftId, dayKey, attMap) {
  const matchesShift = c => shiftMatchesSchedule(shiftId, c.plan?.schedule)
  return classifyDay({ clients, dayName: dayKey, matchesShift, attendanceByClientId: attMap })
}

function Cell({ present, absent, vacation, attMap, showAbsences }) {
  const extra = showAbsences ? absent.length + vacation.length : 0
  if (present.length === 0 && extra === 0) return <div className="wk-empty">—</div>

  const cars = Math.ceil(present.length / SEAT_CAP)
  return (
    <>
      <div className="wk-cell-head">
        <span className="wk-count">{present.length} pers.</span>
        {present.length > 0 && <span className="wk-cars">🚐 {cars}</span>}
      </div>
      {present.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 && i % SEAT_CAP === 0 && <div className="wk-sep"><div className="wk-line" /></div>}
          <div className="wk-chip">
            <span className="wk-dot" style={{ background: TIER_HEX[c.cognitiveLevel] || '#cbd5e1' }} />
            <span className="wk-name">{c.firstName} {c.lastName}</span>
            {isRecoveryAttendee(c, attMap) && <RefreshDouble className="wk-recovery" title="Día de recupero" />}
          </div>
        </Fragment>
      ))}
      {showAbsences && absent.map(c => (
        <div key={c.id} className="wk-chip wk-chip-absent" title={c.isJustified ? 'Falta justificada' : 'Falta no justificada'}>
          <span className="wk-dot" style={{ background: '#ef4444' }} />
          <span className="wk-name">{c.firstName} {c.lastName}</span>
          <span className="wk-chip-tag wk-chip-tag-absent">falta</span>
        </div>
      ))}
      {showAbsences && vacation.map(c => (
        <div key={c.id} className="wk-chip wk-chip-vacation" title="Vacaciones">
          <span className="wk-dot" style={{ background: '#f59e0b' }} />
          <span className="wk-name">{c.firstName} {c.lastName}</span>
          <span className="wk-chip-tag wk-chip-tag-vacation">vac.</span>
        </div>
      ))}
    </>
  )
}

const normalize = (str) =>
  (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export default function TransportWeekTable({ isOpen, onClose, clients, weekDates, attendanceByDate, showAbsences = false }) {
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

  // Unique attendees per day (a person shows up in two shifts, count once)
  const dayUnique = {}
  WEEK_DAYS.forEach(d => {
    const ids = new Set()
    SHIFTS.forEach(s => classifyForDayShift(visibleClients, s.id, d.key, attFor(d.key)).present.forEach(c => ids.add(c.id)))
    dayUnique[d.key] = ids.size
  })

  return (
    <div className="wk-overlay">
      <div className="wk-backdrop" onClick={onClose} />
      <div className="wk-panel">
        <div className="wk-header">
          <div>
            <h3 className="wk-title">Vista semanal de transporte</h3>
            <p className="wk-subtitle">
              Asistentes por día y horario · cada persona aparece 2 veces (llegada + salida) · separador cada {SEAT_CAP} = otro auto
            </p>
          </div>
          <div className="wk-header-actions">
            <div className="wk-search">
              <Search className="wk-search-icon" />
              <input
                type="text"
                className="wk-search-input"
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
                <button className="wk-search-clear" onClick={() => setSearch('')} aria-label="Limpiar búsqueda">
                  <Xmark className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button className="wk-close" onClick={onClose} aria-label="Cerrar">
              <Xmark className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="wk-scroll">
          <table className="wk-table">
            <thead>
              <tr>
                <th className="wk-corner" />
                {WEEK_DAYS.map(d => (
                  <th key={d.key} className="wk-day">
                    <div className="wk-day-name">{d.label}</div>
                    <div className="wk-day-sub">{dayUnique[d.key]} asistentes</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHIFTS.map((s, idx) => (
                <tr key={s.id} className={idx % 2 === 1 ? 'wk-band' : ''}>
                  <th className="wk-shift">
                    <div className="wk-shift-label">{s.label}</div>
                    <div className="wk-shift-time">{s.time}</div>
                    <span className={`wk-tag ${s.type === 'arrive' ? 'wk-tag-arrive' : 'wk-tag-leave'}`}>
                      {s.type === 'arrive' ? 'Llegada' : 'Salida'}
                    </span>
                  </th>
                  {WEEK_DAYS.map(d => {
                    const cls = classifyForDayShift(visibleClients, s.id, d.key, attFor(d.key))
                    return (
                      <td key={d.key} className="wk-cell">
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
