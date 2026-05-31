import { useState } from 'react'
import { Plus, Trash } from 'iconoir-react'
import { differenceInCalendarDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { addRecoveryCredit, revokeRecoveryCredit } from '../../services/api'

const SOURCE_LABELS = {
  justified_absence: 'Falta justificada',
  vacation_post_payment: 'Vacación',
  manual: 'Manual',
  migration: 'Migrado'
}

// Urgency color by days remaining (≤7 red, ≤14 amber, else neutral)
function urgencyClasses(daysLeft) {
  if (daysLeft <= 7) return 'text-red-600'
  if (daysLeft <= 14) return 'text-amber-600'
  return 'text-gray-500'
}

export default function RecoveryCreditsModal({ isOpen, onClose, credits, canMutate, userName, clientId, onChanged }) {
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const [processingId, setProcessingId] = useState(null)
  const [savingAdd, setSavingAdd] = useState(false)

  const handleAdd = async () => {
    setSavingAdd(true)
    try {
      await addRecoveryCredit(clientId, note, userName)
      setNote('')
      setAdding(false)
      await onChanged()
    } catch (e) {
      console.error(e)
    } finally {
      setSavingAdd(false)
    }
  }

  const handleRevoke = async (creditId) => {
    setProcessingId(creditId)
    try {
      await revokeRecoveryCredit(creditId, userName)
      await onChanged()
    } catch (e) {
      console.error(e)
    } finally {
      setProcessingId(null)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Días de recupero" size="md">
      {/* Header: total count + add */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-lg bg-indigo-100 text-indigo-700 text-lg font-bold">
            {credits.length}
          </span>
          <span className="text-sm text-gray-500">
            {credits.length === 1 ? 'día disponible' : 'días disponibles'}
          </span>
        </div>
        {canMutate && !adding && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="w-4 h-4" /> Agregar
          </Button>
        )}
      </div>

      {/* Inline add form */}
      {canMutate && adding && (
        <div className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Nota (opcional)"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          <p className="mt-1 text-xs text-gray-400">Vence en 30 días desde hoy.</p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setNote('') }}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={handleAdd} loading={savingAdd}>Agregar día</Button>
          </div>
        </div>
      )}

      {/* Credit list */}
      {credits.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No hay días de recupero disponibles</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {credits.map(c => {
            const daysLeft = differenceInCalendarDays(new Date(c.expiresAt), new Date())
            return (
              <li key={c.id} className="flex items-center justify-between py-3">
                <div>
                  <p className={`text-sm font-medium ${urgencyClasses(daysLeft)}`}>
                    Vence el {format(new Date(c.expiresAt), "d 'de' MMM", { locale: es })}
                    <span className="font-normal"> · en {daysLeft} {daysLeft === 1 ? 'día' : 'días'}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {SOURCE_LABELS[c.source] || c.source}{c.note ? ` · ${c.note}` : ''}
                  </p>
                </div>
                {canMutate && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(c.id)}
                    disabled={processingId === c.id}
                    className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-50"
                    title="Remover día"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
