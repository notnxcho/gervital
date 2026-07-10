// Motor de scoring. answers = { [fieldName]: value }
// (enum → optionValue, boolean → bool, number → num, image → url).
export function computeScore(test, answers = {}) {
  const mode = (test.scoring || {}).mode || 'auto'
  return mode === 'manual' ? computeManual(test, answers) : computeAuto(test, answers)
}

const scoring = (test) => test.scoring || {}
const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function bandLabel(bands, value) {
  if (!bands || value == null) return null
  const b = bands.find(x => value >= x.min && value <= x.max)
  return b ? b.label : null
}

// Aporte de un campo scored al puntaje (null si no respondido).
function fieldScore(field, value) {
  if (value == null || value === '') return null
  if (field.type === 'enum') {
    const o = field.options.find(op => op.value === value)
    return o ? o.score : null
  }
  if (field.type === 'boolean') {
    const target = field.scoredAnswer ?? true
    return value === target ? 1 : 0
  }
  if (field.type === 'number') return num(value)
  return null
}

function computeAuto(test, answers) {
  const sc = scoring(test)
  const scored = test.fields.filter(f => f.scored)
  let total = 0
  let answered = 0
  const subAgg = {}
  for (const field of scored) {
    const s = fieldScore(field, answers[field.name])
    if (s == null) continue
    answered += 1
    total += s
    if (field.subscale) subAgg[field.subscale] = (subAgg[field.subscale] || 0) + s
  }
  const isComplete = answered === scored.length

  let subscores = null
  if (sc.subscales) {
    subscores = {}
    for (const sub of sc.subscales) {
      const score = subAgg[sub.name] || 0
      subscores[sub.name] = { score, max: sub.max, label: isComplete ? bandLabel(sub.interpretation, score) : null }
    }
  }

  // Hay total con bandas propias? (los de solo-subescala como Goldberg → sin total)
  const hasTotal = Boolean(sc.interpretation) || sc.producesTotal
  const rawScore = hasTotal ? total : null
  const interpretationLabel = hasTotal && isComplete ? bandLabel(sc.interpretation, total) : null
  return { rawScore, subscores, interpretationLabel, scoreVersion: sc.scoreVersion, isComplete }
}

function computeManual(test, answers) {
  const sc = scoring(test)

  // TMT: sin puntaje único; tiempos + derivados en subscores.
  if (test.id === 'tmt') {
    const a = num(answers.tmt_a_segundos)
    const b = num(answers.tmt_b_segundos)
    const subscores = {
      tmt_a: { score: a, max: null, label: null },
      tmt_b: { score: b, max: null, label: null },
      b_menos_a: { score: a != null && b != null ? b - a : null, max: null, label: null },
      ratio_b_a: { score: a ? b / a : null, max: null, label: null }
    }
    return { rawScore: null, subscores, interpretationLabel: null, scoreVersion: sc.scoreVersion, isComplete: a != null && b != null }
  }

  const value = num(answers[sc.manualScoreField])
  const isComplete = value != null

  // Reloj: banda (Shulman) solo si el sistema elegido es Shulman.
  if (test.id === 'test_reloj') {
    const label = isComplete && answers.sistema_puntuacion === 'shulman' ? bandLabel(sc.interpretation, value) : null
    return { rawScore: value, subscores: null, interpretationLabel: label, scoreVersion: sc.scoreVersion, isComplete }
  }

  const label = isComplete ? bandLabel(sc.interpretation, value) : null
  return { rawScore: value, subscores: null, interpretationLabel: label, scoreVersion: sc.scoreVersion, isComplete }
}
