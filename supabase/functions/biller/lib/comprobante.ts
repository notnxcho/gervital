// comprobante.ts
export const TIPO_ETICKET = 101
export const IVA_BASICA = 3   // 22% — asistencia
export const IVA_MINIMA = 2   // 10% — transporte

const DOC_TYPE_MAP: Record<string, number> = { rut: 2, ci: 3, otro: 4, pasaporte: 5, dni: 6 }
const SCHEDULE_LABEL: Record<string, string> = { morning: 'Mañana', afternoon: 'Tarde', full_day: 'Día completo' }

export interface BillerClient {
  id: string; first_name: string; last_name: string; email: string | null
  document_type: string; document_number: string | null; street?: string | null
}
export interface PlanInfo { frequency: number; schedule: string; distance_range: string | null }
export interface Billing { hasTransport: boolean; attendanceChargeableGross: number; transportChargeableGross: number; totalChargeableGross: number }

// Valores editables que la persona confirma en el modal. El IVA y los códigos NO se overridean acá.
export interface Overrides {
  attendanceConcepto?: string
  attendanceAmount?: number
  transportConcepto?: string
  transportAmount?: number
  adenda?: string
  fechaEmision?: string
  fechaVencimiento?: string
}

// Todos los clientes son de Montevideo (ciudad y departamento fijos).
const CIUDAD = 'Montevideo'
const DEPARTAMENTO = 'Montevideo'

export function buildClientePayload(client: BillerClient): ClientePayload {
  const fullName = `${client.first_name} ${client.last_name}`.trim().slice(0, 30)
  return {
    tipo_documento: DOC_TYPE_MAP[client.document_type] ?? 3,
    documento: client.document_number ?? '',
    nombre_fantasia: fullName,
    pais: 'UY',
    sucursal: {
      direccion: (client.street ?? '').slice(0, 70),
      ciudad: CIUDAD,
      departamento: DEPARTAMENTO,
      pais: 'UY',
      emails: client.email ? [client.email] : [],
    },
  }
}

export interface ComprobanteItem {
  codigo: string
  cantidad: number
  concepto: string
  precio: number
  indicador_facturacion: number
}

export interface ClienteSucursal {
  direccion: string
  ciudad: string
  departamento: string
  pais: string
  emails: string[]
}

export interface ClientePayload {
  tipo_documento: number
  documento: string
  nombre_fantasia: string
  pais: string
  sucursal: ClienteSucursal
}

export interface Comprobante {
  tipo_comprobante: number
  forma_pago: number
  moneda: string
  montos_brutos: boolean
  numero_interno: string
  cliente: ClientePayload
  emails_notificacion: string[]
  items: ComprobanteItem[]
  sucursal?: number
  adenda?: string
  fecha_emision?: string
  fecha_vencimiento?: string
}

export function buildComprobante(
  { client, plan, billing, year, month, emisorSucursal, overrides }:
  { client: BillerClient; plan: PlanInfo; billing: Billing; year: number; month: number; emisorSucursal?: number; overrides?: Overrides }
): Comprobante {
  const o = overrides ?? {}

  const attConcepto = o.attendanceConcepto ?? `Plan ${plan.frequency} días x semana – ${SCHEDULE_LABEL[plan.schedule] ?? plan.schedule}`
  const attPrecio = o.attendanceAmount ?? billing.attendanceChargeableGross
  const items: ComprobanteItem[] = [{
    codigo: `PLAN-${plan.frequency}-${plan.schedule.toUpperCase()}`,
    cantidad: 1,
    concepto: attConcepto,
    precio: attPrecio,
    indicador_facturacion: IVA_BASICA,
  }]

  const transPrecio = o.transportAmount ?? billing.transportChargeableGross
  if (billing.hasTransport && transPrecio > 0) {
    items.push({
      codigo: `TRANS-${plan.distance_range ?? 'NA'}-${plan.frequency}`,
      cantidad: 1,
      concepto: o.transportConcepto ?? 'Transporte',
      precio: transPrecio,
      indicador_facturacion: IVA_MINIMA,
    })
  }

  const cliente = buildClientePayload(client)
  const comprobante: Comprobante = {
    tipo_comprobante: TIPO_ETICKET,
    forma_pago: 1,
    moneda: 'UYU',
    montos_brutos: true,
    numero_interno: `${client.id}-${year}-${month}`,
    cliente,
    emails_notificacion: cliente.sucursal.emails,
    items,
  }
  if (emisorSucursal) comprobante.sucursal = emisorSucursal
  if (o.adenda) comprobante.adenda = o.adenda
  if (o.fechaEmision) comprobante.fecha_emision = o.fechaEmision
  if (o.fechaVencimiento) comprobante.fecha_vencimiento = o.fechaVencimiento
  return comprobante
}
