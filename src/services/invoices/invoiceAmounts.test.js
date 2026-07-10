import { prorateInvoiceLines } from './invoiceAmounts'

describe('prorateInvoiceLines', () => {
  test('not paid: defaults to live calc, rounded', () => {
    const r = prorateInvoiceLines({
      paymentStatus: 'pending', paidAmount: null,
      liveAttGross: 10000.4, liveTransGross: 2000.6, hasTransport: true
    })
    expect(r).toEqual({ attGross: 10000, transGross: 2001 })
  })

  test('paid, collected == calculated: same split as live', () => {
    const r = prorateInvoiceLines({
      paymentStatus: 'paid', paidAmount: 12000,
      liveAttGross: 10000, liveTransGross: 2000, hasTransport: true
    })
    expect(r).toEqual({ attGross: 10000, transGross: 2000 })
    expect(r.attGross + r.transGross).toBe(12000)
  })

  test('paid, collected differs: prorates proportionally, total stays exact', () => {
    // live total 12000 (att 10000 / trans 2000), collected 9000
    const r = prorateInvoiceLines({
      paymentStatus: 'paid', paidAmount: 9000,
      liveAttGross: 10000, liveTransGross: 2000, hasTransport: true
    })
    // trans = round(9000 * 2000/12000) = 1500 ; att = 9000 - 1500 = 7500
    expect(r).toEqual({ attGross: 7500, transGross: 1500 })
    expect(r.attGross + r.transGross).toBe(9000)
  })

  test('paid, attendance-only client: all collected goes to attendance', () => {
    const r = prorateInvoiceLines({
      paymentStatus: 'paid', paidAmount: 8500,
      liveAttGross: 9000, liveTransGross: 0, hasTransport: false
    })
    expect(r).toEqual({ attGross: 8500, transGross: 0 })
  })

  test('hasTransport false: transport line is always 0 even if a live value leaks in', () => {
    const r = prorateInvoiceLines({
      paymentStatus: 'pending', paidAmount: null,
      liveAttGross: 9000, liveTransGross: 500, hasTransport: false
    })
    expect(r).toEqual({ attGross: 9000, transGross: 0 })
  })

  test('paid but live total is 0: all collected goes to attendance', () => {
    const r = prorateInvoiceLines({
      paymentStatus: 'paid', paidAmount: 5000,
      liveAttGross: 0, liveTransGross: 0, hasTransport: true
    })
    expect(r).toEqual({ attGross: 5000, transGross: 0 })
  })

  test('paid with 0 collected: default is 0 (emission guard blocks downstream)', () => {
    const r = prorateInvoiceLines({
      paymentStatus: 'paid', paidAmount: 0,
      liveAttGross: 10000, liveTransGross: 2000, hasTransport: true
    })
    expect(r).toEqual({ attGross: 0, transGross: 0 })
  })

  test('rounding: proration never drifts the total off the collected amount', () => {
    // odd split that would round each line up independently
    const r = prorateInvoiceLines({
      paymentStatus: 'paid', paidAmount: 9999,
      liveAttGross: 3333, liveTransGross: 3333, hasTransport: true
    })
    expect(r.attGross + r.transGross).toBe(9999)
  })
})
