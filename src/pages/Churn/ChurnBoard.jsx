import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { getChurnBoard, updateChurnStage } from '../../services/churn/churnService'
import { getReasons } from '../../services/churn/deactivationReasonService'
import { useAuth } from '../../context/AuthContext'
import { STAGES } from './churnConstants'
import ChurnColumn from './ChurnColumn'
import ChurnCard from './ChurnCard'
import ChurnCardModal from './ChurnCardModal'
import ReasonsManagerModal from './ReasonsManagerModal'
import Button from '../../components/ui/Button'

export default function ChurnBoard() {
  const { user } = useAuth()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [draggedCard, setDraggedCard] = useState(null)
  const [selectedCard, setSelectedCard] = useState(null)
  const [reasonsByKey, setReasonsByKey] = useState({})
  const [managerOpen, setManagerOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const loadBoard = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getChurnBoard()
      setCards(data)
    } catch (err) {
      console.error('Error loading churn board:', err)
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadReasons = useCallback(async () => {
    try {
      const list = await getReasons({ includeInactive: true })
      setReasonsByKey(Object.fromEntries(list.map(r => [r.key, r])))
    } catch (err) {
      console.error('Error loading deactivation reasons:', err)
    }
  }, [])

  useEffect(() => {
    loadBoard()
    loadReasons()
  }, [loadBoard, loadReasons])

  // Group cards by stage for rendering.
  const cardsByStage = useMemo(() => {
    const map = {}
    STAGES.forEach(s => { map[s.key] = [] })
    cards.forEach(c => {
      if (map[c.stage]) map[c.stage].push(c)
      else map.new.push(c)
    })
    return map
  }, [cards])

  function handleDragStart({ active }) {
    const data = active.data.current
    if (data?.type === 'churn-card') {
      setDraggedCard(cards.find(c => c.clientId === data.clientId) || null)
    }
  }

  async function handleDragEnd({ active, over }) {
    const card = draggedCard
    setDraggedCard(null)

    if (!over || !card) return

    const activeData = active.data.current
    const overData = over.data.current
    if (activeData?.type !== 'churn-card' || overData?.type !== 'churn-column') return

    const newStage = overData.stage
    if (newStage === card.stage) return

    const { clientId } = card
    const prevStage = card.stage

    // Optimistic move. Reactivación ya no ocurre por drag: se hace desde el botón
    // "Reactivar cliente" del modal (que saca al cliente del tablero al recargar).
    setCards(prev => prev.map(c => c.clientId === clientId ? { ...c, stage: newStage } : c))
    try {
      await updateChurnStage(clientId, newStage)
    } catch (err) {
      console.error('Error updating churn stage:', err)
      setCards(prev => prev.map(c => c.clientId === clientId ? { ...c, stage: prevStage } : c))
    }
  }

  return (
    <div className="bg-gray-50 min-h-full -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Seguimiento de bajas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Recuperá clientes que se dieron de baja · disponible para todo el equipo
          </p>
        </div>
        {user?.role === 'superadmin' && (
          <Button variant="secondary" size="sm" onClick={() => setManagerOpen(true)}>
            Gestionar motivos
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : cards.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-base font-medium">No hay bajas registradas</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {STAGES.map(stage => (
              <ChurnColumn
                key={stage.key}
                stage={stage.key}
                label={stage.label}
                color={stage.color}
                cards={cardsByStage[stage.key]}
                onCardClick={setSelectedCard}
                reasonsByKey={reasonsByKey}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {draggedCard && (
              <div className="w-[214px] pointer-events-none">
                <ChurnCard card={draggedCard} overlay reasonsByKey={reasonsByKey} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      <ChurnCardModal
        card={selectedCard}
        isOpen={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        onReactivated={loadBoard}
        reasonsByKey={reasonsByKey}
      />

      <ReasonsManagerModal
        isOpen={managerOpen}
        onClose={() => setManagerOpen(false)}
        onSaved={() => { loadReasons(); loadBoard() }}
      />
    </div>
  )
}
