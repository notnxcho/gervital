import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowLeft, NavArrowRight } from 'iconoir-react'

const chevronCls = 'flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent'

// Month navigator: sequential chevrons + a clickable label that opens a month/year picker.
// `selected` = { year, month }, `onChange({ year, month })`. Bounds are optional: pass
// `minDate`/`maxDate` (startOfMonth Dates) to constrain the range, or omit for an open range.
export default function MonthNavigator({ selected, onChange, minDate = null, maxDate = null }) {
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(selected.year)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = new Date(selected.year, selected.month, 1)
  const atMin = minDate ? current <= minDate : false
  const atMax = maxDate ? current >= maxDate : false

  const inRange = (y, m) => {
    const d = new Date(y, m, 1)
    if (minDate && d < minDate) return false
    if (maxDate && d > maxDate) return false
    return true
  }

  const shift = (delta) => {
    let d = new Date(selected.year, selected.month + delta, 1)
    if (minDate && d < minDate) d = minDate
    if (maxDate && d > maxDate) d = maxDate
    onChange({ year: d.getFullYear(), month: d.getMonth() })
  }

  const toggle = () => { setViewYear(selected.year); setOpen(o => !o) }
  const pick = (m) => {
    if (!inRange(viewYear, m)) return
    onChange({ year: viewYear, month: m })
    setOpen(false)
  }

  const minYear = minDate ? minDate.getFullYear() : selected.year - 5
  const maxYear = maxDate ? maxDate.getFullYear() : selected.year + 5
  const label = format(current, 'MMMM yyyy', { locale: es })

  return (
    <div className="flex items-center gap-1" ref={ref}>
      <button type="button" onClick={() => shift(-1)} disabled={atMin} title="Mes anterior" className={chevronCls}>
        <NavArrowLeft className="w-5 h-5" />
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={toggle}
          title="Elegir mes"
          className="flex items-center rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-700 capitalize transition-colors hover:bg-gray-100"
        >
          {label}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 z-30 w-64 rounded-xl border border-gray-100 bg-white p-3 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setViewYear(y => y - 1)} disabled={viewYear <= minYear} className={chevronCls}>
                <NavArrowLeft className="w-5 h-5" />
              </button>
              <span className="text-sm font-bold text-gray-800 tabular-nums">{viewYear}</span>
              <button type="button" onClick={() => setViewYear(y => y + 1)} disabled={viewYear >= maxYear} className={chevronCls}>
                <NavArrowRight className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, m) => {
                const enabled = inRange(viewYear, m)
                const isSel = selected.year === viewYear && selected.month === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pick(m)}
                    disabled={!enabled}
                    className={`px-2 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                      isSel ? 'bg-indigo-600 text-white'
                        : enabled ? 'text-gray-700 hover:bg-gray-100'
                        : 'text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    {format(new Date(viewYear, m, 1), 'LLL', { locale: es })}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <button type="button" onClick={() => shift(1)} disabled={atMax} title="Mes siguiente" className={chevronCls}>
        <NavArrowRight className="w-5 h-5" />
      </button>
    </div>
  )
}
