import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowRight, ArrowLeft, Plus, Edit, Trash, Eye } from 'iconoir-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { TESTS_CATALOG, getMaxScore } from '../../services/clients/testsCatalog'
import { deleteTestInstance } from '../../services/api'
import TestInstanceModal from './TestInstanceModal'

function fmtDate(d) {
  return d ? format(new Date(`${d}T12:00:00`), 'd MMM yyyy', { locale: es }) : '—'
}

// Unidad del campo que aporta el puntaje manual (ej. TUG → "s").
function manualUnit(test) {
  const f = test.fields.find(x => x.name === test.scoring.manualScoreField)
  return f?.unit || ''
}

// Texto de resumen de una instancia según la forma del test.
function summarizeInstance(test, inst) {
  const maxScore = getMaxScore(test)
  if (inst.subscores && (test.scoring.subscales || test.id === 'tmt')) {
    if (test.id === 'tmt') {
      const a = inst.subscores.tmt_a?.score
      const b = inst.subscores.tmt_b?.score
      return `A ${a ?? '—'}s · B ${b ?? '—'}s`
    }
    const parts = (test.scoring.subscales || []).map(s => {
      const sub = inst.subscores[s.name]
      return `${s.label} ${sub?.score ?? '—'}/${s.max}`
    })
    if (inst.rawScore != null) parts.push(`Total ${inst.rawScore}${maxScore != null ? `/${maxScore}` : ''}`)
    return parts.join(' · ')
  }
  if (inst.rawScore != null) {
    const unit = manualUnit(test)
    const base = maxScore != null ? `${inst.rawScore}/${maxScore}` : `${inst.rawScore}${unit ? ` ${unit}` : ''}`
    return inst.interpretationLabel ? `${base} · ${inst.interpretationLabel}` : base
  }
  return inst.interpretationLabel || 's/puntaje'
}

// Serie temporal a graficar: total si existe; si no, depresión (Goldberg) o TMT-B.
function trendValues(list) {
  return list.map(i => {
    if (i.rawScore != null) return Number(i.rawScore)
    if (i.subscores?.depresion) return i.subscores.depresion.score
    if (i.subscores?.tmt_b) return i.subscores.tmt_b.score
    return null
  }).filter(v => v != null)
}

// Mini gráfico de evolución (pure SVG).
function ScoreTrend({ values, max }) {
  if (values.length < 2) return null
  const W = 320, H = 80, P = 8
  const top = max || Math.max(...values, 1)
  const xs = values.map((_, i) => P + (i * (W - 2 * P)) / (values.length - 1))
  const ys = values.map(v => H - P - ((v / top) * (H - 2 * P)))
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
  const [modal, setModal] = useState(null) // { mode, instance?, test? }
  const [pickerOpen, setPickerOpen] = useState(false)

  const instancesFor = (testId) => instances
    .filter(i => i.testId === testId)
    .sort((a, b) => (a.administeredAt < b.administeredAt ? 1 : -1)) // desc

  const selectedTest = TESTS_CATALOG.find(t => t.id === selectedTestId)
  const usedTests = TESTS_CATALOG.filter(t => instancesFor(t.id).length > 0)
  const availableTests = TESTS_CATALOG.filter(t => instancesFor(t.id).length === 0)

  // Test que alimenta el modal: el elegido en el drill-down, o el que se está agregando.
  const modalTest = modal?.test || selectedTest

  const handleDelete = async (instance) => {
    if (!window.confirm('¿Eliminar esta evaluación? No se puede deshacer.')) return
    try { await deleteTestInstance(instance.id); await onRefresh() }
    catch (e) { window.alert(e.message) }
  }

  const handlePick = (test) => {
    setPickerOpen(false)
    setModal({ mode: 'create', test })
  }

  // ── Contenido: lista o drill-down ──
  let content
  if (!selectedTest) {
    content = (
      <div className="space-y-3">
        {usedTests.length === 0 && (
          <p className="text-sm text-gray-400">Este cliente no tiene tests cargados todavía.</p>
        )}
        {usedTests.map(test => {
          const last = instancesFor(test.id)[0]
          return (
            <button
              key={test.id}
              onClick={() => setSelectedTestId(test.id)}
              className="w-full flex items-center justify-between rounded-xl border border-gray-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
            >
              <div>
                <p className="font-semibold text-gray-900">{test.name}</p>
                <p className="text-sm text-gray-500">{test.domain}</p>
                <p className="text-sm mt-1 text-gray-700">
                  Último: <span className="font-medium">{summarizeInstance(test, last)}</span> · {fmtDate(last.administeredAt)}
                </p>
              </div>
              <NavArrowRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
            </button>
          )
        })}

        {/* Card-botón: agregar test */}
        {canMutate && availableTests.length > 0 && (
          <button
            onClick={() => setPickerOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 p-4 text-sm font-medium text-gray-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/40 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Agregar test
          </button>
        )}
      </div>
    )
  } else {
    const list = instancesFor(selectedTest.id)
    const values = trendValues([...list].reverse())
    const trendMax = getMaxScore(selectedTest)
    content = (
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

        {values.length >= 2 && (
          <div className="mb-4 rounded-xl border border-gray-200 p-3">
            <p className="text-xs text-gray-500 mb-1">Evolución del puntaje</p>
            <ScoreTrend values={values} max={trendMax} />
          </div>
        )}

        {list.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">Sin evaluaciones. Agregá la primera con "Nueva evaluación".</p>
        ) : (
          <ul className="space-y-2">
            {list.map(inst => (
              <li key={inst.id} className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{summarizeInstance(selectedTest, inst)}</span>
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
      </div>
    )
  }

  return (
    <div>
      {content}

      {/* Selector de test a agregar (solo los que el cliente no tiene) */}
      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="Agregar test" size="md">
        <div className="space-y-2">
          {availableTests.length === 0 ? (
            <p className="text-sm text-gray-500">El cliente ya tiene todos los tests disponibles.</p>
          ) : (
            availableTests.map(test => (
              <button
                key={test.id}
                onClick={() => handlePick(test)}
                className="w-full flex items-center justify-between rounded-xl border border-gray-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
              >
                <div>
                  <p className="font-medium text-gray-900">{test.name}</p>
                  <p className="text-xs text-gray-500">{test.domain}</p>
                </div>
                <NavArrowRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </button>
            ))
          )}
        </div>
      </Modal>

      <TestInstanceModal
        isOpen={!!modal}
        onClose={() => setModal(null)}
        test={modalTest}
        clientId={clientId}
        instance={modal?.instance}
        mode={modal?.mode || 'create'}
        administeredBy={administeredBy}
        onSaved={async () => {
          const addedTestId = modal?.test?.id
          setModal(null)
          await onRefresh()
          // Al cargar la primera evaluación desde "Agregar test", entrar a su historial.
          if (addedTestId) setSelectedTestId(addedTestId)
        }}
      />
    </div>
  )
}
