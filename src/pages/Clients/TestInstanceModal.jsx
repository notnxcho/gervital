import { useState, useEffect } from 'react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input, { Select, Textarea } from '../../components/ui/Input'
import { computeScore } from '../../services/clients/testScoring'
import { getMaxScore } from '../../services/clients/testsCatalog'
import { createTestInstance, updateTestInstance, uploadTestAttachment } from '../../services/api'

const MODE_TITLES = { create: 'Nueva evaluación', edit: 'Editar evaluación', view: 'Evaluación' }

// Etiquetas legibles para las claves derivadas de subescalas (las de catálogo traen label propio).
const DERIVED_LABELS = { tmt_a: 'TMT-A', tmt_b: 'TMT-B', b_menos_a: 'B − A', ratio_b_a: 'B / A' }

function subLabel(test, key) {
  const sub = (test.scoring.subscales || []).find(s => s.name === key)
  return sub?.label || DERIVED_LABELS[key] || key
}

// Umbral de cribado por subescala (Goldberg): ansiedad ≥2, depresión ≥1 en los ítems screening.
function screeningMet(test, answers, subscale) {
  const threshold = subscale === 'depresion' ? 1 : 2
  const hits = test.fields
    .filter(f => f.subscale === subscale && f.screening && answers[f.name] === (f.scoredAnswer ?? true))
    .length
  return hits >= threshold
}

function FieldInput({ field, value, onChange, disabled, clientId, onUploading }) {
  if (field.type === 'boolean') {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
        <div className="flex gap-2">
          {[{ v: true, l: 'Sí' }, { v: false, l: 'No' }].map(opt => (
            <button
              key={opt.l}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.v)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                value === opt.v
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              } disabled:opacity-60`}
            >
              {opt.l}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {field.label}{field.unit ? ` (${field.unit})` : ''}
        </label>
        <input
          type="number"
          value={value ?? ''}
          min={field.min}
          max={field.max}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
        />
      </div>
    )
  }

  if (field.type === 'image') {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
        {value && <img src={value} alt="Dibujo" className="mb-2 max-h-48 rounded-lg border border-gray-200 object-contain" />}
        {!disabled && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-100">
            {value ? 'Cambiar imagen' : 'Subir imagen'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                onUploading(true)
                try {
                  const url = await uploadTestAttachment(clientId, file)
                  onChange(url)
                } catch (err) {
                  window.alert(err.message)
                } finally {
                  onUploading(false)
                }
              }}
            />
          </label>
        )}
      </div>
    )
  }

  if (field.type === 'textarea') {
    return <Textarea label={field.label} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} rows={2} />
  }

  if (field.type === 'string') {
    return <Input label={field.label} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} />
  }

  // enum
  return (
    <Select
      label={field.label}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      options={[{ value: '', label: 'Seleccionar…' }, ...field.options.map(o => ({ value: o.value, label: field.scored ? `${o.label} (${o.score})` : o.label }))]}
    />
  )
}

export default function TestInstanceModal({ isOpen, onClose, test, clientId, instance, mode = 'create', administeredBy, defaultDate, onSaved }) {
  const readOnly = mode === 'view'
  const [answers, setAnswers] = useState({})
  const [administeredAt, setAdministeredAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen) return
    setAnswers(instance?.answers || {})
    setAdministeredAt(instance?.administeredAt || defaultDate || new Date().toISOString().split('T')[0])
    setNotes(instance?.notes || '')
    setError(null)
  }, [isOpen, instance, defaultDate])

  if (!test) return null

  const { rawScore, subscores, interpretationLabel, scoreVersion, isComplete } = computeScore(test, answers)
  const maxScore = getMaxScore(test)
  const unit = (test.fields.find(f => f.name === test.scoring.manualScoreField)?.unit) || ''

  const setAnswer = (name, value) => setAnswers(prev => ({ ...prev, [name]: value }))

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
        subscores,
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

        {/* Campos del test (gating opcional en Goldberg) */}
        {test.fields.map(field => {
          const gated = field.screening === false && field.subscale && !screeningMet(test, answers, field.subscale)
          return (
            <div key={field.name} className={gated ? 'opacity-50' : ''}>
              <FieldInput
                field={field}
                value={answers[field.name]}
                onChange={v => setAnswer(field.name, v)}
                disabled={readOnly}
                clientId={clientId}
                onUploading={setUploading}
              />
              {gated && <p className="mt-1 text-xs text-amber-600">Ítem de seguimiento (el cribado no lo requiere, pero podés registrarlo).</p>}
            </div>
          )
        })}

        {/* Notas generales */}
        <Textarea label="Notas generales" value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly} rows={2} />

        {/* Resultado en vivo */}
        <div className="bg-indigo-50 rounded-lg p-4 space-y-2">
          {subscores ? (
            <div className="space-y-1">
              {Object.entries(subscores).map(([key, sub]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-indigo-700">{subLabel(test, key)}</span>
                  <span className="text-sm font-semibold text-indigo-900">
                    {sub.score == null ? '—' : (Number.isInteger(sub.score) ? sub.score : sub.score.toFixed(1))}
                    {sub.max != null ? `/${sub.max}` : ''}
                    {sub.label ? ` · ${sub.label}` : ''}
                  </span>
                </div>
              ))}
              {rawScore != null && (
                <div className="flex items-center justify-between border-t border-indigo-200 pt-1">
                  <span className="text-sm font-medium text-indigo-700">Total</span>
                  <span className="text-sm font-bold text-indigo-900">{rawScore}{maxScore != null ? `/${maxScore}` : ''}{interpretationLabel ? ` · ${interpretationLabel}` : ''}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-indigo-700">Puntaje</p>
                <p className="text-2xl font-bold text-indigo-900">
                  {rawScore == null ? '—' : rawScore}
                  <span className="text-base font-normal text-indigo-500">{maxScore != null ? `/${maxScore}` : (unit ? ` ${unit}` : '')}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-indigo-700">Interpretación</p>
                <p className="font-semibold text-indigo-900">{isComplete ? (interpretationLabel || '—') : 'Incompleto'}</p>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
        <Button variant="secondary" onClick={onClose}>{readOnly ? 'Cerrar' : 'Cancelar'}</Button>
        {!readOnly && <Button onClick={handleSave} loading={saving} disabled={uploading}>{uploading ? 'Subiendo imagen…' : 'Guardar'}</Button>}
      </div>
    </Modal>
  )
}
