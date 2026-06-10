// comprobante_test.ts
import { assertEquals, assert } from 'jsr:@std/assert@1'
import { buildComprobante, TIPO_ETICKET } from './comprobante.ts'

const baseClient = {
  id: 'c1', first_name: 'Ana', last_name: 'Pérez',
  email: 'ana@example.com', document_type: 'ci', document_number: '12345678',
  street: '18 de Julio 1234',
}
const billingNoTransport = {
  hasTransport: false,
  attendanceChargeableGross: 9000, transportChargeableGross: 0,
  totalChargeableGross: 9000,
}
const plan = { frequency: 3, schedule: 'afternoon', distance_range: null }

Deno.test('e-Ticket CI: una sola línea de asistencia con IVA 22%', () => {
  const c = buildComprobante({ client: baseClient, plan, billing: billingNoTransport, year: 2026, month: 5 })
  assertEquals(c.tipo_comprobante, TIPO_ETICKET)
  assertEquals(c.montos_brutos, true)
  assertEquals(c.moneda, 'UYU')
  assertEquals(c.numero_interno, 'c1-2026-5')
  assertEquals(c.cliente.tipo_documento, 3)
  assertEquals(c.cliente.documento, '12345678')
  assertEquals(c.items.length, 1)
  assertEquals(c.items[0].codigo, 'PLAN-3-AFTERNOON')
  assertEquals(c.items[0].precio, 9000)
  assertEquals(c.items[0].indicador_facturacion, 3)
  assert(c.cliente.sucursal.emails.includes('ana@example.com'))
})

Deno.test('con transporte: agrega línea TRANS con IVA 10%', () => {
  const billing = { hasTransport: true, attendanceChargeableGross: 9000, transportChargeableGross: 1500, totalChargeableGross: 10500 }
  const c = buildComprobante({ client: baseClient, plan: { frequency: 3, schedule: 'afternoon', distance_range: '2_to_5km' }, billing, year: 2026, month: 0 })
  assertEquals(c.items.length, 2)
  assertEquals(c.items[1].codigo, 'TRANS-2_to_5km-3')
  assertEquals(c.items[1].precio, 1500)
  assertEquals(c.items[1].indicador_facturacion, 2)
})

Deno.test('sin email: no rompe y emails queda vacío', () => {
  const c = buildComprobante({ client: { ...baseClient, email: null }, plan, billing: billingNoTransport, year: 2026, month: 5 })
  assertEquals(c.cliente.sucursal.emails, [])
})
