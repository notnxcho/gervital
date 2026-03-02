import { supabase } from '../supabase/client'

/**
 * Get all expenses
 * @returns {Promise<Array>}
 */
export async function getExpenses() {
  const { data, error } = await supabase
    .from('expenses_view')
    .select('*')
    .order('date', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Get expenses by month
 * @param {number} year
 * @param {number} month - 0-indexed month
 * @returns {Promise<Array>}
 */
export async function getExpensesByMonth(year, month) {
  const { data, error } = await supabase
    .from('expenses_view')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .order('date', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Create a new expense
 * @param {object} expenseData
 * @returns {Promise<object>}
 */
export async function createExpense(expenseData) {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      supplier_id: expenseData.supplierId || null,
      description: expenseData.description,
      amount: expenseData.amount,
      type: expenseData.type,
      year: expenseData.year,
      month: expenseData.month,
      date: expenseData.date,
      status: 'pending',
      notes: expenseData.notes || null
    })
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return transformExpense(data)
}

/**
 * Update an expense
 * @param {string} id - Expense UUID
 * @param {object} expenseData
 * @returns {Promise<object>}
 */
export async function updateExpense(id, expenseData) {
  const updateData = {}

  if (expenseData.supplierId !== undefined) updateData.supplier_id = expenseData.supplierId
  if (expenseData.description !== undefined) updateData.description = expenseData.description
  if (expenseData.amount !== undefined) updateData.amount = expenseData.amount
  if (expenseData.type !== undefined) updateData.type = expenseData.type
  if (expenseData.year !== undefined) updateData.year = expenseData.year
  if (expenseData.month !== undefined) updateData.month = expenseData.month
  if (expenseData.date !== undefined) updateData.date = expenseData.date
  if (expenseData.status !== undefined) updateData.status = expenseData.status
  if (expenseData.notes !== undefined) updateData.notes = expenseData.notes

  const { data, error } = await supabase
    .from('expenses')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return transformExpense(data)
}

/**
 * Mark expense as paid
 * @param {string} id - Expense UUID
 * @returns {Promise<object>}
 */
export async function markExpenseAsPaid(id) {
  const { data, error } = await supabase
    .from('expenses')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return transformExpense(data)
}

/**
 * Delete an expense
 * @param {string} id - Expense UUID
 */
export async function deleteExpense(id) {
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Get expenses summary for a month
 * @param {number} year
 * @param {number} month - 0-indexed month
 * @returns {Promise<object>}
 */
export async function getExpensesSummary(year, month) {
  const { data, error } = await supabase
    .rpc('get_expenses_summary', {
      p_year: year,
      p_month: month
    })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Transform expense from database format to frontend format
 */
function transformExpense(expense) {
  return {
    id: expense.id,
    supplierId: expense.supplier_id,
    description: expense.description,
    amount: Number(expense.amount),
    type: expense.type,
    year: expense.year,
    month: expense.month,
    date: expense.date,
    status: expense.status,
    paidAt: expense.paid_at,
    notes: expense.notes
  }
}
