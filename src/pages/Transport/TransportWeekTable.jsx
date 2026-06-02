import { Fragment, useEffect } from 'react'
import { Xmark } from 'iconoir-react'
import { SHIFTS } from '../../services/transport/transportConstants'
import { filterClientsForShift } from '../../services/transport/transportService'
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

function Cell({ people }) {
  if (people.length === 0) return <div className="wk-empty">—</div>

  const cars = Math.ceil(people.length / SEAT_CAP)
  return (
    <>
      <div className="wk-cell-head">
        <span className="wk-count">{people.length} pers.</span>
        <span className="wk-cars">🚐 {cars}</span>
      </div>
      {people.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 && i % SEAT_CAP === 0 && <div className="wk-sep"><div className="wk-line" /></div>}
          <div className="wk-chip">
            <span className="wk-dot" style={{ background: TIER_HEX[c.cognitiveLevel] || '#cbd5e1' }} />
            <span className="wk-name">{c.firstName} {c.lastName}</span>
          </div>
        </Fragment>
      ))}
    </>
  )
}

export default function TransportWeekTable({ isOpen, onClose, clients }) {
  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Unique attendees per day (a person shows up in two shifts, count once)
  const dayUnique = {}
  WEEK_DAYS.forEach(d => {
    const ids = new Set()
    SHIFTS.forEach(s => filterClientsForShift(clients, s.id, d.key).forEach(c => ids.add(c.id)))
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
          <button className="wk-close" onClick={onClose} aria-label="Cerrar">
            <Xmark className="w-5 h-5" />
          </button>
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
                  {WEEK_DAYS.map(d => (
                    <td key={d.key} className="wk-cell">
                      <Cell people={filterClientsForShift(clients, s.id, d.key)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
