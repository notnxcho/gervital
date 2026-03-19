import { supabase } from '../supabase/client'

const BUCKET = 'client-avatars'
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Upload a client avatar to Supabase Storage
 * @param {string} clientId
 * @param {File} file
 * @returns {Promise<string>} Public URL of the uploaded avatar
 */
export async function uploadClientAvatar(clientId, file) {
  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no soportado. Usa JPG, PNG o WebP.')
  }

  // Validate file size
  if (file.size > MAX_SIZE) {
    throw new Error('La imagen no puede superar los 5MB.')
  }

  const ext = file.name.split('.').pop().toLowerCase()
  const path = `${clientId}/avatar.${ext}`

  // Remove existing avatar files for this client (different extensions)
  try {
    const { data: existing } = await supabase.storage
      .from(BUCKET)
      .list(clientId)

    if (existing && existing.length > 0) {
      const filesToRemove = existing.map(f => `${clientId}/${f.name}`)
      await supabase.storage.from(BUCKET).remove(filesToRemove)
    }
  } catch {
    // Ignore cleanup errors
  }

  // Upload new avatar
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true })

  if (uploadError) {
    throw new Error('Error subiendo la imagen: ' + uploadError.message)
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path)

  const publicUrl = urlData.publicUrl + '?t=' + Date.now()

  // Update client record with avatar URL
  const { error: updateError } = await supabase
    .from('clients')
    .update({ avatar_url: publicUrl })
    .eq('id', clientId)

  if (updateError) {
    throw new Error('Error actualizando el cliente: ' + updateError.message)
  }

  return publicUrl
}

/**
 * Delete a client's avatar from storage and clear the URL
 * @param {string} clientId
 */
export async function deleteClientAvatar(clientId) {
  // List and remove all files in client's folder
  const { data: existing } = await supabase.storage
    .from(BUCKET)
    .list(clientId)

  if (existing && existing.length > 0) {
    const filesToRemove = existing.map(f => `${clientId}/${f.name}`)
    await supabase.storage.from(BUCKET).remove(filesToRemove)
  }

  // Clear avatar_url in DB
  const { error } = await supabase
    .from('clients')
    .update({ avatar_url: null })
    .eq('id', clientId)

  if (error) {
    throw new Error('Error actualizando el cliente: ' + error.message)
  }
}
