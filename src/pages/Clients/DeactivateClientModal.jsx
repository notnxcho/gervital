import { useState, useEffect } from 'react'
import { WarningCircle } from 'iconoir-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'

export const DEACTIVATION_REASONS = [
  { value: 'death', label: 'Fallecimiento' },
  { value: 'transfer_to_other_center', label: 'Cambio a otra institución' },
  { value: 'relocation', label: 'Mudanza' },
  { value: 'health_decline', label: 'Internación / deterioro de salud' },
  { value: 'family_decision', label: 'Decisión familiar' },
  { value: 'financial', label: 'Razones económicas' },
  { value: 'service_dissatisfaction', label: 'Insatisfacción con el servicio' },
  { value: 'other', label: 'Otro' }
]

const NOTES_PLACEHOLDERS = {
  service_dissatisfaction: '¿Qué aspecto puntual? Ayudanos a mejorar.',
  other: 'Describí brevemente el motivo (obligatorio).',
  default: 'Información adicional (opcional).'
}

// Fecha local de hoy en YYYY-MM-DD (sin líos de timezone del toISOString)
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DeactivateClientModal({ isOpen, onClose, client, onConfirm, loading }) {
  const [reason, setReason] = useState(null)
  const [notes, setNotes] = useState('')
  const [deactivationDate, setDeactivationDate] = useState(todayStr())

  useEffect(() => {
    if (isOpen) {
      setReason(null)
      setNotes('')
      setDeactivationDate(todayStr())
    }
  }, [isOpen])

  const requiresNotes = reason === 'other'
  const canConfirm = reason !== null && !!deactivationDate && (!requiresNotes || notes.trim().length > 0)

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm({ reason, notes: notes.trim(), deactivationDate })
  }

  const placeholder = NOTES_PLACEHOLDERS[reason] || NOTES_PLACEHOLDERS.default

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Dar de baja cliente">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-amber-100 rounded-full shrink-0">
          <WarningCircle className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <p className="text-gray-900 font-medium">
            {client?.firstName} {client?.lastName}
          </p>
          <p className="text-sm text-gray-500">
            Podés reactivarlo después desde el detalle del cliente.
          </p>
        </div>
      </div>

      <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de baja</label>
      <input
        type="date"
        value={deactivationDate}
        onChange={e => setDeactivationDate(e.target.value)}
        max={todayStr()}
        min={client?.startDate || undefined}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      />
      <p className="text-xs text-gray-500 mt-1 mb-4">
        Desde esta fecha (inclusive) el cliente ya no asiste ni se cobra.
      </p>

      <p className="text-sm font-medium text-gray-700 mb-2">Motivo</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {DEACTIVATION_REASONS.map(r => {
          const selected = reason === r.value
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => setReason(r.value)}
              className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors ${
                selected
                  ? 'bg-purple-50 border-purple-400 text-purple-900'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {r.label}
            </button>
          )
        })}
      </div>

      <label className="block text-sm font-medium text-gray-700 mb-1">
        Notas {requiresNotes && <span className="text-red-600">*</span>}
      </label>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
      />

      <div className="flex gap-3 justify-end mt-6">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          onClick={handleConfirm}
          loading={loading}
          disabled={!canConfirm || loading}
        >
          Confirmar baja
        </Button>
      </div>
    </Modal>
  )
}
