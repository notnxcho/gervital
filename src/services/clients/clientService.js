import { supabase } from '../supabase/client'
import {
  transformClientToDb,
  transformClientFromDb,
  transformUpdateToDb
} from './clientTransformers'

/**
 * Get clients with nested data.
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false] - When true, include soft-deleted clients
 * @returns {Promise<Array>}
 */
export async function getClients({ includeDeleted = false } = {}) {
  let query = supabase
    .from('clients_full')
    .select('*')
    .order('lastName', { ascending: true })

  if (!includeDeleted) {
    query = query.is('deletedAt', null)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data.map(transformClientFromDb)
}

/**
 * Get a single client by ID
 * @param {string} id - Client UUID
 * @returns {Promise<object|null>}
 */
export async function getClientById(id) {
  const { data, error } = await supabase
    .from('clients_full')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return null // Not found
    }
    throw new Error(error.message)
  }

  return transformClientFromDb(data)
}

/**
 * Create a new client with all related data
 * @param {object} clientData - Client data in frontend format
 * @returns {Promise<object>}
 */
export async function createClient(clientData) {
  const params = transformClientToDb(clientData)

  const { data, error } = await supabase
    .rpc('create_client_full', params)

  if (error) {
    throw new Error(error.message)
  }

  // Fetch the created client with full data
  return getClientById(data)
}

/**
 * Update an existing client
 * @param {string} id - Client UUID
 * @param {object} clientData - Partial client data to update
 * @returns {Promise<object>}
 */
export async function updateClient(id, clientData) {
  const params = transformUpdateToDb(id, clientData)

  const { error } = await supabase
    .rpc('update_client_full', params)

  if (error) {
    throw new Error(error.message)
  }

  // Fetch the updated client with full data
  return getClientById(id)
}

/**
 * Update client address geocoding data (lat/lng)
 * @param {string} clientId - Client UUID
 * @param {number|null} latitude
 * @param {number|null} longitude
 */
export async function updateClientAddressCoords(clientId, latitude, longitude) {
  const { error } = await supabase
    .from('client_addresses')
    .update({ latitude, longitude })
    .eq('client_id', clientId)
  if (error) {
    console.warn('Failed to update address coords:', error.message)
  }
}

/**
 * Soft-delete a client with a reason and optional notes.
 * @param {string} id - Client UUID
 * @param {object} payload
 * @param {string} payload.reason - One of the discrete reasons enforced by the RPC
 * @param {string} [payload.notes] - Free-text notes (required when reason === 'other')
 * @param {string} payload.userId - UUID of the system user performing the action
 * @returns {Promise<object>} The updated client
 */
export async function deactivateClient(id, { reason, notes, userId }) {
  const { error } = await supabase.rpc('deactivate_client', {
    p_client_id: id,
    p_reason: reason,
    p_notes: notes || null,
    p_user_id: userId
  })

  if (error) {
    throw new Error(error.message)
  }

  return getClientById(id)
}

/**
 * Reactivate a soft-deleted client.
 * @param {string} id - Client UUID
 * @returns {Promise<object>} The updated client
 */
export async function reactivateClient(id) {
  const { error } = await supabase.rpc('reactivate_client', {
    p_client_id: id
  })

  if (error) {
    throw new Error(error.message)
  }

  return getClientById(id)
}

/**
 * Get all plan versions for a client, ascending by effectiveFrom
 * @param {string} clientId
 * @returns {Promise<Array>}
 */
export async function getClientPlanVersions(clientId) {
  const { data, error } = await supabase
    .from('client_plans')
    .select('id, effective_from, frequency, schedule, has_transport, assigned_days, distance_range')
    .eq('client_id', clientId)
    .order('effective_from', { ascending: true })

  if (error) throw new Error(error.message)

  return (data || []).map(v => ({
    id: v.id,
    effectiveFrom: v.effective_from,
    frequency: v.frequency,
    schedule: v.schedule,
    hasTransport: v.has_transport,
    assignedDays: v.assigned_days || [],
    distanceRange: v.distance_range
  }))
}

/**
 * Create or update the plan version effective from a given month
 * @param {string} clientId
 * @param {string} effectiveFrom - YYYY-MM-DD (truncated to month start server-side)
 * @param {object} plan - { frequency, schedule, hasTransport, assignedDays, distanceRange }
 * @param {string} createdBy - optional user name
 */
export async function setClientPlanVersion(clientId, effectiveFrom, plan, createdBy = null) {
  const { data, error } = await supabase.rpc('set_client_plan_version', {
    p_client_id: clientId,
    p_effective_from: effectiveFrom,
    p_frequency: plan.frequency,
    p_schedule: plan.schedule,
    p_has_transport: plan.hasTransport,
    p_assigned_days: plan.assignedDays,
    p_distance_range: plan.distanceRange ?? null,
    p_created_by: createdBy
  })
  if (error) throw new Error(error.message)
  return data
}
