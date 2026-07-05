import { supabase } from '../supabase/client'

// Read from the view (already camelCase + joined names).
export async function getFixedExpenses() {
  const { data, error } = await supabase
    .from('fixed_expenses_view')
    .select('*')
    .order('description', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(normalizeAmounts)
}

export async function createFixedExpense(input) {
  const { data, error } = await supabase
    .from('fixed_expenses')
    .insert(toRow(input))
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateFixedExpense(id, input) {
  const { data, error } = await supabase
    .from('fixed_expenses')
    .update(toRow(input))
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteFixedExpense(id) {
  const { error } = await supabase.from('fixed_expenses').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

function toRow(input) {
  return {
    description: input.description,
    category_id: input.categoryId || null,
    supplier_id: input.supplierId || null,
    amount: input.amount,
    period_months: input.periodMonths,
    start_year: input.startYear,
    start_month: input.startMonth,
    end_year: input.endYear ?? null,
    end_month: input.endMonth ?? null,
    notes: input.notes || null
  }
}

function normalizeAmounts(row) {
  return { ...row, amount: Number(row.amount) }
}
