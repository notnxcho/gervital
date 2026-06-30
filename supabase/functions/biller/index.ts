// index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { buildComprobante, buildClienteCrearPayload } from './lib/comprobante.ts'

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

// client_addresses tiene UNIQUE(client_id) → PostgREST embebe la relación como objeto
// (no array). Toleramos ambas formas para leer la calle de forma robusta.
// deno-lint-ignore no-explicit-any
function addrRow(client: any) {
  const a = client?.client_addresses
  return Array.isArray(a) ? a[0] : a
}
// deno-lint-ignore no-explicit-any
function addrStreet(client: any): string {
  return (addrRow(client)?.street ?? '').trim()
}
// Domicilio fiscal para Biller: calle + timbre. `street` pelado se usa solo para geocoding;
// lo que va en la factura/receptor es la dirección completa.
// deno-lint-ignore no-explicit-any
function addrDireccion(client: any): string {
  const row = addrRow(client)
  const street = (row?.street ?? '').trim()
  const doorbell = (row?.doorbell ?? '').trim()
  if (!street) return ''
  return doorbell ? `${street} - Timbre ${doorbell}` : street
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
        .select('id, first_name, last_name, email, document_type, document_number, client_addresses(street, doorbell)')
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

      // Montos finales: override del modal si vino, si no el cálculo del server.
      const attGross = body.attendanceAmount != null ? Number(body.attendanceAmount) : Number(billing.attendanceChargeableGross)
      const transGross = billing.hasTransport
        ? (body.transportAmount != null ? Number(body.transportAmount) : Number(billing.transportChargeableGross))
        : 0
      const totalGross = attGross + transGross
      if (totalGross <= 0) return json({ error: 'Monto a facturar es 0' }, 422)
      const attNet = Math.round(attGross / 1.22)
      const transNet = transGross > 0 ? Math.round(transGross / 1.10) : 0

      const comprobante = buildComprobante({
        client: { ...client, street: addrDireccion(client) || null },
        plan: { frequency: plan.frequency, schedule: plan.schedule, distance_range: plan.distance_range },
        billing: {
          hasTransport: billing.hasTransport,
          attendanceChargeableGross: attGross,
          transportChargeableGross: transGross,
          totalChargeableGross: totalGross,
        },
        year, month,
        emisorSucursal: BILLER_SUCURSAL ? Number(BILLER_SUCURSAL) : undefined,
        overrides: {
          attendanceConcepto: body.attendanceConcepto,
          attendanceAmount: body.attendanceAmount != null ? attGross : undefined,
          transportConcepto: body.transportConcepto,
          transportAmount: body.transportAmount != null ? transGross : undefined,
          adenda: body.adenda,
          fechaEmision: body.fechaEmision,
          fechaVencimiento: body.fechaVencimiento,
        },
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
        // Snapshot de lo REALMENTE facturado (override del modal o cálculo del server).
        p_chargeable_amount: totalGross,
        p_monthly_rate: Number(billing.monthlyRate) || 0,
        p_planned_days: billing.plannedDays ?? null,
        p_chargeable_days: billing.chargeableDays ?? null,
        p_att_rate_net: Number(billing.attendanceMonthlyRateNet) || 0,
        p_att_rate_gross: Number(billing.attendanceMonthlyRateGross) || 0,
        p_att_charge_net: attNet,
        p_att_charge_gross: attGross,
        p_trans_rate_net: Number(billing.transportMonthlyRateNet) || 0,
        p_trans_rate_gross: Number(billing.transportMonthlyRateGross) || 0,
        p_trans_charge_net: transNet,
        p_trans_charge_gross: transGross,
      })
      return json({ ok: true, serie: parsed.serie, numero: parsed.numero, id: parsed.id })
    }

    if (action === 'sync_client') {
      // Cualquier usuario conocido puede sincronizar (puede crear clientes)
      const { clientId, force } = body
      const { data: client } = await admin.from('clients')
        .select('id, first_name, last_name, email, document_type, document_number, biller_client_id, client_addresses(street, doorbell)')
        .eq('id', clientId).single()
      if (!client) return json({ error: 'Cliente no encontrado' }, 404)
      if (!client.document_number) return json({ error: 'El cliente no tiene documento cargado' }, 422)

      // Ya sincronizado: no recrear el receptor salvo que se fuerce (re-sync de datos fiscales)
      if (client.biller_client_id && !force) {
        return json({ ok: true, alreadySynced: true, billerClientId: client.biller_client_id })
      }

      const street = addrStreet(client)
      if (!street) return json({ error: 'El cliente no tiene dirección cargada (requerida por Biller)' }, 422)

      const payload = buildClienteCrearPayload({ ...client, street: addrDireccion(client) })
      const resp = await fetch(`${BILLER_BASE_URL}/clientes/crear`, { method: 'POST', headers: billerHeaders(), body: JSON.stringify(payload) })
      const raw = await resp.text()
      if (!resp.ok) {
        await admin.rpc('set_client_biller_sync', { p_client_id: clientId, p_biller_client_id: null, p_biller_branch_id: null, p_error: `HTTP ${resp.status}: ${raw.slice(0, 500)}` })
        return json({ error: `Biller rechazó el alta del cliente (HTTP ${resp.status})`, detail: raw.slice(0, 500) }, 502)
      }
      let parsedClient: { cliente?: number; sucursal?: number }
      try { parsedClient = JSON.parse(raw) } catch { parsedClient = {} }
      await admin.rpc('set_client_biller_sync', { p_client_id: clientId, p_biller_client_id: parsedClient.cliente ?? null, p_biller_branch_id: parsedClient.sucursal ?? null, p_error: null })
      return json({ ok: true, billerClientId: parsedClient.cliente, billerBranchId: parsedClient.sucursal })
    }

    if (action === 'check_dgi_status') {
      if (!isBilling) return json({ error: 'No autorizado' }, 403)
      const { clientId, year, month } = body
      const { data: inv } = await admin.from('monthly_invoices')
        .select('biller_id').eq('client_id', clientId).eq('year', year).eq('month', month).maybeSingle()
      if (!inv?.biller_id) return json({ error: 'Factura no emitida' }, 422)

      const resp = await fetch(`${BILLER_BASE_URL}/comprobantes/obtener?id=${inv.biller_id}`, { headers: billerHeaders() })
      const raw = await resp.text()
      if (!resp.ok) return json({ error: `Biller HTTP ${resp.status}`, detail: raw.slice(0, 300) }, 502)
      let parsedDgi: { estado?: string } | Array<{ estado?: string }>
      try { parsedDgi = JSON.parse(raw) } catch { parsedDgi = {} }
      const record = Array.isArray(parsedDgi) ? (parsedDgi[0] ?? {}) : parsedDgi
      const estado = (record.estado ?? '').toLowerCase()
      const status = estado.includes('acept') ? 'accepted' : estado.includes('rechaz') ? 'rejected' : 'pending_dgi'
      await admin.rpc('set_invoice_dgi_status', { p_client_id: clientId, p_year: year, p_month: month, p_status: status })
      return json({ ok: true, dgiStatus: status, estado: record.estado })
    }

    if (action === 'void_invoice') {
      if (role !== 'superadmin') return json({ error: 'No autorizado' }, 403)
      const { clientId, year, month } = body
      const { data: inv } = await admin.from('monthly_invoices')
        .select('biller_id').eq('client_id', clientId).eq('year', year).eq('month', month).maybeSingle()
      if (!inv?.biller_id) return json({ error: 'Factura no emitida' }, 422)

      const resp = await fetch(`${BILLER_BASE_URL}/comprobantes/anular`, {
        method: 'POST', headers: billerHeaders(), body: JSON.stringify({ id: inv.biller_id, fecha_emision_hoy: true }),
      })
      const raw = await resp.text()
      if (!resp.ok) return json({ error: `Biller HTTP ${resp.status}`, detail: raw.slice(0, 300) }, 502)
      await admin.rpc('mark_invoice_voided', { p_client_id: clientId, p_year: year, p_month: month })
      return json({ ok: true })
    }

    if (action === 'get_invoice_pdf') {
      if (!isBilling) return json({ error: 'No autorizado' }, 403)
      const { clientId, year, month } = body
      const { data: inv } = await admin.from('monthly_invoices')
        .select('biller_id').eq('client_id', clientId).eq('year', year).eq('month', month).maybeSingle()
      if (!inv?.biller_id) return json({ error: 'Factura no emitida' }, 422)
      const resp = await fetch(`${BILLER_BASE_URL}/comprobantes/pdf?id=${inv.biller_id}`, { headers: billerHeaders() })
      const raw = await resp.text()
      if (!resp.ok) return json({ error: `Biller HTTP ${resp.status}`, detail: raw.slice(0, 300) }, 502)
      // Biller devuelve el PDF en base64 en el body.
      return json({ ok: true, pdf: raw.trim() })
    }

    return json({ error: 'Acción inválida' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
