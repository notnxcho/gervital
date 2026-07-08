import { transformClientToDb, transformUpdateToDb, transformClientFromDb } from './clientTransformers'

test('transformClientToDb maps new personal + medical + arrays', () => {
  const p = transformClientToDb({
    firstName: 'A', lastName: 'B',
    maritalStatus: 'casado', residenceType: 'familiar', livesWith: 'Hija',
    medicalInfo: { healthProvider: 'ASSE', character: 'introvertido', occupation: 'Docente' },
    medications: [{ name: 'X', schedule: 'AM', dose: '1', indicatedFor: 'y' }],
    diagnoses: [{ diagnosisType: 'demencia', behaviorDisorder: 'z' }],
    medicalHistory: [{ condition: 'cancer', comment: '2019' }]
  })
  expect(p.p_marital_status).toBe('casado')
  expect(p.p_residence_type).toBe('familiar')
  expect(p.p_lives_with).toBe('Hija')
  expect(p.p_health_provider).toBe('ASSE')
  expect(p.p_character).toBe('introvertido')
  expect(p.p_occupation).toBe('Docente')
  expect(p.p_medications).toEqual([{ name: 'X', schedule: 'AM', dose: '1', indicatedFor: 'y' }])
  expect(p.p_diagnoses).toEqual([{ diagnosisType: 'demencia', behaviorDisorder: 'z' }])
  expect(p.p_medical_history).toEqual([{ condition: 'cancer', comment: '2019' }])
})

test('transformClientToDb defaults arrays to empty and has no legacy medical params', () => {
  const p = transformClientToDb({ firstName: 'A', lastName: 'B' })
  expect(p.p_medications).toEqual([])
  expect(p.p_diagnoses).toEqual([])
  expect(p.p_medical_history).toEqual([])
  expect('p_med_dietary' in p).toBe(false)
  expect('p_med_is_diabetic' in p).toBe(false)
})

test('transformUpdateToDb includes arrays and new medical scalars when present', () => {
  const p = transformUpdateToDb('id-1', {
    maritalStatus: 'viudo',
    medicalInfo: { healthNotes: 'nota' },
    medications: [], diagnoses: [], medicalHistory: [{ condition: 'caidas', comment: '' }]
  })
  expect(p.p_marital_status).toBe('viudo')
  expect(p.p_health_notes).toBe('nota')
  expect(p.p_medications).toEqual([])
  expect(p.p_medical_history).toEqual([{ condition: 'caidas', comment: '' }])
})

test('transformClientFromDb defaults new collections', () => {
  const c = transformClientFromDb({ firstName: 'A', lastName: 'B' })
  expect(c.medications).toEqual([])
  expect(c.diagnoses).toEqual([])
  expect(c.medicalHistory).toEqual([])
  expect(c.medicalInfo.healthProvider).toBe('')
  expect(c.maritalStatus).toBe('')
})
