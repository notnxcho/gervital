import { supabase } from '../supabase/client'

// Fila DB → objeto camelCase de frontend.
function fromDb(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    testId: row.test_id,
    administeredAt: row.administered_at,
    administeredBy: row.administered_by,
    isGenesis: row.is_genesis,
    answers: row.answers || {},
    rawScore: row.raw_score,
    subscores: row.subscores || null,
    interpretationLabel: row.interpretation_label,
    scoreVersion: row.score_version,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// Payload de frontend → columnas DB (sin client_id, que va aparte en create).
function toDb(payload) {
  return {
    test_id: payload.testId,
    administered_at: payload.administeredAt,
    administered_by: payload.administeredBy ?? null,
    is_genesis: payload.isGenesis ?? false,
    answers: payload.answers ?? {},
    raw_score: payload.rawScore ?? null,
    subscores: payload.subscores ?? null,
    interpretation_label: payload.interpretationLabel ?? null,
    score_version: payload.scoreVersion ?? null,
    notes: payload.notes ?? null
  }
}

export async function getClientTestInstances(clientId) {
  const { data, error } = await supabase
    .from('client_test_instances')
    .select('*')
    .eq('client_id', clientId)
    .order('administered_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data.map(fromDb)
}

export async function createTestInstance(clientId, payload) {
  const { data, error } = await supabase
    .from('client_test_instances')
    .insert({ client_id: clientId, ...toDb(payload) })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return fromDb(data)
}

export async function updateTestInstance(id, payload) {
  const { data, error } = await supabase
    .from('client_test_instances')
    .update({ ...toDb(payload), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return fromDb(data)
}

export async function deleteTestInstance(id) {
  const { error } = await supabase.from('client_test_instances').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
