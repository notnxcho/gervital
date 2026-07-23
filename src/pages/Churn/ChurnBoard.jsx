import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { getChurnBoard, updateChurnStage } from '../../services/churn/churnService'
import { applyDueReactivations } from '../../services/api'
import { getReasons } from '../../services/churn/deactivationReasonService'
import { useAuth } from '../../context/AuthContext'
import { STAGES } from './churnConstants'
import ChurnColumn from './ChurnColumn'
import ChurnCard from './ChurnCard'
import ChurnCardModal from './ChurnCardModal'
import ReasonsManagerModal from './ReasonsManagerModal'
import Button from '../../components/ui/Button'

// "Nueva baja" se muestra como bandeja horizontal arriba; el resto, como columnas.
const NEW_STAGE = STAGES.find(s => s.key === 'new')
const COLUMN_STAGES = STAGES.filter(s => s.key !== 'new')

export default function ChurnBoard() {
  const { user } = useAuth()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [draggedCard, setDraggedCard] = useState(null)
  const [selectedCard, setSelectedCard] = useState(null)
  const [reasonsByKey, setReasonsByKey] = useState({})
  const [managerOpen, setManagerOpen] = useState(false)
  const [daysFilterEnabled, setDaysFilterEnabled] = useState(false)
  const [maxDaysValue, setMaxDaysValue] = useState('30')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const loadBoard = useCallback(async () => {
    setLoading(true)
    try {
      // Self-heal: voltea a activo los reintegros programados cuya fecha ya llegó (no hay cron).
      await applyDueReactivations().catch(() => {})
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

  // Group cards by stage for rendering, hiding churns older than the selected threshold.
  const cardsByStage = useMemo(() => {
    const map = {}
    STAGES.forEach(s => { map[s.key] = [] })
    const maxDays = daysFilterEnabled && maxDaysValue ? Number(maxDaysValue) : null
    cards
      .filter(c => maxDays == null || c.daysSince == null || c.daysSince <= maxDays)
      .forEach(c => {
        if (map[c.stage]) map[c.stage].push(c)
        else map.new.push(c)
      })
    return map
  }, [cards, daysFilterEnabled, maxDaysValue])

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
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg">
            <button
              type="button"
              role="switch"
              aria-checked={daysFilterEnabled}
              onClick={() => setDaysFilterEnabled(v => !v)}
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${daysFilterEnabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${daysFilterEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
            </button>
            <span className={daysFilterEnabled ? 'text-gray-700' : 'text-gray-400'}>Ocultar más de</span>
            <input
              type="number"
              min="1"
              value={maxDaysValue}
              onChange={(e) => setMaxDaysValue(e.target.value)}
              disabled={!daysFilterEnabled}
              className="w-12 px-1 py-0.5 text-sm text-center border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100 disabled:text-gray-400"
            />
            <span className={daysFilterEnabled ? 'text-gray-700' : 'text-gray-400'}>días</span>
          </div>
          {user?.role === 'superadmin' && (
            <Button variant="secondary" size="sm" onClick={() => setManagerOpen(true)}>
              Gestionar motivos
            </Button>
          )}
        </div>
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
          {/* Bandeja de nuevas bajas: solo se muestra si hay. De acá se toman
              las tarjetas para asignarlas a la columna que corresponda. */}
          {NEW_STAGE && cardsByStage.new.length > 0 && (
            <div className="mb-6">
              <ChurnColumn
                horizontal
                stage={NEW_STAGE.key}
                label={NEW_STAGE.label}
                color={NEW_STAGE.color}
                cards={cardsByStage.new}
                onCardClick={setSelectedCard}
                reasonsByKey={reasonsByKey}
              />
            </div>
          )}

          <div className="flex gap-4 overflow-x-auto pb-4">
            {COLUMN_STAGES.map(stage => (
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
        onUpdated={loadBoard}
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
