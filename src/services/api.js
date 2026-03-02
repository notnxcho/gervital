// ============================================
// API Facade - Backward-Compatible Re-exports
// ============================================
// This file maintains backward compatibility with existing imports
// while delegating to the new modular service architecture.

// Re-export Supabase client for direct access if needed
export { supabase } from './supabase/client'

// ============================================
// AUTH API
// ============================================
export {
  login,
  logout,
  getSession,
  fetchUserProfile,
  onAuthStateChange
} from './auth/authService'

// ============================================
// CLIENTS API
// ============================================
export {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient
} from './clients/clientService'

// ============================================
// ATTENDANCE API
// ============================================
export {
  getClientAttendance,
  advanceScheduledAttendance,
  markDayAbsent,
  unmarkDayAbsent,
  markDayVacation,
  unmarkDayVacation,
  markVacationRange,
  markDayRecoveryAttended,
  unmarkDayRecoveryAttended
} from './attendance/attendanceService'

// ============================================
// INVOICES API
// ============================================
export {
  ensureClientMonths,
  getClientInvoices,
  calculateMonthBilling,
  markMonthPaid,
  markMonthInvoiced,
  unmarkMonthPaid
} from './invoices/invoiceService'

// ============================================
// USERS API (Accesos)
// ============================================
export {
  getUsers,
  createUser,
  updateUser,
  deleteUser
} from './users/userService'

// ============================================
// PLAN PRICING API
// ============================================
export {
  getPlanPricing,
  calculatePlanPrice
} from './pricing/pricingService'

// Also export synchronous version for components that have cached pricing
export { calculatePlanPriceSync, calculateProration, calculateBillingBreakdown } from './pricing/pricingService'

// ============================================
// SUPPLIERS & EXPENSES API
// ============================================
export {
  SUPPLIER_CATEGORIES,
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier
} from './suppliers/supplierService'

export {
  getExpenses,
  getExpensesByMonth,
  createExpense,
  updateExpense,
  markExpenseAsPaid,
  deleteExpense,
  getExpensesSummary
} from './expenses/expenseService'
