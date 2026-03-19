import { createClient } from '@supabase/supabase-js'
import { supabase } from '../supabase/client'

/**
 * Login with email and password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object, token: string}>}
 */
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    throw new Error(error.message === 'Invalid login credentials'
      ? 'Credenciales inválidas'
      : error.message)
  }

  // Fetch user profile from users table
  const { data: profile, error: profileError } = await supabase
    .from('users_view')
    .select('*')
    .eq('authId', data.user.id)
    .single()

  if (profileError) {
    // If no profile exists, sign out and throw error
    await supabase.auth.signOut()
    throw new Error('Usuario no encontrado en el sistema')
  }

  return {
    user: profile,
    token: data.session.access_token
  }
}

/**
 * Logout current user
 */
export async function logout() {
  const { error } = await supabase.auth.signOut()
  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Get current session (standalone, not from callback)
 * @returns {Promise<{user: object, session: object} | null>}
 */
export async function getSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession()

    if (error || !session) {
      return null
    }

    return fetchUserProfile(session)
  } catch (err) {
    console.error('getSession error:', err)
    return null
  }
}

/**
 * Fetch user profile given a session (use this inside onAuthStateChange)
 * @param {object} session - The session object from Supabase auth
 * @returns {Promise<{user: object, session: object} | null>}
 */
export async function fetchUserProfile(session) {
  if (!session?.user?.id) {
    console.log('No session provided')
    return null
  }

  console.log('Fetching profile for:', session.user.email)

  try {
    // Fetch user profile with timeout
    const fetchProfile = async () => {
      const { data, error } = await supabase
        .from('users_view')
        .select('*')
        .eq('authId', session.user.id)
        .single()
      return { data, error }
    }

    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve({ data: null, error: { message: 'Query timeout after 5s' } }), 5000)
    )

    const { data: profile, error: profileError } = await Promise.race([
      fetchProfile(),
      timeoutPromise
    ])

    if (profileError) {
      console.error('Error fetching profile:', profileError)
      return null
    }

    if (!profile) {
      console.log('No profile found for user')
      return null
    }

    console.log('Profile loaded:', profile.name)
    return {
      user: profile,
      session
    }
  } catch (err) {
    console.error('fetchUserProfile error:', err)
    return null
  }
}

/**
 * Change password for the currently logged-in user
 * @param {string} currentPassword - Current password (for re-authentication)
 * @param {string} newPassword - New password
 */
export async function changePassword(currentPassword, newPassword) {
  // Get the current user's email
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    throw new Error('No se pudo obtener el usuario actual')
  }

  // Verify current password using a throwaway client so the main session is not replaced
  const tempClient = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.REACT_APP_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  )
  const { error: signInError } = await tempClient.auth.signInWithPassword({
    email: user.email,
    password: currentPassword
  })

  if (signInError) {
    throw new Error('La contraseña actual es incorrecta')
  }

  // Update password on the real session
  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword
  })

  if (updateError) {
    throw new Error('Error al cambiar la contraseña: ' + updateError.message)
  }
}

/**
 * Subscribe to auth state changes
 * @param {function} callback - Called with (event, session)
 * @returns {function} Unsubscribe function
 */
export function onAuthStateChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback)
  return () => subscription.unsubscribe()
}
