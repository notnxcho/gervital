import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowRight, ArrowLeft, Plus, Edit, Trash, Eye } from 'iconoir-react'
import Button from '../../components/ui/Button'
import { TESTS_CATALOG, getMaxScore } from '../../services/clients/testsCatalog'
import { deleteTestInstance } from '../../services/api'
import TestInstanceModal from './TestInstanceModal'

function fmtDate(d) {
  return d ? format(new Date(`${d}T12:00:00`), 'd MMM yyyy', { locale: es }) : '—'
}

// Mini gráfico de evolución del puntaje (pure SVG). points asc por fecha.
function ScoreTrend({ points, maxScore }) {
  if (points.length < 2) return null
  const W = 320, H = 80, P = 8
  const xs = points.map((_, i) => P + (i * (W - 2 * P)) / (points.length - 1))
  const ys = points.map(p => H - P - ((p.score / maxScore) * (H - 2 * P)))
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20">
      <path d={path} fill="none" stroke="#4f46e5" strokeWidth="2" />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="3" fill="#4f46e5" />)}
    </svg>
  )
}

export default function ClientTests({ clientId, instances, administeredBy, canMutate, onRefresh }) {
  const [selectedTestId, setSelectedTestId] = useState(null)
  const [modal, setModal] = useState(null) // { mode, instance? }

  const selectedTest = TESTS_CATALOG.find(t => t.id === selectedTestId)
  const instancesFor = (testId) => instances
    .filter(i => i.testId === testId)
    .sort((a, b) => (a.administeredAt < b.administeredAt ? 1 : -1)) // desc

  const handleDelete = async (instance) => {
    if (!window.confirm('¿Eliminar esta evaluación? No se puede deshacer.')) return
    try { await deleteTestInstance(instance.id); await onRefresh() }
    catch (e) { window.alert(e.message) }
  }

  // ── Vista lista ──
  if (!selectedTest) {
    return (
      <div className="space-y-3">
        {TESTS_CATALOG.map(test => {
          const list = instancesFor(test.id)
          const last = list[0]
          const maxScore = getMaxScore(test)
          return (
            <button
              key={test.id}
              onClick={() => setSelectedTestId(test.id)}
              className="w-full flex items-center justify-between rounded-xl border border-gray-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
            >
              <div>
                <p className="font-semibold text-gray-900">{test.name}</p>
                <p className="text-sm text-gray-500">{test.domain}</p>
                <p className="text-sm mt-1">
                  {last
                    ? <span className="text-gray-700">Último: <span className="font-medium">{last.rawScore}/{maxScore}</span> · {last.interpretationLabel || 's/interpretación'} · {fmtDate(last.administeredAt)}</span>
                    : <span className="text-gray-400">Sin evaluaciones</span>}
                </p>
              </div>
              <NavArrowRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
            </button>
          )
        })}
      </div>
    )
  }

  // ── Drill-down de un test ──
  const list = instancesFor(selectedTest.id)
  const maxScore = getMaxScore(selectedTest)
  const trendPoints = [...list].reverse().map(i => ({ score: Number(i.rawScore) }))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setSelectedTestId(null)} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        {canMutate && (
          <Button size="sm" onClick={() => setModal({ mode: 'create' })}>
            <Plus className="w-4 h-4" /> Nueva evaluación
          </Button>
        )}
      </div>

      <div className="mb-4">
        <h3 className="font-semibold text-gray-900">{selectedTest.name}</h3>
        <p className="text-sm text-gray-500">{selectedTest.domain} · {selectedTest.scoring.range}</p>
      </div>

      {trendPoints.length >= 2 && (
        <div className="mb-4 rounded-xl border border-gray-200 p-3">
          <p className="text-xs text-gray-500 mb-1">Evolución del puntaje</p>
          <ScoreTrend points={trendPoints} maxScore={maxScore} />
        </div>
      )}

      {list.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Sin evaluaciones. Agregá la primera con "Nueva evaluación".</p>
      ) : (
        <ul className="space-y-2">
          {list.map(inst => (
            <li key={inst.id} className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{inst.rawScore}/{maxScore}</span>
                  {inst.interpretationLabel && <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">{inst.interpretationLabel}</span>}
                  {inst.isGenesis && <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Inicial</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{fmtDate(inst.administeredAt)}{inst.administeredBy ? ` · ${inst.administeredBy}` : ''}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setModal({ mode: 'view', instance: inst })} className="p-1.5 text-gray-400 hover:text-gray-700" title="Ver"><Eye className="w-4 h-4" /></button>
                {canMutate && <button onClick={() => setModal({ mode: 'edit', instance: inst })} className="p-1.5 text-gray-400 hover:text-indigo-600" title="Editar"><Edit className="w-4 h-4" /></button>}
                {canMutate && <button onClick={() => handleDelete(inst)} className="p-1.5 text-gray-400 hover:text-red-600" title="Eliminar"><Trash className="w-4 h-4" /></button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <TestInstanceModal
        isOpen={!!modal}
        onClose={() => setModal(null)}
        test={selectedTest}
        clientId={clientId}
        instance={modal?.instance}
        mode={modal?.mode || 'create'}
        administeredBy={administeredBy}
        onSaved={async () => { setModal(null); await onRefresh() }}
      />
    </div>
  )
}
