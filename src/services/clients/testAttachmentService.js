import { supabase } from '../supabase/client'

const BUCKET = 'test-attachments'
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Sube una imagen adjunta de test y devuelve su URL pública.
// path = clientId/timestamp.ext (cada instancia conserva su propia imagen).
export async function uploadTestAttachment(clientId, file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no soportado. Usa JPG, PNG o WebP.')
  }
  if (file.size > MAX_SIZE) {
    throw new Error('La imagen no puede superar los 5MB.')
  }

  const ext = file.name.split('.').pop().toLowerCase()
  const path = `${clientId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false })
  if (error) throw new Error('Error subiendo la imagen: ' + error.message)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
