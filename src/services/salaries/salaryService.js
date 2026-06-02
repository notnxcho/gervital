import { supabase } from '../supabase/client'

// Tipos discretos para costos puntuales (one_time)
export const SALARY_ONE_TIME_TYPES = [
  { value: 'aguinaldo', label: 'Aguinaldo' },
  { value: 'despido', label: 'Despido' },
  { value: 'licencia_vacacional', label: 'Licencia vacacional' },
  { value: 'liquidacion', label: 'Liquidación' },
  { value: 'otro', label: 'Otro' }
]

const SALARY_ONE_TIME_LABELS = SALARY_ONE_TIME_TYPES.reduce((acc, t) => {
  acc[t.value] = t.label
  return acc
}, {})

export function salaryOneTimeLabel(type) {
  return SALARY_ONE_TIME_LABELS[type] || type || ''
}

function mapRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    oneTimeType: row.one_time_type,
    concept: row.concept,
    description: row.description,
    amount: Number(row.amount),
    active: row.active,
    date: row.date,
    createdAt: row.created_at
  }
}

/**
 * Get all salaries (both recurring and one_time), newest first.
 * @returns {Promise<Array>}
 */
export async function getSalaries() {
  const { data, error } = await supabase
    .from('salaries')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data.map(mapRow)
}

/**
 * Create a salary entry.
 * @param {object} input - { kind, oneTimeType?, concept?, description?, amount, date? }
 */
export async function createSalary(input) {
  const payload = {
    kind: input.kind,
    one_time_type: input.kind === 'one_time' ? input.oneTimeType : null,
    concept: input.concept || null,
    description: input.description || null,
    amount: input.amount,
    date: input.kind === 'one_time' ? (input.date || null) : null,
    active: true
  }
  const { data, error } = await supabase
    .from('salaries')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return mapRow(data)
}

/**
 * Update a salary entry (partial).
 * @param {string} id
 * @param {object} input
 */
export async function updateSalary(id, input) {
  const payload = {}
  if (input.concept !== undefined) payload.concept = input.concept
  if (input.description !== undefined) payload.description = input.description
  if (input.amount !== undefined) payload.amount = input.amount
  if (input.oneTimeType !== undefined) payload.one_time_type = input.oneTimeType
  if (input.date !== undefined) payload.date = input.date
  if (input.active !== undefined) payload.active = input.active
  payload.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('salaries')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return mapRow(data)
}

/**
 * Deactivate a recurring salary (baja). Keeps the record for history.
 * @param {string} id
 */
export async function deactivateSalary(id) {
  return updateSalary(id, { active: false })
}

/**
 * Delete a salary entry permanently.
 * @param {string} id
 */
export async function deleteSalary(id) {
  const { error } = await supabase.from('salaries').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
