import { supabase } from '../supabase/client'
import { format, startOfMonth, endOfMonth } from 'date-fns'

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
      .select('id, cognitiveLevel, recoveryDaysAvailable, plan'),

    supabase
      .from('invoices_view')
      .select('chargeableAmount, paymentStatus, invoiceStatus, paidAmount')
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
  const totalClients = clients.length
  const tierCounts = { A: 0, B: 0, C: 0, D: 0 }
  const freqCounts = { 1: 0, 2: 0, 3: 0, 4: 0 }
  let withTransport = 0
  let totalRecoveryDays = 0

  for (const client of clients) {
    const level = client.cognitiveLevel
    if (level && tierCounts[level] !== undefined) tierCounts[level]++
    totalRecoveryDays += client.recoveryDaysAvailable || 0
    const freq = client.plan?.frequency
    if (freq && freqCounts[freq] !== undefined) freqCounts[freq]++
    if (client.plan?.hasTransport) withTransport++
  }

  const transportPct = totalClients > 0 ? (withTransport / totalClients) * 100 : 0

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
    }
  }
}
