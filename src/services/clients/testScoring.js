// Motor de scoring puro. answers = { [fieldName]: optionValue }.
export function computeScore(test, answers = {}) {
  const scoredFields = test.fields.filter(f => f.scored)
  let rawScore = 0
  let answeredCount = 0
  for (const field of scoredFields) {
    const value = answers[field.name]
    if (value == null || value === '') continue
    const option = field.options.find(o => o.value === value)
    if (option) {
      rawScore += option.score
      answeredCount += 1
    }
  }
  const isComplete = answeredCount === scoredFields.length
  const interpretationLabel = isComplete ? interpret(test, rawScore) : null
  return { rawScore, interpretationLabel, scoreVersion: test.scoring.scoreVersion, isComplete }
}

// Banda de interpretación cuyo [min,max] contiene el puntaje.
function interpret(test, rawScore) {
  const band = test.scoring.interpretation.find(b => rawScore >= b.min && rawScore <= b.max)
  return band ? band.label : null
}
