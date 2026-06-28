import { supabase } from '../supabase/client'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { getEmployees } from '../salaries/salaryService'
import { mergeFinanceSeries } from './financeSeries'

/**
 * Fetch all dashboard KPIs for a given month in a single parallel batch.
 * @param {number} year
 * @param {number} month - 0-indexed
 * @returns {Promise<{ financial, clients, attendance }>}
 */
export async function getDashboardMetrics(year, month) {
  const firstDay = format(startOfMonth(new Date(year, month)), 'yyyy-MM-dd')
  const lastDay = format(endOfMonth(new Date(year, month)), 'yyyy-MM-dd')

  const [clientsRes, invoicesRes, attendanceRes, expensesRes] = await Promise.all([
    supabase
      .from('clients_full')
      .select('id, firstName, lastName, avatarUrl, cognitiveLevel, recoveryDaysAvailable, plan, deletedAt'),

    supabase
      .from('invoices_view')
      .select('clientId, chargeableAmount, paymentStatus, invoiceStatus, paidAmount')
      .eq('year', year)
      .eq('month', month),

    supabase
      .from('attendance_view')
      .select('status, isJustified')
      .gte('date', firstDay)
      .lte('date', lastDay),

    supabase
      .from('expenses')
      .select('amount, status')
      .eq('year', year)
      .eq('month', month)
  ])

  if (clientsRes.error) throw new Error(clientsRes.error.message)
  if (invoicesRes.error) throw new Error(invoicesRes.error.message)
  if (attendanceRes.error) throw new Error(attendanceRes.error.message)
  if (expensesRes.error) throw new Error(expensesRes.error.message)

  const clients = clientsRes.data || []
  const invoices = invoicesRes.data || []
  const attendance = attendanceRes.data || []
  const expenses = expensesRes.data || []

  // --- Financial KPIs ---
  // totalBilling = sum of all chargeableAmount for the month (what we plan to collect)
  const totalBilling = invoices.reduce((sum, inv) => sum + Number(inv.chargeableAmount || 0), 0)

  // totalCollected = sum of paidAmount for paid invoices (actual cash received)
  const paidInvoices = invoices.filter(inv => inv.paymentStatus === 'paid')
  const totalCollected = paidInvoices.reduce(
    (sum, inv) => sum + Number(inv.paidAmount || inv.chargeableAmount || 0),
    0
  )

  const overdueInvoices = invoices.filter(inv => inv.paymentStatus === 'overdue')
  // pendingPayment = invoices that are not yet paid (pending or overdue)
  const pendingPaymentInvoices = invoices.filter(inv => inv.paymentStatus === 'pending')
  // notInvoiced = invoices where the electronic invoice hasn't been issued yet
  const notInvoicedInvoices = invoices.filter(inv => inv.invoiceStatus === 'pending')

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0)
  // margin = collected minus expenses (estimated, since expenses may not all be paid yet)
  const margin = totalCollected - totalExpenses
  const collectionRate = totalBilling > 0 ? (totalCollected / totalBilling) * 100 : 0

  // --- Client KPIs ---
  // Metrics only over active clients; the full list still feeds the unpaid-invoices lookup.
  const activeClients = clients.filter(c => !c.deletedAt)
  const totalClients = activeClients.length
  const tierCounts = { A: 0, B: 0, C: 0, D: 0 }
  const freqCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let withTransport = 0
  let totalRecoveryDays = 0

  for (const client of activeClients) {
    const level = client.cognitiveLevel
    if (level && tierCounts[level] !== undefined) tierCounts[level]++
    totalRecoveryDays += client.recoveryDaysAvailable || 0
    const freq = client.plan?.frequency
    if (freq && freqCounts[freq] !== undefined) freqCounts[freq]++
    if (client.plan?.hasTransport) withTransport++
  }

  const transportPct = totalClients > 0 ? (withTransport / totalClients) * 100 : 0

  // --- Unpaid clients list ---
  const clientsById = new Map(clients.map(c => [c.id, c]))
  const unpaidClients = invoices
    .filter(inv => inv.paymentStatus !== 'paid')
    .map(inv => {
      const c = clientsById.get(inv.clientId)
      return {
        id: inv.clientId,
        firstName: c?.firstName || '',
        lastName: c?.lastName || '',
        avatarUrl: c?.avatarUrl || null,
        isDeactivated: !!c?.deletedAt,
        amount: Number(inv.chargeableAmount || 0),
        status: inv.paymentStatus // 'pending' or 'overdue'
      }
    })
    .sort((a, b) => {
      // Overdue first, then by name
      if (a.status !== b.status) return a.status === 'overdue' ? -1 : 1
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    })

  // --- Attendance KPIs ---
  // Only count non-scheduled, non-recovery records (actual attended vs absent)
  const attendedCount = attendance.filter(r => r.status === 'attended').length
  const absentCount = attendance.filter(r => r.status === 'absent').length
  const justifiedAbsences = attendance.filter(r => r.status === 'absent' && r.isJustified).length
  const unjustifiedAbsences = attendance.filter(r => r.status === 'absent' && !r.isJustified).length
  const attendanceTotal = attendedCount + absentCount
  const attendanceRate = attendanceTotal > 0 ? (attendedCount / attendanceTotal) * 100 : 0

  return {
    financial: {
      totalBilling,
      totalCollected,
      totalExpenses,
      margin,
      collectionRate,
      overdueCount: overdueInvoices.length,
      pendingPaymentCount: pendingPaymentInvoices.length,
      notInvoicedCount: notInvoicedInvoices.length,
      paidCount: paidInvoices.length,
      totalInvoicesCount: invoices.length
    },
    clients: {
      total: totalClients,
      byTier: tierCounts,
      byFrequency: freqCounts,
      withTransport,
      transportPct,
      totalRecoveryDays
    },
    attendance: {
      attended: attendedCount,
      absent: absentCount,
      justifiedAbsences,
      unjustifiedAbsences,
      attendanceRate,
      total: attendanceTotal
    },
    unpaidClients
  }
}

