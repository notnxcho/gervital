import { MARITAL_STATUS_OPTIONS, RESIDENCE_TYPE_OPTIONS, CHARACTER_OPTIONS, DIAGNOSIS_TYPE_OPTIONS, MEDICAL_HISTORY_CONDITIONS } from './medicalConstants'

test('every option has value and label', () => {
  const all = [...MARITAL_STATUS_OPTIONS, ...RESIDENCE_TYPE_OPTIONS, ...CHARACTER_OPTIONS, ...DIAGNOSIS_TYPE_OPTIONS, ...MEDICAL_HISTORY_CONDITIONS]
  all.forEach(o => {
    expect(typeof o.value).toBe('string')
    expect(o.value.length).toBeGreaterThan(0)
    expect(typeof o.label).toBe('string')
    expect(o.label.length).toBeGreaterThan(0)
  })
})

test('medical history has the 17 canonical conditions', () => {
  expect(MEDICAL_HISTORY_CONDITIONS.map(c => c.value)).toEqual([
    'diabetes','celiaquia','hipertension','intolerancia_lactosa','dislipidemia',
    'cardiovascular','acv','demencia','cancer','caidas','fracturas','cirugia',
    'hospitalizacion','tuberculosis','hepatitis','alergias','restriccion_alimenticia'
  ])
})
