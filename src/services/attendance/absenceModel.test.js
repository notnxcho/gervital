import { deriveAbsence, dayStyle, dayTooltip, outcomePreview } from './absenceModel'

const TODAY = '2026-07-20'

describe('deriveAbsence', () => {
  test('injustificada (futuro, impago) → cobrable, sin crédito', () => {
    expect(deriveAbsence({ isJustified: false, date: '2026-08-01', today: TODAY, monthPaid: false }))
      .toEqual({ status: 'absent', isJustified: false, isChargeable: true, generatesCredit: false })
  })
  test('justificada hoy (impago) → cobrable, +crédito', () => {
    expect(deriveAbsence({ isJustified: true, date: TODAY, today: TODAY, monthPaid: false }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: true, generatesCredit: true })
  })
  test('justificada pasado (impago) → cobrable, +crédito', () => {
    expect(deriveAbsence({ isJustified: true, date: '2026-07-10', today: TODAY, monthPaid: false }).generatesCredit).toBe(true)
  })
  test('justificada futuro + mes pago → cobrable, +crédito', () => {
    expect(deriveAbsence({ isJustified: true, date: '2026-08-01', today: TODAY, monthPaid: true }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: true, generatesCredit: true })
  })
  test('justificada futuro + mes NO pago → no cobrable, sin crédito', () => {
    expect(deriveAbsence({ isJustified: true, date: '2026-08-01', today: TODAY, monthPaid: false }))
      .toEqual({ status: 'absent', isJustified: true, isChargeable: false, generatesCredit: false })
  })
})

describe('dayStyle', () => {
  test('injustificada = rojo fuerte', () => {
    expect(dayStyle('absent', false, true)).toBe('bg-red-500 text-white')
  })
  test('justificada cobrable = rojo claro', () => {
    expect(dayStyle('absent', true, true)).toBe('bg-red-300 text-white')
  })
  test('justificada no cobrable = naranja', () => {
    expect(dayStyle('absent', true, false)).toBe('bg-orange-400 text-white')
  })
  test('attended/recovery/scheduled sin cambios', () => {
    expect(dayStyle('attended', false, true)).toBe('bg-green-500 text-white')
    expect(dayStyle('recovery', false, true)).toBe('bg-blue-500 text-white')
    expect(dayStyle('scheduled', false, true)).toBe('bg-gray-200 text-gray-600')
  })
})

describe('dayTooltip', () => {
  test('justificada cobrable → +1 recupero, con motivo', () => {
    expect(dayTooltip('absent', true, true, 'Enfermo/a'))
      .toEqual({ title: 'Falta justificada (+1 recupero)', reason: 'Enfermo/a' })
  })
  test('justificada no cobrable → no cobrable', () => {
    expect(dayTooltip('absent', true, false, null))
      .toEqual({ title: 'Falta justificada (no cobrable)', reason: null })
  })
  test('injustificada', () => {
    expect(dayTooltip('absent', false, true, null))
      .toEqual({ title: 'Falta no justificada', reason: null })
  })
})

describe('outcomePreview', () => {
  test('injustificada', () => {
    expect(outcomePreview({ isJustified: false, date: TODAY, today: TODAY, monthPaid: false }))
      .toBe('Se cobra el día igual. Sin crédito de recupero.')
  })
  test('justificada con crédito', () => {
    expect(outcomePreview({ isJustified: true, date: TODAY, today: TODAY, monthPaid: false }))
      .toBe('Se cobra el día y se acredita 1 día de recupero.')
  })
  test('justificada sin crédito (futuro impago)', () => {
    expect(outcomePreview({ isJustified: true, date: '2026-08-01', today: TODAY, monthPaid: false }))
      .toBe('No se cobra el día (sin recupero).')
  })
})
