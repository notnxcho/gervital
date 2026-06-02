import { createClient } from 'jsr:@supabase/supabase-js@2'

// No mailing system: new users and password resets use this fixed default.
const INITIAL_PASSWORD = 'Password1234!'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''

    // Identify the caller from their JWT
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'No autenticado' }, 401)

    // Privileged client (service role)
    const admin = createClient(supabaseUrl, serviceKey)

    // Caller must be superadmin
    const { data: callerProfile } = await admin
      .from('users').select('role').eq('auth_id', caller.id).single()
    if (!callerProfile || callerProfile.role !== 'superadmin') {
      return json({ error: 'No autorizado' }, 403)
    }

    const body = await req.json()
    const { action } = body

    if (action === 'create') {
      const { name, email, role } = body
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: INITIAL_PASSWORD,
        email_confirm: true,
        user_metadata: { name, role }
      })
      if (error) return json({ error: error.message }, 400)
      return json({ authId: data.user.id })
    }

    if (action === 'reset_password') {
      const { authId } = body
      const { error } = await admin.auth.admin.updateUserById(authId, { password: INITIAL_PASSWORD })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'delete') {
      const { authId } = body
      const { error } = await admin.auth.admin.deleteUser(authId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Acción inválida' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