/**
 * Month-over-month finance series for the dashboard hero + KPIs.
 * Inclusive range. Months are 0-indexed.
 * @param {number} fromYear
 * @param {number} fromMonth - 0-indexed
 * @param {number} toYear
 * @param {number} toMonth - 0-indexed
 * @returns {Promise<Array>} merged month objects (see mergeFinanceSeries)
 */
export async function getDashboardFinanceSeries(fromYear, fromMonth, toYear, toMonth) {
  const [seriesRes, employees] = await Promise.all([
    supabase.rpc('get_dashboard_finance_series', {
      p_from_year: fromYear,
      p_from_month: fromMonth,
      p_to_year: toYear,
      p_to_month: toMonth
    }),
    getEmployees().catch(() => []) // operador lacks salary access → empty, never throws
  ])

  if (seriesRes.error) throw new Error(seriesRes.error.message)
  return mergeFinanceSeries(seriesRes.data || [], employees)
}

/**
 * Per-client collection rows for a single month, enriched with client name/avatar.
 * Feeds the dashboard collection panel (pending payments / pending invoices tabs).
 * Amounts are LIVE plan-derived (via get_month_collection_panel → calculate_month_billing),
 * independent of whether an invoice has been emitted. Payment/invoice status come from the
 * monthly_invoices snapshot (default 'pending' when no row exists yet).
 * @param {number} year
 * @param {number} month - 0-indexed
 * @returns {Promise<Array>} rows: { id, firstName, lastName, avatarUrl, documentNumber, transferResponsible, isDeactivated, amount, paidAmount, paymentStatus, invoiceStatus }
 */
export async function getMonthInvoicePanel(year, month) {
  const [panelRes, clientsRes] = await Promise.all([
    supabase.rpc('get_month_collection_panel', { p_year: year, p_month: month }),
    supabase
      .from('clients_full')
      .select('id, firstName, lastName, avatarUrl, deletedAt, documentNumber, transferResponsible')
  ])

  if (panelRes.error) throw new Error(panelRes.error.message)
  if (clientsRes.error) throw new Error(clientsRes.error.message)

  const byId = new Map((clientsRes.data || []).map(c => [c.id, c]))
  return (panelRes.data || []).map(row => {
    const c = byId.get(row.client_id) || {}
    return {
      id: row.client_id,
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      avatarUrl: c.avatarUrl || null,
      documentNumber: c.documentNumber || null,
      transferResponsible: c.transferResponsible || null,
      isDeactivated: !!c.deletedAt,
      amount: Number(row.attendance_gross || 0) + Number(row.transport_gross || 0),
      paidAmount: Number(row.paid_amount || 0),
      paymentStatus: row.payment_status,
      invoiceStatus: row.invoice_status
    }
  })
}
