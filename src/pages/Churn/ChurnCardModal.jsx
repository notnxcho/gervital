import { useState, useEffect, useCallback } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { Edit, Trash, Check, Xmark } from 'iconoir-react'
import { useAuth } from '../../context/AuthContext'
import { getChurnNotes, addChurnNote, updateChurnNote, deleteChurnNote } from '../../services/churn/churnService'
import { reactivateClient } from '../../services/clients/clientService'
import { formatCurrency } from '../../utils/format'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { STAGE_LABEL, planSubtitle } from './churnConstants'

// A single labeled field in the details grid.
function Field({ label, value, valueClass = 'text-gray-900' }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${valueClass}`}>{value}</p>
    </div>
  )
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return format(new Date(iso), "d 'de' MMMM yyyy", { locale: es })
  } catch {
    return '—'
  }
}

function fmtRelative(iso) {
  if (!iso) return ''
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es })
  } catch {
    return ''
  }
}

export default function ChurnCardModal({ card, isOpen, onClose, onReactivated, reasonsByKey = {} }) {
  const { user, hasAccess } = useAuth()
  const [notes, setNotes] = useState([])
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editBody, setEditBody] = useState('')
  const [busyNoteId, setBusyNoteId] = useState(null)

  const clientId = card?.clientId

  const loadNotes = useCallback(async (id) => {
    setLoadingNotes(true)
    try {
      const data = await getChurnNotes(id)
      setNotes(data)
    } catch (err) {
      console.error('Error loading churn notes:', err)
      setNotes([])
    } finally {
      setLoadingNotes(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen && clientId) {
      setBody('')
      setEditingId(null)
      setEditBody('')
      loadNotes(clientId)
    }
  }, [isOpen, clientId, loadNotes])

  if (!card) return null

  const reasonCfg = reasonsByKey[card.reason] || { label: card.reason || 'Sin motivo', color: '#94a3b8', description: '' }

  const handleAddNote = async () => {
    const trimmed = body.trim()
    if (!trimmed || !user?.id) return
    setSaving(true)
    try {
      await addChurnNote(clientId, user.id, trimmed)
      setBody('')
      await loadNotes(clientId)
    } catch (err) {
      console.error('Error adding churn note:', err)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (note) => {
    setEditingId(note.id)
    setEditBody(note.body)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditBody('')
  }

  const handleSaveEdit = async (noteId) => {
    const trimmed = editBody.trim()
    if (!trimmed) return
    setBusyNoteId(noteId)
    try {
      await updateChurnNote(noteId, trimmed)
      cancelEdit()
      await loadNotes(clientId)
    } catch (err) {
      console.error('Error updating churn note:', err)
    } finally {
      setBusyNoteId(null)
    }
  }

  const handleDeleteNote = async (noteId) => {
    const ok = window.confirm('¿Eliminar esta nota? Esta acción no se puede deshacer.')
    if (!ok) return
    setBusyNoteId(noteId)
    try {
      await deleteChurnNote(noteId)
      if (editingId === noteId) cancelEdit()
      await loadNotes(clientId)
    } catch (err) {
      console.error('Error deleting churn note:', err)
    } finally {
      setBusyNoteId(null)
    }
  }

  const handleReactivate = async () => {
    const ok = window.confirm(
      `¿Reactivar a ${card.firstName} ${card.lastName}? El cliente volverá a estar activo.`
    )
    if (!ok) return
    setReactivating(true)
    try {
      await reactivateClient(clientId)
      onReactivated?.()
      onClose()
    } catch (err) {
      console.error('Error reactivating client:', err)
    } finally {
      setReactivating(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${card.firstName} ${card.lastName}`}
      size="lg"
    >
      <div className="space-y-5">
        {/* Plan subtitle */}
        {planSubtitle(card) && (
          <p className="text-sm text-gray-500 -mt-1">{planSubtitle(card)}</p>
        )}

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Motivo"
            value={<span title={reasonCfg.description || ''}>{reasonCfg.label}</span>}
            valueClass=""
          />
          <Field label="Fecha de baja" value={fmtDate(card.deactivationDate)} />
          <Field
            label="Días desde baja"
            value={card.daysSince != null ? `${card.daysSince} días` : '—'}
          />
          {hasAccess('billing') && (
            <Field
              label="MRR perdido"
              value={card.mrrSnapshot != null ? `−${formatCurrency(card.mrrSnapshot)}` : '—'}
              valueClass="text-rose-600"
            />
          )}
          <Field label="Etapa actual" value={STAGE_LABEL[card.stage] || '—'} />
        </div>

        {/* Notes history */}
        <div>
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">
            Notas
          </p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {loadingNotes ? (
              <div className="flex items-center justify-center py-6">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600" />
              </div>
            ) : notes.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">Todavía no hay notas.</p>
            ) : (
              notes.map(note => {
                const canManage = !!user?.id && note.authorId === user.id
                const isEditing = editingId === note.id
                const noteBusy = busyNoteId === note.id
                return (
                  <div key={note.id} className="group bg-gray-50 border border-gray-100 rounded-xl p-3">
                    {isEditing ? (
                      <>
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={3}
                          autoFocus
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                        />
                        <div className="flex justify-end gap-1.5 mt-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={noteBusy}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                          >
                            <Xmark width={14} height={14} /> Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(note.id)}
                            disabled={noteBusy || !editBody.trim()}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-600 rounded-lg hover:bg-indigo-50 disabled:opacity-50"
                          >
                            <Check width={14} height={14} /> Guardar
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-gray-800 whitespace-pre-wrap flex-1">{note.body}</p>
                          {canManage && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <button
                                type="button"
                                onClick={() => startEdit(note)}
                                disabled={noteBusy}
                                title="Editar nota"
                                className="p-1 text-gray-400 rounded-md hover:bg-gray-200 hover:text-gray-600 disabled:opacity-50"
                              >
                                <Edit width={14} height={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteNote(note.id)}
                                disabled={noteBusy}
                                title="Eliminar nota"
                                className="p-1 text-gray-400 rounded-md hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                              >
                                <Trash width={14} height={14} />
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
                          <span className="font-medium text-gray-500">{note.authorName || 'Sistema'}</span>
                          <span>·</span>
                          <span>{fmtRelative(note.createdAt)}</span>
                        </div>
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Add note */}
        <div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Agregar una nota de seguimiento..."
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
          <div className="flex justify-end mt-2">
            <Button
              variant="secondary"
              onClick={handleAddNote}
              disabled={!body.trim() || saving}
              loading={saving}
            >
              Agregar nota
            </Button>
          </div>
        </div>

        {/* Reactivate */}
        <div className="flex justify-end pt-3 border-t border-gray-100">
          <Button
            variant="success"
            onClick={handleReactivate}
            loading={reactivating}
          >
            Reactivar cliente
          </Button>
        </div>
      </div>
    </Modal>
  )
}
