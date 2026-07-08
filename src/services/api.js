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
  updateClientAddressCoords,
  getClientPlanVersions,
  setClientPlanVersion
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
  getAttendanceForDate,
  getAttendanceForDateRange,
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
  voidPendingInvoices,
  getClientInvoices,
  calculateMonthBilling,
  markMonthPaid,
  markMonthInvoiced,
  unmarkMonthPaid,
  applyPlanDiscount,
  removePlanDiscount
} from './invoices/invoiceService'

// ============================================
// BILLER API (facturación electrónica)
// ============================================
export {
  emitInvoice,
  syncClientToBiller,
  checkDgiStatus,
  voidInvoice,
  getInvoicePdf
} from './biller/billerService'

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
  deleteExpense
} from './expenses/expenseService'

export {
  getExtraordinaryByMonth,
  getAllExtraordinaryExpenses,
  createExtraordinary,
  updateExtraordinary,
  deleteExtraordinary
} from './expenses/extraordinaryExpenseService'

export {
  contingencyLimit,
  contingencyStatus
} from './expenses/contingencyFund'

export {
  getSetting,
  setSetting
} from './settings/appSettingsService'

export {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory
} from './expenseCategories/expenseCategoryService'

export {
  getFixedExpenses,
  createFixedExpense,
  updateFixedExpense,
  deleteFixedExpense
} from './expenses/fixedExpenseService'

export {
  PERIODICITY_OPTIONS,
  periodicityLabel,
  monthlyAmount,
  hitsMonth,
  fixedCashForMonth,
  fixedMonthlyForMonth,
  nextPayment
} from './expenses/fixedExpenseCalc'

// ============================================
// SALARIES API (Sueldos)
// ============================================
export {
  EXTRA_COST_TYPES,
  extraCostLabel,
  getEmployees,
  getStandaloneExtraCosts,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  addSalaryAdjustment,
  deleteSalaryAdjustment,
  addExtraCost,
  deleteExtraCost
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
// DASHBOARD ANALYTICS API
// ============================================
export {
  getAttendanceStats,
  getBillingBreakdown
} from './dashboard/dashboardService'

// ============================================
// CHURN API
// ============================================
export {
  getChurnBoard,
  updateChurnStage,
  assignChurn,
  getChurnNotes,
  addChurnNote
} from './churn/churnService'

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

export {
  saveReferenceGroup,
  applyReferenceGroup,
  getReferenceGroupInfo
} from './groups/referenceGroupService'
