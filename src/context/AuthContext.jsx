import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../services/supabase/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Fetch user profile from users table
  const fetchProfile = async (authUser) => {
    console.log('fetchProfile called with:', authUser?.id)
    if (!authUser) {
      console.log('fetchProfile: No authUser provided')
      setProfile(null)
      return null
    }

    try {
      console.log('fetchProfile: Querying users table...')
      const { data, error } = await supabase
        .from('users')
        .select('id, auth_id, name, email, role, created_at')
        .eq('auth_id', authUser.id)
        .single()

      console.log('fetchProfile: Query response:', { data, error })

      if (error) {
        console.error('fetchProfile: Error from query:', error)
        setProfile(null)
        return null
      }

      if (!data) {
        console.log('fetchProfile: No profile data returned')
        setProfile(null)
        return null
      }

      // Transform to camelCase for frontend
      const profile = {
        id: data.id,
        authId: data.auth_id,
        name: data.name,
        email: data.email,
        role: data.role,
        createdAt: data.created_at
      }

      console.log('fetchProfile: Setting profile:', profile)
      setProfile(profile)
      return profile
    } catch (err) {
      console.error('fetchProfile: Exception caught:', err)
      setProfile(null)
      return null
    }
  }

  useEffect(() => {
    // Get initial session
    const initializeAuth = async () => {
      console.log('1. initializeAuth starting...')
      try {
        console.log('2. Calling supabase.auth.getSession()...')
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        console.log('3. getSession result:', { hasSession: !!session, error: sessionError })

        if (session?.user) {
          console.log('4. Session found, user:', session.user.email)
          setUser(session.user)
          console.log('5. Calling fetchProfile...')
          const profile = await fetchProfile(session.user)
          console.log('6. fetchProfile result:', profile)
        } else {
          console.log('4. No session found')
        }
      } catch (error) {
        console.error('Error initializing auth:', error)
      } finally {
        console.log('7. Setting loading to false')
        setLoading(false)
      }
    }

    initializeAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth event:', event)

        if (event === 'SIGNED_OUT') {
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }

        if (session?.user) {
          setUser(session.user)
          // Defer profile fetch to avoid blocking during auth state change
          if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            setTimeout(async () => {
              console.log('Deferred fetchProfile starting...')
              await fetchProfile(session.user)
              setLoading(false)
            }, 0)
            return // Don't set loading false yet
          }
        }

        setLoading(false)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      throw new Error(error.message === 'Invalid login credentials'
        ? 'Credenciales inválidas'
        : error.message)
    }

    // Fetch profile after successful login
    const userProfile = await fetchProfile(data.user)

    if (!userProfile) {
      await supabase.auth.signOut()
      throw new Error('Usuario no encontrado en el sistema')
    }

    return { user: userProfile }
  }

  const logout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Error during logout:', error)
    }
    setUser(null)
    setProfile(null)
  }

  // Check if the user has access to a feature based on role
  const hasAccess = (feature) => {
    if (!profile) return false

    // Superadmin has access to everything
    if (profile.role === 'superadmin') return true

    // Admin doesn't have access to these features
    const restrictedForAdmin = ['suppliers', 'statistics']
    if (profile.role === 'admin' && restrictedForAdmin.includes(feature)) {
      return false
    }

    return true
  }

  const value = {
    user: profile,  // User profile from public.users (for backward compatibility)
    authUser: user, // Raw Supabase auth user (if needed)
    loading,
    login,
    logout,
    hasAccess,
    isAuthenticated: !!user && !!profile
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider')
  }
  return context
}
