import { supabase } from '../supabase/client'

/**
 * Churn follow-up board: one row per client in the churn pipeline.
 * @returns {Promise<Array>} rows mapped to camelCase
 */
export async function getChurnBoard() {
  const { data, error } = await supabase.rpc('get_churn_board')

  if (error) throw new Error(error.message)

  return (data || []).map(r => ({
    clientId: r.client_id,
    firstName: r.first_name,
    lastName: r.last_name,
    cognitiveLevel: r.cognitive_level,
    frequency: r.frequency,
    schedule: r.schedule,
    stage: r.stage,
    reason: r.reason,
    deactivationDate: r.deactivation_date,
    mrrSnapshot: Number(r.mrr_snapshot) || 0,
    assignedTo: r.assigned_to,
    assignedName: r.assigned_name,
    daysSince: r.days_since,
    noteCount: Number(r.note_count) || 0,
    isCurrentlyInactive: !!r.is_currently_inactive,
    updatedAt: r.updated_at
  }))
}

/**
 * Move a follow-up to a new pipeline stage.
 * @param {string} clientId
 * @param {'new'|'contacting'|'negotiating'|'temporary_pause'|'lost'} stage
 */
export async function updateChurnStage(clientId, stage) {
  const { error } = await supabase
    .from('churn_followups')
    .update({ stage })
    .eq('client_id', clientId)

  if (error) throw new Error(error.message)
}

/**
 * Assign a follow-up to a system user.
 * @param {string} clientId
 * @param {string|null} userId
 */
export async function assignChurn(clientId, userId) {
  const { error } = await supabase
    .from('churn_followups')
    .update({ assigned_to: userId })
    .eq('client_id', clientId)

  if (error) throw new Error(error.message)
}

/**
 * Notes for a churn follow-up, newest first.
 * @param {string} clientId
 * @returns {Promise<Array<{id, body, createdAt, authorId, authorName}>>}
 */
export async function getChurnNotes(clientId) {
  const { data, error } = await supabase
    .from('churn_followup_notes')
    .select('id, body, created_at, author_id, author:users(name)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  return (data || []).map(n => ({
    id: n.id,
    body: n.body,
    createdAt: n.created_at,
    authorId: n.author_id,
    authorName: n.author?.name || null
  }))
}

/**
 * Add a note to a churn follow-up.
 * @param {string} clientId
 * @param {string} authorId
 * @param {string} body
 */
export async function addChurnNote(clientId, authorId, body) {
  const { error } = await supabase
    .from('churn_followup_notes')
    .insert({ client_id: clientId, author_id: authorId, body })

  if (error) throw new Error(error.message)
}

/**
 * Update the body of a churn follow-up note.
 * @param {string} noteId
 * @param {string} body
 */
export async function updateChurnNote(noteId, body) {
  const { error } = await supabase
    .from('churn_followup_notes')
    .update({ body })
    .eq('id', noteId)

  if (error) throw new Error(error.message)
}

/**
 * Delete a churn follow-up note.
 * @param {string} noteId
 */
export async function deleteChurnNote(noteId) {
  const { error } = await supabase
    .from('churn_followup_notes')
    .delete()
    .eq('id', noteId)

  if (error) throw new Error(error.message)
}
