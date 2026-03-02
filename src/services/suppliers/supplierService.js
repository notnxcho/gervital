import { supabase } from '../supabase/client'

/**
 * Supplier categories constant
 */
export const SUPPLIER_CATEGORIES = [
  'Alimentación',
  'Limpieza',
  'Transporte',
  'Salud',
  'Insumos',
  'Mantenimiento',
  'Servicios profesionales',
  'Otros'
]

/**
 * Get all suppliers
 * @returns {Promise<Array>}
 */
export async function getSuppliers() {
  const { data, error } = await supabase
    .from('suppliers_view')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Get supplier by ID
 * @param {string} id - Supplier UUID
 * @returns {Promise<object|null>}
 */
export async function getSupplierById(id) {
  const { data, error } = await supabase
    .from('suppliers_view')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw new Error(error.message)
  }

  return data
}

/**
 * Create a new supplier
 * @param {object} supplierData
 * @returns {Promise<object>}
 */
export async function createSupplier(supplierData) {
  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      name: supplierData.name,
      category: supplierData.category,
      contact: supplierData.contact || null,
      phone: supplierData.phone || null,
      email: supplierData.email || null,
      notes: supplierData.notes || null
    })
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return {
    ...data,
    createdAt: data.created_at
  }
}

/**
 * Update a supplier
 * @param {string} id - Supplier UUID
 * @param {object} supplierData
 * @returns {Promise<object>}
 */
export async function updateSupplier(id, supplierData) {
  const updateData = {}

  if (supplierData.name !== undefined) updateData.name = supplierData.name
  if (supplierData.category !== undefined) updateData.category = supplierData.category
  if (supplierData.contact !== undefined) updateData.contact = supplierData.contact
  if (supplierData.phone !== undefined) updateData.phone = supplierData.phone
  if (supplierData.email !== undefined) updateData.email = supplierData.email
  if (supplierData.notes !== undefined) updateData.notes = supplierData.notes

  const { data, error } = await supabase
    .from('suppliers')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return {
    ...data,
    createdAt: data.created_at
  }
}

/**
 * Delete a supplier
 * @param {string} id - Supplier UUID
 */
export async function deleteSupplier(id) {
  const { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}
