// index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { buildComprobante } from './lib/comprobante.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const BILLER_BASE_URL = Deno.env.get('BILLER_BASE_URL') ?? ''
const BILLER_TOKEN = Deno.env.get('BILLER_TOKEN') ?? ''
const BILLER_SUCURSAL = Deno.env.get('BILLER_SUCURSAL') // opcional (id de sucursal emisora)

function billerHeaders() {
  return { 'Authorization': `Bearer ${BILLER_TOKEN}`, 'Content-Type': 'application/json' }
}

// Resuelve la versión de plan vigente para el mes (misma lógica que calculate_month_billing).
// deno-lint-ignore no-explicit-any
async function resolvePlan(admin: any, clientId: string, year: number, month: number) {
  const firstOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const { data } = await admin.from('client_plans')
    .select('frequency, schedule, distance_range')
    .eq('client_id', clientId).lte('effective_from', firstOfMonth)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'No autenticado' }, 401)

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: callerProfile } = await admin.from('users').select('role').eq('auth_id', caller.id).single()
    const role = callerProfile?.role
    if (!role) return json({ error: 'No autorizado' }, 403)
    const isBilling = role === 'admin' || role === 'superadmin'

    const body = await req.json()
    const { action } = body

    if (action === 'emit_invoice') {
      if (!isBilling) return json({ error: 'No autorizado' }, 403)
      const { clientId, year, month } = body

      const { data: client } = await admin.from('clients')
        .select('id, first_name, last_name, email, document_type, document_number, client_addresses(street)')
        .eq('id', clientId).single()
      if (!client) return json({ error: 'Cliente no encontrado' }, 404)
      if (!client.document_number) return json({ error: 'El cliente no tiene documento cargado' }, 422)

      const { data: existing } = await admin.from('monthly_invoices')
        .select('biller_id').eq('client_id', clientId).eq('year', year).eq('month', month).maybeSingle()
      if (existing?.biller_id) return json({ error: 'La factura de este mes ya fue emitida' }, 409)

      const { data: billing, error: billErr } = await admin.rpc('calculate_month_billing', { p_client_id: clientId, p_year: year, p_month: month })
      if (billErr) return json({ error: billErr.message }, 400)
      if (billing?.error) return json({ error: billing.error }, 422)
      if (!billing || Number(billing.totalChargeableGross) <= 0) return json({ error: 'Monto a facturar es 0' }, 422)

      const plan = await resolvePlan(admin, clientId, year, month)
      if (!plan) return json({ error: 'Plan no encontrado' }, 422)

      const comprobante = buildComprobante({
        client: { ...client, street: client.client_addresses?.[0]?.street ?? null },
        plan: { frequency: plan.frequency, schedule: plan.schedule, distance_range: plan.distance_range },
        billing: {
          hasTransport: billing.hasTransport,
          attendanceChargeableGross: Number(billing.attendanceChargeableGross),
          transportChargeableGross: Number(billing.transportChargeableGross),
          totalChargeableGross: Number(billing.totalChargeableGross),
        },
        year, month,
        emisorSucursal: BILLER_SUCURSAL ? Number(BILLER_SUCURSAL) : undefined,
      })

      const resp = await fetch(`${BILLER_BASE_URL}/comprobantes/crear`, {
        method: 'POST', headers: billerHeaders(), body: JSON.stringify(comprobante),
      })
      const raw = await resp.text()
      if (!resp.ok) {
        await admin.rpc('set_invoice_emit_error', { p_client_id: clientId, p_year: year, p_month: month, p_error: `HTTP ${resp.status}: ${raw.slice(0, 500)}` })
        return json({ error: `Biller rechazó la emisión (HTTP ${resp.status})`, detail: raw.slice(0, 500) }, 502)
      }
      let parsed: { id?: number; serie?: string; numero?: string; hash?: string }
      try { parsed = JSON.parse(raw) } catch { parsed = {} }
      await admin.rpc('mark_invoice_emitted', {
        p_client_id: clientId, p_year: year, p_month: month,
        p_biller_id: parsed.id ?? null, p_serie: parsed.serie ?? '', p_numero: parsed.numero ?? '', p_hash: parsed.hash ?? null,
      })
      return json({ ok: true, serie: parsed.serie, numero: parsed.numero, id: parsed.id })
    }

    return json({ error: 'Acción inválida' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
