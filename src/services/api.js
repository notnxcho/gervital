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
  onAuthStateChange,
  changePassword
} from './auth/authService'

// ============================================
// CLIENTS API
// ============================================
export {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deactivateClient,
  reactivateClient,
  updateClientAddressCoords
} from './clients/clientService'

// ============================================
// CLIENT AVATARS API
// ============================================
export {
  uploadClientAvatar,
  deleteClientAvatar
} from './clients/avatarService'

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
// RECOVERY API
// ============================================
export {
  getRecoveryCredits,
  addRecoveryCredit,
  revokeRecoveryCredit
} from './recovery/recoveryService'

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
  deleteUser,
  resetPassword
} from './users/userService'

// ============================================
// PRICING API (plan + transport)
// ============================================
export { getPlanPricing, getPlanPriceSync, calculateProration } from './pricing/pricingService'
export { getTransportPricing, getTransportPriceSync } from './pricing/transportPricingService'

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

// ============================================
// SALARIES API (Sueldos)
// ============================================
export {
  getSalaries,
  createSalary,
  updateSalary,
  deactivateSalary,
  deleteSalary,
  SALARY_ONE_TIME_TYPES,
  salaryOneTimeLabel
} from './salaries/salaryService'

// ============================================
// TRANSPORT API
// ============================================
export {
  getTransportClients,
  filterClientsForShift,
  getArrangementForDate,
  saveTransportDay,
  findLastWeekdayArrangement,
  copyArrangementFromDate,
  buildDefaultFleet,
  getNextCarColor
} from './transport/transportService'

// ============================================
// GROUPS API
// ============================================
export {
  getTimeSlotsForDate,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
  createActivity,
  updateActivity,
  deleteActivity,
  assignClientToActivity,
  removeClientFromActivity,
  cleanupOldGroups,
  getTemplates,
  getTemplateDetail,
  saveTemplate,
  updateTemplateName,
  deleteTemplate,
  applyTemplate,
  saveCurrentAsTemplate,
  createTemplateSlot,
  updateTemplateSlot,
  deleteTemplateSlot,
  createTemplateActivity,
  updateTemplateActivity,
  deleteTemplateActivity
} from './groups/groupService'
