import { computeScore } from './testScoring'
import { getTestById } from './testsCatalog'

test('Pfeiffer cuenta errores (scoredAnswer:false)', () => {
  const t = getTestById('pfeiffer_spmsq')
  const answers = {
    q1_fecha_hoy: true, q2_dia_semana: true, q3_lugar: true, q4_telefono_direccion: true,
    q5_edad: true, q6_fecha_nacimiento: true, q7_presidente_actual: true, q8_presidente_anterior: true,
    q9_apellido_madre: false, q10_resta_seriada: false
  }
  const r = computeScore(t, answers)
  expect(r.rawScore).toBe(2)
  expect(r.isComplete).toBe(true)
  expect(r.interpretationLabel).toBe('Normal')
})

test('Yesavage respeta la dirección de puntuación por ítem', () => {
  const t = getTestById('yesavage_gds')
  const answers = {}
  t.fields.filter(f => f.scored).forEach(f => { answers[f.name] = f.scoredAnswer })
  const r = computeScore(t, answers)
  expect(r.rawScore).toBe(15)
  expect(r.interpretationLabel).toBe('Depresión severa')
})

test('Goldberg: dos subescalas independientes, sin total', () => {
  const t = getTestById('goldberg')
  const answers = {}
  t.fields.forEach(f => { answers[f.name] = f.subscale === 'ansiedad' })
  const r = computeScore(t, answers)
  expect(r.rawScore).toBeNull()
  expect(r.subscores.ansiedad.score).toBe(9)
  expect(r.subscores.depresion.score).toBe(0)
  expect(r.subscores.ansiedad.label).toMatch(/probable/i)
  expect(r.subscores.depresion.label).toMatch(/poco probable/i)
})

test('Tinetti: subtotales + total + banda', () => {
  const t = getTestById('tinetti')
  const answers = {}
  t.fields.filter(f => f.scored).forEach(f => { answers[f.name] = String(Math.max(...f.options.map(o => o.score))) })
  const r = computeScore(t, answers)
  expect(r.subscores.equilibrio.score).toBe(16)
  expect(r.subscores.marcha.score).toBe(10)
  expect(r.rawScore).toBe(26)
  expect(r.interpretationLabel).toBe('Riesgo de caídas bajo')
})

test('Berg suma 0-56', () => {
  const t = getTestById('berg')
  const answers = {}
  t.fields.forEach(f => { answers[f.name] = '4' })
  const r = computeScore(t, answers)
  expect(r.rawScore).toBe(56)
  expect(r.interpretationLabel).toMatch(/Bajo riesgo/i)
})

test('TUG banda por segundos', () => {
  const t = getTestById('tug')
  expect(computeScore(t, { tiempo_segundos: 8 }).interpretationLabel).toMatch(/Normal/i)
  expect(computeScore(t, { tiempo_segundos: 15 }).interpretationLabel).toMatch(/riesgo/i)
  expect(computeScore(t, { tiempo_segundos: 8 }).rawScore).toBe(8)
})

test('Reloj: banda Shulman solo si el sistema es Shulman', () => {
  const t = getTestById('test_reloj')
  expect(computeScore(t, { puntaje_manual: 5, sistema_puntuacion: 'shulman' }).interpretationLabel).toBe('Normal')
  expect(computeScore(t, { puntaje_manual: 2, sistema_puntuacion: 'moca_cdt' }).interpretationLabel).toBeNull()
})

test('TMT derivados sin banda', () => {
  const t = getTestById('tmt')
  const r = computeScore(t, { tmt_a_segundos: 30, tmt_b_segundos: 90 })
  expect(r.subscores.b_menos_a.score).toBe(60)
  expect(r.subscores.ratio_b_a.score).toBeCloseTo(3)
  expect(r.interpretationLabel).toBeNull()
  expect(r.isComplete).toBe(true)
})
