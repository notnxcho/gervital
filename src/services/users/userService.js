import { supabase } from '../supabase/client'

// Invoke the admin-users edge function, surfacing the server error message
async function invokeAdminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let message = error.message
    try {
      const ctx = await error.context?.json?.()
      if (ctx?.error) message = ctx.error
    } catch (_) { /* ignore parse errors */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

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
 * Create a new user via the admin-users edge function.
 * Initial password is set server-side to the project default.
 * @param {object} userData - { name, email, role }
 * @returns {Promise<object>}
 */
export async function createUser(userData) {
  const data = await invokeAdminUsers({
    action: 'create',
    name: userData.name,
    email: userData.email,
    role: userData.role
  })

  // The handle_new_user trigger creates the profile; wait then fetch it
  await new Promise(resolve => setTimeout(resolve, 500))

  const { data: user, error: fetchError } = await supabase
    .from('users_view')
    .select('*')
    .eq('authId', data.authId)
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
 * Delete a user. Removes the auth user (cascades to public.users).
 * @param {string} id - public.users.id
 */
export async function deleteUser(id) {
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('auth_id')
    .eq('id', id)
    .single()

  if (fetchError) {
    throw new Error('Usuario no encontrado')
  }

  if (!user.auth_id) {
    const { error } = await supabase.from('users').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return
  }

  await invokeAdminUsers({ action: 'delete', authId: user.auth_id })
}

/**
 * Reset a user's password to the project default. Superadmin only (enforced
 * server-side by the edge function).
 * @param {string} authId - auth.users id
 */
export async function resetPassword(authId) {
  await invokeAdminUsers({ action: 'reset_password', authId })
}
