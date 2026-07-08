import { slugify } from './deactivationReasonService'

test('slugify normaliza a snake_case ascii', () => {
  expect(slugify('Pausa temporal no retomada')).toBe('pausa_temporal_no_retomada')
  expect(slugify('Institucionalización')).toBe('institucionalizacion')
  expect(slugify('  Otro / sin especificar ')).toBe('otro_sin_especificar')
})
