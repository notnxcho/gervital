import { supabase } from '../supabase/client'

/**
 * Get all groups for a specific date, organized by shift
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {Promise<{ morning: Array, afternoon: Array }>}
 */
export async function getGroupsForDate(dateStr) {
  const { data, error } = await supabase
    .from('daily_groups')
    .select(`
      id,
      name,
      shift,
      position,
      daily_group_members (
        client_id,
        position
      )
    `)
    .eq('date', dateStr)
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)

  const morning = []
  const afternoon = []

  for (const group of data) {
    const members = (group.daily_group_members || [])
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ clientId: m.client_id, position: m.position }))

    const shaped = { id: group.id, name: group.name, position: group.position, members }

    if (group.shift === 'morning') morning.push(shaped)
    else afternoon.push(shaped)
  }

  return { morning, afternoon }
}

/**
 * Save all groups for a date+shift (delete-and-reinsert for simplicity)
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} shift - 'morning' | 'afternoon'
 * @param {Array} groups - Array of { id?, name, position, members: [{ clientId, position }] }
 */
export async function saveShiftGroups(dateStr, shift, groups) {
  // Delete all existing groups for this date+shift (cascade deletes members)
  const { error: delError } = await supabase
    .from('daily_groups')
    .delete()
    .eq('date', dateStr)
    .eq('shift', shift)

  if (delError) throw new Error(delError.message)

  if (groups.length === 0) return

  // Insert groups
  const groupRows = groups.map((g, i) => ({
    date: dateStr,
    shift,
    name: g.name,
    position: i
  }))

  const { data: insertedGroups, error: groupError } = await supabase
    .from('daily_groups')
    .insert(groupRows)
    .select('id, position')

  if (groupError) throw new Error(groupError.message)

  // Build members rows using the new group IDs (matched by position index)
  const memberRows = []
  for (let i = 0; i < groups.length; i++) {
    const newGroupId = insertedGroups[i].id
    const groupMembers = groups[i].members || []
    groupMembers.forEach((m, j) => {
      memberRows.push({ group_id: newGroupId, client_id: m.clientId, position: j })
    })
  }

  if (memberRows.length > 0) {
    const { error: memberError } = await supabase
      .from('daily_group_members')
      .insert(memberRows)

    if (memberError) throw new Error(memberError.message)
  }
}

/**
 * Update only the name of a group
 * @param {string} groupId - Group UUID
 * @param {string} name - New name
 */
export async function updateGroupName(groupId, name) {
  const { error } = await supabase
    .from('daily_groups')
    .update({ name })
    .eq('id', groupId)

  if (error) throw new Error(error.message)
}

/**
 * Delete a single group (cascade deletes its members)
 * @param {string} groupId - Group UUID
 */
export async function deleteGroup(groupId) {
  const { error } = await supabase
    .from('daily_groups')
    .delete()
    .eq('id', groupId)

  if (error) throw new Error(error.message)
}

/**
 * Delete groups from days before the given date (cleanup)
 * @param {string} dateStr - Date in YYYY-MM-DD format (exclusive lower bound)
 */
export async function cleanupPastGroups(dateStr) {
  const { error } = await supabase
    .from('daily_groups')
    .delete()
    .lt('date', dateStr)

  if (error) throw new Error(error.message)
}
