import { useState, useEffect, useCallback } from 'react'
import { NavArrowLeft, Trash, Plus } from 'iconoir-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import {
  getTemplates,
  getTemplateDetail,
  saveTemplate,
  updateTemplateName,
  deleteTemplate,
  applyTemplate,
  saveCurrentAsTemplate,
  createTemplateSlot,
  updateTemplateSlot,
  deleteTemplateSlot,
  createTemplateActivity,
  updateTemplateActivity,
  deleteTemplateActivity
} from '../../services/groups/groupService'

const SHIFT_LABELS = { morning: 'Mañana', afternoon: 'Tarde' }
const TEMPLATES_PER_PAGE = 4

// ── Screen 1: Template Grid ─────────────────────────────────────────────────

function TemplateGrid({
  templates,
  activeShift,
  dateStr,
  onSelectTemplate,
  onReload
}) {
  const [page, setPage] = useState(0)
  const [savingCurrent, setSavingCurrent] = useState(false)
  const [saveNameInput, setSaveNameInput] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [creatingBlank, setCreatingBlank] = useState(false)

  const totalPages = Math.max(1, Math.ceil(templates.length / TEMPLATES_PER_PAGE))
  const pagedTemplates = templates.slice(
    page * TEMPLATES_PER_PAGE,
    (page + 1) * TEMPLATES_PER_PAGE
  )

  async function handleSaveCurrent() {
    if (!showSaveInput) {
      setShowSaveInput(true)
      setSaveNameInput('')
      return
    }
    const name = saveNameInput.trim()
    if (!name) return
    setSavingCurrent(true)
    try {
      await saveCurrentAsTemplate(dateStr, activeShift, name)
      setShowSaveInput(false)
      setSaveNameInput('')
      await onReload()
    } catch (err) {
      console.error('Error saving current as template:', err)
    } finally {
      setSavingCurrent(false)
    }
  }

  async function handleNewBlank() {
    setCreatingBlank(true)
    try {
      const newId = await saveTemplate({
        name: 'Nueva plantilla',
        shift: activeShift,
        slots: []
      })
      await onReload()
      onSelectTemplate(newId)
    } catch (err) {
      console.error('Error creating blank template:', err)
    } finally {
      setCreatingBlank(false)
    }
  }

  return (
    <div>
      {/* Template cards grid */}
      {templates.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          No hay plantillas para el turno {SHIFT_LABELS[activeShift]?.toLowerCase()}.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {pagedTemplates.map(t => (
              <button
                key={t.id}
                onClick={() => onSelectTemplate(t.id)}
                className="text-left p-4 rounded-xl border border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm transition-all group"
              >
                <p className="font-medium text-gray-900 text-sm truncate group-hover:text-indigo-600 transition-colors">
                  {t.name}
                </p>
                <span className={`inline-block mt-1.5 px-2 py-0.5 rounded text-xs font-medium ${
                  t.shift === 'morning'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-blue-50 text-blue-700'
                }`}>
                  {SHIFT_LABELS[t.shift]}
                </span>
                <p className="text-xs text-gray-400 mt-2">
                  {t.slotCount} horario{t.slotCount !== 1 ? 's' : ''} &middot; {t.activityCount} actividad{t.activityCount !== 1 ? 'es' : ''}
                </p>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1.5 mb-4">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === page ? 'bg-indigo-600' : 'bg-gray-300 hover:bg-gray-400'
                  }`}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Save current inline input */}
      {showSaveInput && (
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={saveNameInput}
            onChange={e => setSaveNameInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSaveCurrent()
              if (e.key === 'Escape') setShowSaveInput(false)
            }}
            placeholder="Nombre de la plantilla..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            autoFocus
          />
          <Button size="sm" onClick={handleSaveCurrent} loading={savingCurrent}>
            Guardar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSaveInput(false)}
          >
            Cancelar
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSaveCurrent}
          disabled={savingCurrent}
        >
          Guardar actual
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleNewBlank}
          loading={creatingBlank}
        >
          Nueva plantilla
        </Button>
      </div>
    </div>
  )
}

// ── Screen 2: Template Detail ───────────────────────────────────────────────

function TemplateDetail({
  templateId,
  hasExistingData,
  onBack,
  onApplied,
  onDeleted,
  dateStr,
  activeShift
}) {
  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [nameValue, setNameValue] = useState('')

  const loadTemplate = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getTemplateDetail(templateId)
      setTemplate(data)
      setNameValue(data.name)
    } catch (err) {
      console.error('Error loading template detail:', err)
    } finally {
      setLoading(false)
    }
  }, [templateId])

  useEffect(() => {
    loadTemplate()
  }, [loadTemplate])

  async function handleNameBlur() {
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === template?.name) return
    try {
      await updateTemplateName(templateId, trimmed)
      setTemplate(prev => prev ? { ...prev, name: trimmed } : prev)
    } catch (err) {
      console.error('Error updating template name:', err)
    }
  }

  async function handleApply() {
    if (hasExistingData) {
      const confirmed = window.confirm(
        'Esto reemplazara la configuracion actual del turno. Continuar?'
      )
      if (!confirmed) return
    }
    setApplying(true)
    try {
      await applyTemplate(templateId, dateStr, activeShift)
      onApplied()
    } catch (err) {
      console.error('Error applying template:', err)
    } finally {
      setApplying(false)
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm('Eliminar esta plantilla?')
    if (!confirmed) return
    setDeleting(true)
    try {
      await deleteTemplate(templateId)
      onDeleted()
    } catch (err) {
      console.error('Error deleting template:', err)
    } finally {
      setDeleting(false)
    }
  }

  async function handleAddSlot() {
    try {
      const position = template?.slots?.length || 0
      const defaultTime = activeShift === 'morning' ? '09:00' : '15:00'
      await createTemplateSlot(templateId, {
        name: `Horario ${position + 1}`,
        time: defaultTime,
        position
      })
      await loadTemplate()
    } catch (err) {
      console.error('Error creating template slot:', err)
    }
  }

  async function handleUpdateSlot(slotId, fields) {
    try {
      await updateTemplateSlot(slotId, fields)
      await loadTemplate()
    } catch (err) {
      console.error('Error updating template slot:', err)
    }
  }

  async function handleDeleteSlot(slotId) {
    try {
      await deleteTemplateSlot(slotId)
      await loadTemplate()
    } catch (err) {
      console.error('Error deleting template slot:', err)
    }
  }

  async function handleAddActivity(slotId) {
    try {
      const slot = template?.slots?.find(s => s.id === slotId)
      const position = slot?.activities?.length || 0
      await createTemplateActivity(slotId, {
        name: 'Nueva actividad',
        responsible: null,
        position
      })
      await loadTemplate()
    } catch (err) {
      console.error('Error creating template activity:', err)
    }
  }

  async function handleUpdateActivity(activityId, fields) {
    try {
      await updateTemplateActivity(activityId, fields)
      await loadTemplate()
    } catch (err) {
      console.error('Error updating template activity:', err)
    }
  }

  async function handleDeleteActivity(activityId) {
    try {
      await deleteTemplateActivity(activityId)
      await loadTemplate()
    } catch (err) {
      console.error('Error deleting template activity:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    )
  }

  if (!template) {
    return (
      <div className="text-center py-10 text-gray-400 text-sm">
        No se pudo cargar la plantilla.
      </div>
    )
  }

  return (
    <div>
      {/* Header: back + editable name */}
      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <NavArrowLeft className="w-5 h-5" />
        </button>
        <input
          type="text"
          value={nameValue}
          onChange={e => setNameValue(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          className="flex-1 text-lg font-semibold text-gray-900 bg-transparent border-none outline-none focus:ring-0 px-0"
        />
      </div>

      {/* Slots list */}
      <div className="flex flex-col gap-4 mb-4 max-h-[50vh] overflow-y-auto pr-1">
        {template.slots.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">
            No hay horarios. Agrega uno para empezar.
          </div>
        ) : (
          template.slots.map(slot => (
            <TemplateSlotCard
              key={slot.id}
              slot={slot}
              onUpdateSlot={handleUpdateSlot}
              onDeleteSlot={handleDeleteSlot}
              onAddActivity={handleAddActivity}
              onUpdateActivity={handleUpdateActivity}
              onDeleteActivity={handleDeleteActivity}
            />
          ))
        )}
      </div>

      {/* Add slot button */}
      <button
        onClick={handleAddSlot}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors mb-5"
      >
        <Plus className="w-3.5 h-3.5" />
        Agregar horario
      </button>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
        <Button onClick={handleApply} loading={applying}>
          Aplicar
        </Button>
        <Button variant="danger" onClick={handleDelete} loading={deleting}>
          Eliminar
        </Button>
        <span className="ml-auto text-xs text-gray-400">
          Los cambios se guardan automaticamente
        </span>
      </div>
    </div>
  )
}

// ── Template Slot Card ──────────────────────────────────────────────────────

function TemplateSlotCard({
  slot,
  onUpdateSlot,
  onDeleteSlot,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity
}) {
  const [slotName, setSlotName] = useState(slot.name)
  const [slotTime, setSlotTime] = useState(slot.time)

  return (
    <div className="border border-gray-200 rounded-xl bg-white p-4">
      {/* Slot header */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="time"
          value={slotTime}
          onChange={e => setSlotTime(e.target.value)}
          onBlur={() => {
            if (slotTime !== slot.time) onUpdateSlot(slot.id, { time: slotTime })
          }}
          className="px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-24"
        />
        <input
          type="text"
          value={slotName}
          onChange={e => setSlotName(e.target.value)}
          onBlur={() => {
            const trimmed = slotName.trim()
            if (trimmed && trimmed !== slot.name) onUpdateSlot(slot.id, { name: trimmed })
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          className="flex-1 text-sm font-medium text-gray-900 bg-transparent border-none outline-none focus:ring-0 px-0"
        />
        <button
          onClick={() => onDeleteSlot(slot.id)}
          className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
          title="Eliminar horario"
        >
          <Trash className="w-4 h-4" />
        </button>
      </div>

      {/* Activities */}
      <div className="flex flex-col gap-2 ml-4">
        {slot.activities.map(act => (
          <TemplateActivityRow
            key={act.id}
            activity={act}
            onUpdate={onUpdateActivity}
            onDelete={onDeleteActivity}
          />
        ))}
        <button
          onClick={() => onAddActivity(slot.id)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors py-1"
        >
          <Plus className="w-3 h-3" />
          Actividad
        </button>
      </div>
    </div>
  )
}

// ── Template Activity Row ───────────────────────────────────────────────────

function TemplateActivityRow({ activity, onUpdate, onDelete }) {
  const [name, setName] = useState(activity.name)
  const [responsible, setResponsible] = useState(activity.responsible || '')

  return (
    <div className="flex items-center gap-2 group">
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim()
          if (trimmed && trimmed !== activity.name) onUpdate(activity.id, { name: trimmed })
        }}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
        placeholder="Nombre actividad"
        className="flex-1 text-sm text-gray-700 bg-transparent border-none outline-none focus:ring-0 px-0 placeholder-gray-300"
      />
      <input
        type="text"
        value={responsible}
        onChange={e => setResponsible(e.target.value)}
        onBlur={() => {
          const trimmed = responsible.trim()
          if (trimmed !== (activity.responsible || '')) {
            onUpdate(activity.id, { responsible: trimmed || null })
          }
        }}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
        placeholder="Responsable"
        className="w-32 text-xs text-gray-500 bg-transparent border-none outline-none focus:ring-0 px-0 placeholder-gray-300"
      />
      <button
        onClick={() => onDelete(activity.id)}
        className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 rounded transition-all"
        title="Eliminar actividad"
      >
        <Trash className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Main TemplateModal ──────────────────────────────────────────────────────

export default function TemplateModal({
  isOpen,
  onClose,
  activeShift,
  dateStr,
  hasExistingData,
  onApplied
}) {
  const [screen, setScreen] = useState('grid') // 'grid' | 'detail'
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)
  const [templates, setTemplates] = useState([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true)
    try {
      const list = await getTemplates(activeShift)
      setTemplates(list)
    } catch (err) {
      console.error('Error loading templates:', err)
      setTemplates([])
    } finally {
      setLoadingTemplates(false)
    }
  }, [activeShift])

  // Load templates when modal opens or shift changes
  useEffect(() => {
    if (isOpen) {
      setScreen('grid')
      setSelectedTemplateId(null)
      loadTemplates()
    }
  }, [isOpen, loadTemplates])

  function handleSelectTemplate(templateId) {
    setSelectedTemplateId(templateId)
    setScreen('detail')
  }

  function handleBackToGrid() {
    setSelectedTemplateId(null)
    setScreen('grid')
    loadTemplates()
  }

  function handleApplied() {
    onApplied()
    onClose()
  }

  function handleDeleted() {
    setSelectedTemplateId(null)
    setScreen('grid')
    loadTemplates()
  }

  const title = screen === 'grid'
    ? `Plantillas - ${SHIFT_LABELS[activeShift]}`
    : 'Editar plantilla'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      {loadingTemplates && screen === 'grid' ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : screen === 'grid' ? (
        <TemplateGrid
          templates={templates}
          activeShift={activeShift}
          dateStr={dateStr}
          onSelectTemplate={handleSelectTemplate}
          onReload={loadTemplates}
        />
      ) : (
        <TemplateDetail
          templateId={selectedTemplateId}
          hasExistingData={hasExistingData}
          onBack={handleBackToGrid}
          onApplied={handleApplied}
          onDeleted={handleDeleted}
          dateStr={dateStr}
          activeShift={activeShift}
        />
      )}
    </Modal>
  )
}
