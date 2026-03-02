import { supabase } from '../supabase/client'

/**
 * Get all system users
 * @returns {Promise<Array>}
 */
export async function getUsers() {
  const { data, error } = await supabase
    .from('users_view')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Get user by ID
 * @param {string} id - User UUID
 * @returns {Promise<object|null>}
 */
export async function getUserById(id) {
  const { data, error } = await supabase
    .from('users_view')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw new Error(error.message)
  }

  return data
}

/**
 * Create a new user
 * Note: This creates the user in Supabase Auth, which triggers
 * the handle_new_user function to create the profile
 * @param {object} userData - { name, email, role, password }
 * @returns {Promise<object>}
 */
export async function createUser(userData) {
  // Create user in Supabase Auth with metadata
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: userData.email,
    password: userData.password || generateTempPassword(),
    email_confirm: true,
    user_metadata: {
      name: userData.name,
      role: userData.role
    }
  })

  if (authError) {
    // If admin API fails, try regular signup (for development)
    // This won't work in production without proper admin setup
    throw new Error(authError.message)
  }

  // The trigger should have created the user profile
  // Wait a moment for the trigger to complete
  await new Promise(resolve => setTimeout(resolve, 500))

  // Fetch the created user
  const { data: user, error: fetchError } = await supabase
    .from('users_view')
    .select('*')
    .eq('authId', authData.user.id)
    .single()

  if (fetchError) {
    throw new Error('Usuario creado pero no se pudo recuperar el perfil')
  }

  return user
}

/**
 * Update a user
 * @param {string} id - User UUID (public.users.id, not auth.users.id)
 * @param {object} userData - { name, email, role }
 * @returns {Promise<object>}
 */
export async function updateUser(id, userData) {
  const updateData = {}

  if (userData.name !== undefined) updateData.name = userData.name
  if (userData.email !== undefined) updateData.email = userData.email
  if (userData.role !== undefined) updateData.role = userData.role

  const { data, error } = await supabase
    .from('users')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return {
    id: data.id,
    authId: data.auth_id,
    name: data.name,
    email: data.email,
    role: data.role,
    createdAt: data.created_at?.split('T')[0]
  }
}

/**
 * Delete a user
 * This deletes from public.users, which cascades from auth.users deletion
 * @param {string} id - User UUID
 */
export async function deleteUser(id) {
  // Get the auth_id first
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('auth_id')
    .eq('id', id)
    .single()

  if (fetchError) {
    throw new Error('Usuario no encontrado')
  }

  // Delete from auth.users (will cascade to public.users via trigger)
  if (user.auth_id) {
    const { error: authError } = await supabase.auth.admin.deleteUser(user.auth_id)
    if (authError) {
      // Fallback: delete directly from public.users
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', id)

      if (error) {
        throw new Error(error.message)
      }
    }
  } else {
    // No auth_id, just delete from public.users
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id)

    if (error) {
      throw new Error(error.message)
    }
  }
}

/**
 * Generate a temporary password
 * @returns {string}
 */
function generateTempPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%'
  let password = ''
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}
