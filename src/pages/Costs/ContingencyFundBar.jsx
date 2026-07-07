import { useState } from 'react'
import { NavArrowDown, NavArrowRight, EditPencil, Check, Xmark, Shield, ShieldAlert } from 'iconoir-react'
import { formatCurrency } from '../../utils/format'
import { contingencyStatus } from '../../services/expenses/contingencyFund'
import Card from '../../components/ui/Card'

// Status-driven color tokens (icon badge, progress fill, accent text).
const TONES = {
  healthy: { badge: 'bg-emerald-50 text-emerald-600', bar: 'bg-emerald-500', text: 'text-emerald-600' },
  warning: { badge: 'bg-amber-50 text-amber-600', bar: 'bg-amber-500', text: 'text-amber-600' },
  over: { badge: 'bg-red-50 text-red-600', bar: 'bg-red-500', text: 'text-red-600' }
}

// Contingency-fund progress bar. Limit = pct% of monthlyized fixed expenses,
// filled by extraordinary expenses. Collapsible detail passed as children.
export default function ContingencyFundBar({ limitAmount, consumed, pct, canEdit, onSavePct, count, children }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftPct, setDraftPct] = useState(String(pct))
  const [saving, setSaving] = useState(false)

  const { fillPct, remaining, over } = contingencyStatus(consumed, limitAmount)
  const tone = over ? TONES.over : fillPct >= 80 ? TONES.warning : TONES.healthy
  const Icon = over ? ShieldAlert : Shield

  const saveEdit = async () => {
    const value = Number(draftPct)
    if (!Number.isFinite(value) || value <= 0) return
    setSaving(true)
    try {
      await onSavePct(value)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5 mb-6">
      <div className="flex items-start gap-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tone.badge}`}>
          <Icon className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-gray-900">Fondo de contingencia</h3>
                {editing ? (
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      value={draftPct}
                      onChange={(e) => setDraftPct(e.target.value)}
                      autoFocus
                      className="w-14 px-2 py-0.5 border border-gray-300 rounded-md text-sm"
                    />
                    <span className="text-sm text-gray-500">%</span>
                    <button onClick={saveEdit} disabled={saving} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-md">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => { setEditing(false); setDraftPct(String(pct)) }} className="p-1 text-gray-400 hover:bg-gray-100 rounded-md">
                      <Xmark className="w-4 h-4" />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => canEdit && setEditing(true)}
                    disabled={!canEdit}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-xs font-medium text-gray-600 ${canEdit ? 'hover:bg-gray-200 cursor-pointer' : 'cursor-default'}`}
                  >
                    <span>{pct}% de fijos mensualizado</span>
                    {canEdit && <EditPencil className="w-3 h-3 text-gray-400" />}
                  </button>
                )}
              </div>
              <p className="text-sm mt-1">
                <span className="text-lg font-semibold text-gray-900">{formatCurrency(consumed)}</span>
                <span className="text-gray-400"> de {formatCurrency(limitAmount)}</span>
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className={`text-2xl font-bold tabular-nums ${tone.text}`}>{Math.round(fillPct)}%</span>
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <span className="tabular-nums">{count}</span>
                {open ? <NavArrowDown className="w-4 h-4" /> : <NavArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="mt-3 h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${tone.bar} transition-all duration-500`} style={{ width: `${fillPct}%` }} />
          </div>

          <p className="text-xs mt-2">
            {over
              ? <span className={`font-medium ${tone.text}`}>Excedido por {formatCurrency(-remaining)}</span>
              : <span className="text-gray-400">Disponible {formatCurrency(remaining)}</span>}
          </p>
        </div>
      </div>

      {open && <div className="mt-4 pt-4 border-t border-gray-100">{children}</div>}
    </Card>
  )
}
