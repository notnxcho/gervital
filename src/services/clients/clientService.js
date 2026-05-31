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
