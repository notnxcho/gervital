import { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'iconoir-react'
import CarCard from './CarCard'
import { SortableClientChip, DragOverlayChip } from './ClientChip'
import { UNASSIGNED_COLOR } from '../../services/transport/transportConstants'
import { getNextCarColor } from '../../services/transport/transportService'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'

function UnassignedPool({ clientIds, clients }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'unassigned',
    data: { type: 'unassigned' }
  })

  const unassignedClients = clientIds.map(id => clients.get(id)).filter(Boolean)

  return (
    <div
      ref={setNodeRef}
      className={`p-3 border-b border-gray-200 sticky top-0 bg-white z-10 transition-colors ${
        isOver ? 'bg-gray-50' : ''
      }`}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Sin asignar ({clientIds.length})
      </p>
      <SortableContext items={clientIds} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-1.5">
          {unassignedClients.map(client => (
            <SortableClientChip
              key={client.id}
              client={client}
              color={UNASSIGNED_COLOR}
              noAddress={!client.latitude && !client.longitude}
            />
          ))}
        </div>
      </SortableContext>
      {clientIds.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-1">Todos asignados</p>
      )}
    </div>
  )
}

export default function CarAssignmentPanel({
  shiftState,
  onStateChange,
  clientsById
}) {
  const [activeClient, setActiveClient] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  function findContainer(clientId) {
    if (shiftState.unassigned.includes(clientId)) return 'unassigned'
    for (const car of shiftState.cars) {
      if ((car.memberIds || []).includes(clientId)) return car.id
    }
    return null
  }

  function getCarById(carId) {
    return shiftState.cars.find(c => c.id === carId)
  }

  function onDragStart({ active }) {
    const client = clientsById.get(active.id)
    if (client) setActiveClient(client)
  }

  function onDragOver({ active, over }) {
    if (!over) return

    const activeContainer = findContainer(active.id)
    let targetContainer
    const overData = over.data.current

    if (overData?.type === 'client') {
      targetContainer = findContainer(over.id)
    } else if (overData?.type === 'car') {
      targetContainer = overData.carId
    } else if (overData?.type === 'unassigned' || over.id === 'unassigned') {
      targetContainer = 'unassigned'
    }

    if (!targetContainer || activeContainer === targetContainer) return

    if (targetContainer !== 'unassigned') {
      const targetCar = getCarById(targetContainer)
      if (targetCar && (targetCar.memberIds || []).length >= targetCar.seatCount) {
        return
      }
    }

    onStateChange(prev => {
      const next = JSON.parse(JSON.stringify(prev))

      if (activeContainer === 'unassigned') {
        next.unassigned = next.unassigned.filter(id => id !== active.id)
      } else {
        const srcCar = next.cars.find(c => c.id === activeContainer)
        if (srcCar) srcCar.memberIds = srcCar.memberIds.filter(id => id !== active.id)
      }

      if (targetContainer === 'unassigned') {
        next.unassigned.push(active.id)
      } else {
        const destCar = next.cars.find(c => c.id === targetContainer)
        if (destCar) destCar.memberIds.push(active.id)
      }

      return next
    })
  }

  function onDragEnd() {
    setActiveClient(null)
  }

  function handleAddCar() {
    onStateChange(prev => ({
      ...prev,
      cars: [...prev.cars, {
        id: `temp-${Date.now()}`,
        name: `Auto ${prev.cars.length + 1}`,
        seatCount: 4,
        color: getNextCarColor(prev.cars),
        position: prev.cars.length,
        memberIds: []
      }]
    }))
  }

  function handleCarNameChange(carId, name) {
    onStateChange(prev => ({
      ...prev,
      cars: prev.cars.map(c => c.id === carId ? { ...c, name } : c)
    }))
  }

  function handleSeatCountChange(carId, seatCount) {
    onStateChange(prev => ({
      ...prev,
      cars: prev.cars.map(c => c.id === carId ? { ...c, seatCount } : c)
    }))
  }

  function handleDeleteCar(carId) {
    setDeleteConfirm(carId)
  }

  function confirmDeleteCar() {
    const carId = deleteConfirm
    setDeleteConfirm(null)
    onStateChange(prev => {
      const car = prev.cars.find(c => c.id === carId)
      const returnedMembers = car ? (car.memberIds || []) : []
      return {
        ...prev,
        cars: prev.cars.filter(c => c.id !== carId),
        unassigned: [...prev.unassigned, ...returnedMembers]
      }
    })
  }

  function getClientColor(clientId) {
    for (const car of shiftState.cars) {
      if ((car.memberIds || []).includes(clientId)) return car.color
    }
    return UNASSIGNED_COLOR
  }

  return (
    <div className="w-[340px] bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <UnassignedPool
          clientIds={shiftState.unassigned}
          clients={clientsById}
        />

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          {shiftState.cars.map(car => (
            <CarCard
              key={car.id}
              car={car}
              clients={clientsById}
              onNameChange={handleCarNameChange}
              onSeatCountChange={handleSeatCountChange}
              onDelete={handleDeleteCar}
            />
          ))}

          <button
            onClick={handleAddCar}
            className="w-full border border-dashed border-gray-300 rounded-lg py-2.5 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Agregar auto
          </button>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeClient && (
            <DragOverlayChip
              client={activeClient}
              color={getClientColor(activeClient.id)}
            />
          )}
        </DragOverlay>
      </DndContext>

      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Eliminar auto"
        size="sm"
      >
        <p className="text-gray-600 mb-6">
          Los asistentes de este auto volverán a "Sin asignar". ¿Continuar?
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={confirmDeleteCar}>Eliminar</Button>
        </div>
      </Modal>
    </div>
  )
}
