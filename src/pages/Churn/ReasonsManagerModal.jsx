import { useState, useEffect, useCallback } from 'react'
import { EditPencil, Trash, NavArrowUp, NavArrowDown, Plus, Check, Xmark } from 'iconoir-react'
import { useAuth } from '../../context/AuthContext'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input, { Textarea } from '../../components/ui/Input'
import {
  getReasons,
  createReason,
  updateReason,
  setReasonActive,
  reorderReasons,
  invalidateReasonLabelMap
} from '../../services/churn/deactivationReasonService'

const EMPTY_FORM = { label: '', description: '', color: '#64748b' }

function ReasonRow({ reason, index, total, editing, onEdit, onCancelEdit, onSave, onToggleActive, onMoveUp, onMoveDown, busy }) {
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    if (editing) {
      setForm({
        label: reason.label || '',
        description: reason.description || '',
        color: reason.color || '#64748b'
      })
    }
  }, [editing, reason])

  if (editing) {
    return (
      <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-3 space-y-3">
        <div className="flex items-start gap-3">
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))}
            className="w-10 h-10 mt-1 rounded-lg border border-gray-300 cursor-pointer shrink-0"
          />
          <div className="flex-1 space-y-2">
            <Input
              label="Etiqueta"
              value={form.label}
              onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))}
            />
            <Textarea
              label="Descripción"
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancelEdit} disabled={busy}>
            <Xmark className="w-4 h-4" />
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSave(form)}
            loading={busy}
            disabled={!form.label.trim()}
          >
            <Check className="w-4 h-4" />
            Guardar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex items-start gap-3 border rounded-xl p-3 ${reason.isActive ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
      <span
        className="w-4 h-4 rounded-full mt-1 shrink-0 border border-black/10"
        style={{ backgroundColor: reason.color || '#64748b' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900">{reason.label}</p>
          {!reason.isActive && (
            <span className="text-[11px] font-medium text-gray-500 bg-gray-200 rounded-full px-2 py-0.5">
              Inactivo
            </span>
          )}
          {reason.isSystem && (
            <span className="text-[11px] font-medium text-indigo-600 bg-indigo-100 rounded-full px-2 py-0.5">
              Sistema
            </span>
          )}
        </div>
        {reason.description && (
          <p className="text-sm text-gray-500 mt-0.5">{reason.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" onClick={onMoveUp} disabled={busy || index === 0}>
          <NavArrowUp className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onMoveDown} disabled={busy || index === total - 1}>
          <NavArrowDown className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit} disabled={busy}>
          <EditPencil className="w-4 h-4" />
        </Button>
        {!reason.isSystem && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleActive(reason)}
            disabled={busy}
            className={reason.isActive ? 'text-red-500 hover:text-red-600' : 'text-green-600 hover:text-green-700'}
          >
            {reason.isActive ? <Trash className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          </Button>
        )}
      </div>
    </div>
  )
}

export default function ReasonsManagerModal({ isOpen, onClose, onSaved }) {
  const { user } = useAuth()
  const isSuperadmin = user?.role === 'superadmin'

  const [reasons, setReasons] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newForm, setNewForm] = useState(EMPTY_FORM)
  const [savedFlag, setSavedFlag] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await getReasons({ includeInactive: true })
      setReasons([...list].sort((a, b) => a.sortOrder - b.sortOrder))
    } catch (err) {
      console.error('Error loading deactivation reasons:', err)
      setError('No se pudieron cargar los motivos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      setEditingId(null)
      setNewForm(EMPTY_FORM)
      setSavedFlag(false)
      load()
    }
  }, [isOpen, load])

  const markSaved = () => {
    invalidateReasonLabelMap()
    setSavedFlag(true)
  }

  const handleClose = () => {
    if (savedFlag) onSaved?.()
    onClose?.()
  }

  const handleEditSave = async (id, form) => {
    setBusyId(id)
    try {
      await updateReason(id, {
        label: form.label.trim(),
        description: form.description.trim(),
        color: form.color
      })
      markSaved()
      setEditingId(null)
      await load()
    } catch (err) {
      console.error('Error updating deactivation reason:', err)
      setError('No se pudo guardar el cambio.')
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleActive = async (reason) => {
    const confirmMsg = reason.isActive
      ? `¿Desactivar "${reason.label}"? Dejará de estar disponible para nuevas bajas.`
      : `¿Reactivar "${reason.label}"?`
    if (!window.confirm(confirmMsg)) return
    setBusyId(reason.id)
    try {
      await setReasonActive(reason.id, !reason.isActive)
      markSaved()
      await load()
    } catch (err) {
      console.error('Error toggling deactivation reason:', err)
      setError('No se pudo actualizar el estado.')
    } finally {
      setBusyId(null)
    }
  }

  const persistOrder = async (list) => {
    setBusyId('reorder')
    try {
      await reorderReasons(list.map(r => r.id))
      markSaved()
    } catch (err) {
      console.error('Error reordering deactivation reasons:', err)
      setError('No se pudo reordenar.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const handleMove = (index, direction) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= reasons.length) return
    const next = [...reasons]
    const [moved] = next.splice(index, 1)
    next.splice(targetIndex, 0, moved)
    setReasons(next)
    persistOrder(next)
  }

  const handleCreate = async () => {
    const label = newForm.label.trim()
    if (!label) return
    setCreating(true)
    setError(null)
    try {
      await createReason({
        label,
        description: newForm.description.trim(),
        color: newForm.color,
        sortOrder: reasons.length + 1
      })
      markSaved()
      setNewForm(EMPTY_FORM)
      await load()
    } catch (err) {
      console.error('Error creating deactivation reason:', err)
      setError('No se pudo crear el motivo.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Motivos de baja" size="lg">
      {!isSuperadmin ? (
        <p className="text-sm text-gray-500 py-4">
          Sin permiso para gestionar los motivos de baja.
        </p>
      ) : (
        <div className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {reasons.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">Todavía no hay motivos cargados.</p>
              ) : (
                reasons.map((reason, index) => (
                  <ReasonRow
                    key={reason.id}
                    reason={reason}
                    index={index}
                    total={reasons.length}
                    editing={editingId === reason.id}
                    busy={busyId === reason.id || busyId === 'reorder'}
                    onEdit={() => setEditingId(reason.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSave={(form) => handleEditSave(reason.id, form)}
                    onToggleActive={handleToggleActive}
                    onMoveUp={() => handleMove(index, -1)}
                    onMoveDown={() => handleMove(index, 1)}
                  />
                ))
              )}
            </div>
          )}

          {/* Create form */}
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
              Nuevo motivo
            </p>
            <div className="flex items-start gap-3">
              <input
                type="color"
                value={newForm.color}
                onChange={(e) => setNewForm(f => ({ ...f, color: e.target.value }))}
                className="w-10 h-10 mt-1 rounded-lg border border-gray-300 cursor-pointer shrink-0"
              />
              <div className="flex-1 space-y-2">
                <Input
                  label="Etiqueta"
                  placeholder="Ej: Mudanza"
                  value={newForm.label}
                  onChange={(e) => setNewForm(f => ({ ...f, label: e.target.value }))}
                />
                <Textarea
                  label="Descripción"
                  placeholder="Detalle opcional del motivo"
                  value={newForm.description}
                  onChange={(e) => setNewForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreate}
                loading={creating}
                disabled={!newForm.label.trim()}
              >
                <Plus className="w-4 h-4" />
                Agregar motivo
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={handleClose}>
              Cerrar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
