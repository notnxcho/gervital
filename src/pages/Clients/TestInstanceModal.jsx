import { useState, useEffect } from 'react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { Select, Textarea } from '../../components/ui/Input'
import { computeScore } from '../../services/clients/testScoring'
import { getMaxScore } from '../../services/clients/testsCatalog'
import { createTestInstance, updateTestInstance } from '../../services/api'

const MODE_TITLES = { create: 'Nueva evaluación', edit: 'Editar evaluación', view: 'Evaluación' }

export default function TestInstanceModal({ isOpen, onClose, test, clientId, instance, mode = 'create', administeredBy, defaultDate, onSaved }) {
  const readOnly = mode === 'view'
  const [answers, setAnswers] = useState({})
  const [administeredAt, setAdministeredAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Reset form each time the modal opens or the target instance changes.
  useEffect(() => {
    if (!isOpen) return
    setAnswers(instance?.answers || {})
    setAdministeredAt(instance?.administeredAt || defaultDate || new Date().toISOString().split('T')[0])
    setNotes(instance?.notes || '')
    setError(null)
  }, [isOpen, instance, defaultDate])

  if (!test) return null

  const { rawScore, interpretationLabel, scoreVersion, isComplete } = computeScore(test, answers)
  const maxScore = getMaxScore(test)

  const setAnswer = (fieldName, value) => setAnswers(prev => ({ ...prev, [fieldName]: value }))

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        testId: test.id,
        administeredAt,
        administeredBy,
        isGenesis: instance?.isGenesis ?? false,
        answers,
        rawScore,
        subscores: null,
        interpretationLabel,
        scoreVersion,
        notes
      }
      if (mode === 'edit' && instance) await updateTestInstance(instance.id, payload)
      else await createTestInstance(clientId, payload)
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${MODE_TITLES[mode]} · ${test.name}`} size="lg">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {/* Fecha de toma */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de la evaluación</label>
          <input
            type="date"
            value={administeredAt}
            onChange={e => setAdministeredAt(e.target.value)}
            disabled={readOnly}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
          />
        </div>

        {/* Ítems */}
        {test.fields.map(field => (
          <Select
            key={field.name}
            label={field.label}
            value={answers[field.name] ?? ''}
            onChange={e => setAnswer(field.name, e.target.value)}
            disabled={readOnly}
            options={[{ value: '', label: 'Seleccionar…' }, ...field.options.map(o => ({ value: o.value, label: `${o.label} (${o.score})` }))]}
          />
        ))}

        {/* Notas */}
        <Textarea label="Observaciones" value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly} rows={2} />

        {/* Puntaje en vivo */}
        <div className="bg-indigo-50 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-indigo-700">Puntaje</p>
            <p className="text-2xl font-bold text-indigo-900">{rawScore}<span className="text-base font-normal text-indigo-500">/{maxScore}</span></p>
          </div>
          <div className="text-right">
            <p className="text-sm text-indigo-700">Interpretación</p>
            <p className="font-semibold text-indigo-900">{isComplete ? interpretationLabel : 'Incompleto'}</p>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
        <Button variant="secondary" onClick={onClose}>{readOnly ? 'Cerrar' : 'Cancelar'}</Button>
        {!readOnly && <Button onClick={handleSave} loading={saving}>Guardar</Button>}
      </div>
    </Modal>
  )
}
