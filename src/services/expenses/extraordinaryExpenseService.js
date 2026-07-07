import { supabase } from '../supabase/client'

// Extraordinary expenses for a 0-indexed month (most recent first).
export async function getExtraordinaryByMonth(year, month) {
  const { data, error } = await supabase
    .from('extraordinary_expenses_view')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .order('date', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

export async function createExtraordinary(expenseData) {
  const { data, error } = await supabase
    .from('extraordinary_expenses')
    .insert({
      supplier_id: expenseData.supplierId || null,
      category_id: expenseData.categoryId || null,
      description: expenseData.description,
      amount: expenseData.amount,
      year: expenseData.year,
      month: expenseData.month,
      date: expenseData.date,
      notes: expenseData.notes || null
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return transformExtraordinary(data)
}

export async function updateExtraordinary(id, expenseData) {
  const updateData = {}
  if (expenseData.supplierId !== undefined) updateData.supplier_id = expenseData.supplierId || null
  if (expenseData.categoryId !== undefined) updateData.category_id = expenseData.categoryId || null
  if (expenseData.description !== undefined) updateData.description = expenseData.description
  if (expenseData.amount !== undefined) updateData.amount = expenseData.amount
  if (expenseData.year !== undefined) updateData.year = expenseData.year
  if (expenseData.month !== undefined) updateData.month = expenseData.month
  if (expenseData.date !== undefined) updateData.date = expenseData.date
  if (expenseData.notes !== undefined) updateData.notes = expenseData.notes

  const { data, error } = await supabase
    .from('extraordinary_expenses')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return transformExtraordinary(data)
}

export async function deleteExtraordinary(id) {
  const { error } = await supabase.from('extraordinary_expenses').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

function transformExtraordinary(expense) {
  return {
    id: expense.id,
    supplierId: expense.supplier_id,
    categoryId: expense.category_id,
    description: expense.description,
    amount: Number(expense.amount),
    year: expense.year,
    month: expense.month,
    date: expense.date,
    notes: expense.notes
  }
}
