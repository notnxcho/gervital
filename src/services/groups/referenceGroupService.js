import { supabase } from '../supabase/client'

// Snapshot the current day (dateStr, shift) as the reference group for (weekday, shift).
export async function saveReferenceGroup(dateStr, shift, weekday) {
  const { data, error } = await supabase.rpc('save_reference_group', {
    p_date: dateStr, p_shift: shift, p_weekday: weekday
  })
  if (error) throw new Error(error.message)
  return data
}

// Apply the reference group for (weekday, shift) onto (dateStr, shift), overwriting.
// Only clients in presentIds get assigned.
export async function applyReferenceGroup(weekday, shift, dateStr, presentIds) {
  const { error } = await supabase.rpc('apply_reference_group', {
    p_weekday: weekday, p_shift: shift, p_date: dateStr, p_present_ids: presentIds
  })
  if (error) throw new Error(error.message)
}

// Existence + last-updated for a (weekday, shift) reference group.
export async function getReferenceGroupInfo(weekday, shift) {
  const { data, error } = await supabase
    .from('reference_groups')
    .select('updated_at')
    .eq('weekday', weekday)
    .eq('shift', shift)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return { exists: !!data, updatedAt: data?.updated_at || null }
}
