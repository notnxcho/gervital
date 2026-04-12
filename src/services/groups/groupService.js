import { supabase } from '../supabase/client'

// ── Day Operations ───────────────────────────────────────────────────────────

export async function getTimeSlotsForDate(dateStr, shift) {
  const { data, error } = await supabase
    .from('group_time_slots')
    .select(`
      id, date, shift, name, time, position,
      group_activities (
        id, name, responsible, position,
        group_activity_assignments (
          id, activity_id, client_id
        )
      )
    `)
    .eq('date', dateStr)
    .eq('shift', shift)
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)

  return (data || []).map(slot => ({
    id: slot.id,
    date: slot.date,
    shift: slot.shift,
    name: slot.name,
    time: slot.time,
    position: slot.position,
    activities: (slot.group_activities || [])
      .sort((a, b) => a.position - b.position)
      .map(act => ({
        id: act.id,
        name: act.name,
        responsible: act.responsible,
        position: act.position,
        clientIds: (act.group_activity_assignments || []).map(a => a.client_id)
      }))
  }))
}

export async function createTimeSlot(dateStr, shift, { name, time, position }) {
  const { data, error } = await supabase
    .from('group_time_slots')
    .insert({ date: dateStr, shift, name, time, position })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function updateTimeSlot(slotId, fields) {
  const { error } = await supabase
    .from('group_time_slots')
    .update(fields)
    .eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function deleteTimeSlot(slotId) {
  const { error } = await supabase
    .from('group_time_slots')
    .delete()
    .eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function createActivity(slotId, { name, responsible, position }) {
  const { data, error } = await supabase
    .from('group_activities')
    .insert({ time_slot_id: slotId, name, responsible: responsible || null, position })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function updateActivity(activityId, fields) {
  const { error } = await supabase
    .from('group_activities')
    .update(fields)
    .eq('id', activityId)
  if (error) throw new Error(error.message)
}

export async function deleteActivity(activityId) {
  const { error } = await supabase
    .from('group_activities')
    .delete()
    .eq('id', activityId)
  if (error) throw new Error(error.message)
}

export async function assignClientToActivity(activityId, clientId) {
  const { error } = await supabase
    .from('group_activity_assignments')
    .insert({ activity_id: activityId, client_id: clientId })
  if (error) throw new Error(error.message)
}

export async function removeClientFromActivity(activityId, clientId) {
  const { error } = await supabase
    .from('group_activity_assignments')
    .delete()
    .eq('activity_id', activityId)
    .eq('client_id', clientId)
  if (error) throw new Error(error.message)
}

export async function cleanupOldGroups(todayStr) {
  const cutoff = new Date(todayStr)
  cutoff.setDate(cutoff.getDate() - 14)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const { error } = await supabase
    .from('group_time_slots')
    .delete()
    .lt('date', cutoffStr)
  if (error) throw new Error(error.message)
}

// ── Template Operations ──────────────────────────────────────────────────────

export async function getTemplates(shift) {
  let query = supabase
    .from('group_templates')
    .select(`
      id, name, shift, updated_at,
      group_template_slots (
        id, name, time, position,
        group_template_activities ( id, name, responsible, position )
      )
    `)
    .order('updated_at', { ascending: false })

  if (shift) query = query.eq('shift', shift)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (data || []).map(t => ({
    id: t.id,
    name: t.name,
    shift: t.shift,
    updatedAt: t.updated_at,
    slotCount: (t.group_template_slots || []).length,
    activityCount: (t.group_template_slots || []).reduce(
      (sum, s) => sum + (s.group_template_activities || []).length, 0
    )
  }))
}

export async function getTemplateDetail(templateId) {
  const { data, error } = await supabase
    .from('group_templates')
    .select(`
      id, name, shift, updated_at,
      group_template_slots (
        id, name, time, position,
        group_template_activities ( id, name, responsible, position )
      )
    `)
    .eq('id', templateId)
    .single()

  if (error) throw new Error(error.message)

  return {
    id: data.id,
    name: data.name,
    shift: data.shift,
    updatedAt: data.updated_at,
    slots: (data.group_template_slots || [])
      .sort((a, b) => a.position - b.position)
      .map(s => ({
        id: s.id,
        name: s.name,
        time: s.time,
        position: s.position,
        activities: (s.group_template_activities || [])
          .sort((a, b) => a.position - b.position)
          .map(a => ({
            id: a.id,
            name: a.name,
            responsible: a.responsible,
            position: a.position
          }))
      }))
  }
}

export async function saveTemplate({ name, shift, slots }) {
  const { data: tmpl, error: tmplErr } = await supabase
    .from('group_templates')
    .insert({ name, shift })
    .select('id')
    .single()
  if (tmplErr) throw new Error(tmplErr.message)

  for (const slot of slots) {
    const { data: slotRow, error: slotErr } = await supabase
      .from('group_template_slots')
      .insert({ template_id: tmpl.id, name: slot.name, time: slot.time, position: slot.position })
      .select('id')
      .single()
    if (slotErr) throw new Error(slotErr.message)

    if (slot.activities?.length > 0) {
      const actRows = slot.activities.map(a => ({
        template_slot_id: slotRow.id,
        name: a.name,
        responsible: a.responsible || null,
        position: a.position
      }))
      const { error: actErr } = await supabase
        .from('group_template_activities')
        .insert(actRows)
      if (actErr) throw new Error(actErr.message)
    }
  }

  return tmpl.id
}

export async function updateTemplateName(templateId, name) {
  const { error } = await supabase
    .from('group_templates')
    .update({ name })
    .eq('id', templateId)
  if (error) throw new Error(error.message)
}

export async function deleteTemplate(templateId) {
  const { error } = await supabase
    .from('group_templates')
    .delete()
    .eq('id', templateId)
  if (error) throw new Error(error.message)
}

export async function applyTemplate(templateId, dateStr, shift) {
  const template = await getTemplateDetail(templateId)

  const { error: delErr } = await supabase
    .from('group_time_slots')
    .delete()
    .eq('date', dateStr)
    .eq('shift', shift)
  if (delErr) throw new Error(delErr.message)

  for (const slot of template.slots) {
    const { data: newSlot, error: slotErr } = await supabase
      .from('group_time_slots')
      .insert({ date: dateStr, shift, name: slot.name, time: slot.time, position: slot.position })
      .select('id')
      .single()
    if (slotErr) throw new Error(slotErr.message)

    if (slot.activities.length > 0) {
      const actRows = slot.activities.map(a => ({
        time_slot_id: newSlot.id,
        name: a.name,
        responsible: a.responsible || null,
        position: a.position
      }))
      const { error: actErr } = await supabase
        .from('group_activities')
        .insert(actRows)
      if (actErr) throw new Error(actErr.message)
    }
  }
}

export async function saveCurrentAsTemplate(dateStr, shift, name) {
  const slots = await getTimeSlotsForDate(dateStr, shift)

  const templateSlots = slots.map(s => ({
    name: s.name,
    time: s.time,
    position: s.position,
    activities: s.activities.map(a => ({
      name: a.name,
      responsible: a.responsible,
      position: a.position
    }))
  }))

  return saveTemplate({ name, shift, slots: templateSlots })
}

export async function createTemplateSlot(templateId, { name, time, position }) {
  const { data, error } = await supabase
    .from('group_template_slots')
    .insert({ template_id: templateId, name, time, position })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function updateTemplateSlot(slotId, fields) {
  const { error } = await supabase
    .from('group_template_slots')
    .update(fields)
    .eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function deleteTemplateSlot(slotId) {
  const { error } = await supabase
    .from('group_template_slots')
    .delete()
    .eq('id', slotId)
  if (error) throw new Error(error.message)
}

export async function createTemplateActivity(slotId, { name, responsible, position }) {
  const { data, error } = await supabase
    .from('group_template_activities')
    .insert({ template_slot_id: slotId, name, responsible: responsible || null, position })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function updateTemplateActivity(activityId, fields) {
  const { error } = await supabase
    .from('group_template_activities')
    .update(fields)
    .eq('id', activityId)
  if (error) throw new Error(error.message)
}

export async function deleteTemplateActivity(activityId) {
  const { error } = await supabase
    .from('group_template_activities')
    .delete()
    .eq('id', activityId)
  if (error) throw new Error(error.message)
}
