import { supabase } from '../supabase/client'

// Get all expense categories (name + description), alphabetical.
export async function getCategories() {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(transformCategory)
}

export async function createCategory({ name, description }) {
  const { data, error } = await supabase
    .from('expense_categories')
    .insert({ name, description: description || null })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return transformCategory(data)
}

export async function updateCategory(id, { name, description }) {
  const update = {}
  if (name !== undefined) update.name = name
  if (description !== undefined) update.description = description
  const { data, error } = await supabase
    .from('expense_categories')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return transformCategory(data)
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('expense_categories').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

function transformCategory(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at
  }
}
