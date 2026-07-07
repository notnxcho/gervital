import { useState } from 'react'
import { NavArrowDown, NavArrowRight, EditPencil, Check, Xmark } from 'iconoir-react'
import { formatCurrency } from '../../utils/format'
import { contingencyStatus } from '../../services/expenses/contingencyFund'
import Card from '../../components/ui/Card'

// Contingency-fund progress bar. Limit = pct% of monthlyized fixed expenses,
// filled by extraordinary expenses. Collapsible detail passed as children.
export default function ContingencyFundBar({ limitAmount, consumed, pct, canEdit, onSavePct, count, children }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftPct, setDraftPct] = useState(String(pct))
  const [saving, setSaving] = useState(false)

  const { fillPct, remaining, over } = contingencyStatus(consumed, limitAmount)

  const barColor = over ? 'bg-red-500' : fillPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'

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
    <Card className="p-4 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">Fondo de contingencia</h3>
            {editing ? (
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  value={draftPct}
                  onChange={(e) => setDraftPct(e.target.value)}
                  className="w-16 px-2 py-0.5 border border-gray-300 rounded text-sm"
                />
                <span className="text-sm text-gray-500">%</span>
                <button onClick={saveEdit} disabled={saving} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => { setEditing(false); setDraftPct(String(pct)) }} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                  <Xmark className="w-4 h-4" />
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-gray-500">
                <span>{pct}% de fijos mensualizado</span>
                {canEdit && (
                  <button onClick={() => setEditing(true)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                    <EditPencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {formatCurrency(consumed)} de {formatCurrency(limitAmount)}
            {over
              ? <span className="text-red-600 font-medium"> · Excedido por {formatCurrency(-remaining)}</span>
              : <span className="text-gray-400"> · Disponible {formatCurrency(remaining)}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 shrink-0"
        >
          {open ? <NavArrowDown className="w-5 h-5" /> : <NavArrowRight className="w-5 h-5" />}
          <span>{count} extraordinario{count === 1 ? '' : 's'}</span>
        </button>
      </div>

      <div className="mt-3 h-3 w-full bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${fillPct}%` }} />
      </div>

      {open && <div className="mt-4">{children}</div>}
    </Card>
  )
}
