// comprobante.ts
export const TIPO_ETICKET = 101
export const IVA_BASICA = 3   // 22% — asistencia
export const IVA_MINIMA = 2   // 10% — transporte

const DOC_TYPE_MAP: Record<string, number> = { rut: 2, ci: 3, otro: 4, pasaporte: 5, dni: 6 }
const SCHEDULE_LABEL: Record<string, string> = { morning: 'Mañana', afternoon: 'Tarde', full_day: 'Día completo' }
const MONTH_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

export interface BillerClient {
  id: string; first_name: string; last_name: string; email: string | null
  document_type: string; document_number: string | null; street?: string | null
}
export interface PlanInfo { frequency: number; schedule: string; distance_range: string | null }
export interface Billing { hasTransport: boolean; attendanceChargeableGross: number; transportChargeableGross: number; totalChargeableGross: number }

export function buildClientePayload(client: BillerClient) {
  const fullName = `${client.first_name} ${client.last_name}`.trim().slice(0, 30)
  return {
    tipo_documento: DOC_TYPE_MAP[client.document_type] ?? 3,
    documento: client.document_number ?? '',
    nombre_fantasia: fullName,
    pais: 'UY',
    sucursal: {
      direccion: (client.street ?? '').slice(0, 70),
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
}

export function buildComprobante(
  { client, plan, billing, year, month, emisorSucursal }:
  { client: BillerClient; plan: PlanInfo; billing: Billing; year: number; month: number; emisorSucursal?: number }
): Comprobante {
  const monthLabel = `${MONTH_ES[month]} ${year}`
  const items: ComprobanteItem[] = [{
    codigo: `PLAN-${plan.frequency}-${plan.schedule.toUpperCase()}`,
    cantidad: 1,
    concepto: `Plan ${plan.frequency}x ${SCHEDULE_LABEL[plan.schedule] ?? plan.schedule} - ${monthLabel}`,
    precio: billing.attendanceChargeableGross,
    indicador_facturacion: IVA_BASICA,
  }]
  if (billing.hasTransport && billing.transportChargeableGross > 0) {
    items.push({
      codigo: `TRANS-${plan.distance_range ?? 'NA'}-${plan.frequency}`,
      cantidad: 1,
      concepto: `Transporte - ${monthLabel}`,
      precio: billing.transportChargeableGross,
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
  return comprobante
}
