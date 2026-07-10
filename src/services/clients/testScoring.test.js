import { computeScore } from './testScoring'
import { getTestById } from './testsCatalog'

const lawton = getTestById('lawton_brody')
const barthel = getTestById('barthel')

describe('computeScore - Lawton & Brody', () => {
  test('all-independent answers sum to 8 and read as independiente', () => {
    const answers = {
      telefono: 'usa_iniciativa', compras: 'independiente', cocina: 'planea_prepara',
      tareas_hogar: 'solo_o_ayuda_tareas_pesadas', lavado_ropa: 'independiente',
      transporte: 'publico_o_conduce', medicacion: 'responsable', finanzas: 'independiente'
    }
    const res = computeScore(lawton, answers)
    expect(res.rawScore).toBe(8)
    expect(res.isComplete).toBe(true)
    expect(res.interpretationLabel).toBe('Independiente (mujer)')
    expect(res.scoreVersion).toBe('lawton_unisex_8')
  })

  test('incomplete answers → isComplete false, no interpretation', () => {
    const res = computeScore(lawton, { telefono: 'usa_iniciativa' })
    expect(res.isComplete).toBe(false)
    expect(res.rawScore).toBe(1)
    expect(res.interpretationLabel).toBeNull()
  })

  test('boundary: score 6 → dependencia leve', () => {
    const answers = {
      telefono: 'usa_iniciativa', compras: 'independiente', cocina: 'planea_prepara',
      tareas_hogar: 'solo_o_ayuda_tareas_pesadas', lavado_ropa: 'independiente',
      transporte: 'publico_o_conduce', medicacion: 'incapaz', finanzas: 'incapaz'
    }
    const res = computeScore(lawton, answers)
    expect(res.rawScore).toBe(6)
    expect(res.interpretationLabel).toBe('Dependencia leve')
  })
})

describe('computeScore - Barthel', () => {
  test('all-independent answers sum to 100 → Independiente', () => {
    const answers = {
      comer: 'independiente', lavarse: 'independiente', vestirse: 'independiente',
      arreglarse: 'independiente', deposiciones: 'continente', miccion: 'continente',
      uso_retrete: 'independiente', traslado: 'independiente', deambulacion: 'independiente',
      escaleras: 'independiente'
    }
    const res = computeScore(barthel, answers)
    expect(res.rawScore).toBe(100)
    expect(res.interpretationLabel).toBe('Independiente')
  })

  test('boundary: 90 → dependencia moderada', () => {
    const answers = {
      comer: 'independiente', lavarse: 'independiente', vestirse: 'independiente',
      arreglarse: 'independiente', deposiciones: 'continente', miccion: 'continente',
      uso_retrete: 'independiente', traslado: 'independiente', deambulacion: 'independiente',
      escaleras: 'dependiente'
    }
    const res = computeScore(barthel, answers)
    expect(res.rawScore).toBe(90)
    expect(res.interpretationLabel).toBe('Dependencia moderada')
  })
})
