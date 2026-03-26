import { supabase } from '../supabase/client'
import {
  transformClientToDb,
  transformClientFromDb,
  transformUpdateToDb
} from './clientTransformers'

/**
 * Get all clients with nested data
 * @returns {Promise<Array>}
 */
export async function getClients() {
  const { data, error } = await supabase
    .from('clients_full')
    .select('*')
    .order('lastName', { ascending: true })

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
 * Delete a client (cascade deletes related records)
 * @param {string} id - Client UUID
 */
export async function deleteClient(id) {
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
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
 * Update client's recovery days available
 * @param {string} id - Client UUID
 * @param {number} days - New recovery days count
 * @returns {Promise<object>}
 */
export async function updateRecoveryDays(id, days) {
  const { error } = await supabase
    .from('clients')
    .update({ recovery_days_available: days })
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }

  return getClientById(id)
}
