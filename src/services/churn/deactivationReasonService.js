import { supabase } from '../supabase/client'

const TABLE = 'deactivation_reasons'

export function slugify(label) {
  return (label || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function fromRow(r) {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    description: r.description,
    color: r.color,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    isSystem: r.is_system
  }
}

export async function getReasons({ includeInactive = false } = {}) {
  let query = supabase.from(TABLE).select('*').order('sort_order', { ascending: true })
  if (!includeInactive) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(fromRow)
}

export async function createReason({ key, label, description = '', color = '#64748b', sortOrder = 0 }) {
  const payload = {
    key: key || slugify(label),
    label,
    description,
    color,
    sort_order: sortOrder
  }
  const { data, error } = await supabase.from(TABLE).insert(payload).select().single()
  if (error) throw error
  return fromRow(data)
}

export async function updateReason(id, patch) {
  const row = {}
  if (patch.label !== undefined) row.label = patch.label
  if (patch.description !== undefined) row.description = patch.description
  if (patch.color !== undefined) row.color = patch.color
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select().single()
  if (error) throw error
  return fromRow(data)
}

export async function setReasonActive(id, isActive) {
  return updateReason(id, { isActive })
}

export async function reorderReasons(orderedIds) {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from(TABLE).update({ sort_order: index + 1 }).eq('id', id)
    )
  )
}
