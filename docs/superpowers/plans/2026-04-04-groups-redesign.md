# Groups Module Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simple morning/afternoon group DnD with a structured shifts → time slots → activities → client assignments system, with 15-day history, templates, and clone-drag interaction.

**Architecture:** New Supabase migration drops old group tables, creates 6 new tables (3 day + 3 template) with cascade deletes, a BEFORE INSERT trigger for one-activity-per-slot constraint, and RLS policies. Service layer is a full rewrite of `groupService.js`. Frontend is a rewrite of `DailyGroups.jsx` split into focused subcomponents, using `@dnd-kit/core` for clone-drag (dropping `@dnd-kit/sortable`).

**Tech Stack:** React 19, Supabase (PostgreSQL), @dnd-kit/core, Tailwind CSS 3, date-fns, iconoir-react

**Spec:** `docs/superpowers/specs/2026-04-04-groups-redesign-design.md`

---

## File Structure

### Files to Create
- `supabase/migrations/014_groups_redesign.sql` — migration: drop old tables, create 6 new tables, trigger, indexes, RLS
- `src/services/groups/groupService.js` — full rewrite: CRUD for time slots, activities, assignments, templates
- `src/pages/Groups/DailyGroups.jsx` — full rewrite: main page with day nav, shift tabs, DnD context
- `src/pages/Groups/TimeSlotCard.jsx` — time slot card with nested activities
- `src/pages/Groups/ActivityCard.jsx` — activity drop zone with client chips
- `src/pages/Groups/ClientChip.jsx` — draggable client chip (pool + assigned)
- `src/pages/Groups/ClientPool.jsx` — right-side client pool panel with search
- `src/pages/Groups/TemplateModal.jsx` — template management modal (grid + detail screens)

### Files to Modify
- `src/services/api.js` — update group re-exports to new service functions

### Files to Delete (handled by migration)
- DB tables `daily_groups`, `daily_group_members` dropped in migration

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/014_groups_redesign.sql`

This task creates the entire database schema. Apply via Supabase MCP tool `apply_migration`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/014_groups_redesign.sql` with the following content:

```sql
-- ============================================
-- 014: Groups Redesign
-- Replaces daily_groups/daily_group_members with
-- time slots → activities → assignments hierarchy
-- plus template tables
-- ============================================

-- ============================================
-- Step 1 — Drop old tables
-- ============================================

DROP TABLE IF EXISTS daily_group_members CASCADE;
DROP TABLE IF EXISTS daily_groups CASCADE;

-- ============================================
-- Step 2 — Day tables
-- ============================================

CREATE TABLE group_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('morning', 'afternoon')),
  name TEXT NOT NULL,
  time TIME NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE group_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time_slot_id UUID NOT NULL REFERENCES group_time_slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  responsible TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE group_activity_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES group_activities(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (activity_id, client_id)
);

-- ============================================
-- Step 3 — Template tables
-- ============================================

CREATE TABLE group_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('morning', 'afternoon')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE group_template_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES group_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  time TIME NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE group_template_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_slot_id UUID NOT NULL REFERENCES group_template_slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  responsible TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

-- ============================================
-- Step 4 — Indexes
-- ============================================

CREATE INDEX idx_group_time_slots_date_shift ON group_time_slots(date, shift);
CREATE INDEX idx_group_activities_slot ON group_activities(time_slot_id);
CREATE INDEX idx_group_assignments_activity ON group_activity_assignments(activity_id);
CREATE INDEX idx_group_assignments_client ON group_activity_assignments(client_id);
CREATE INDEX idx_group_template_slots_template ON group_template_slots(template_id);
CREATE INDEX idx_group_template_activities_slot ON group_template_activities(template_slot_id);

-- ============================================
-- Step 5 — One-activity-per-slot constraint trigger
-- ============================================

CREATE OR REPLACE FUNCTION check_one_activity_per_slot()
RETURNS TRIGGER AS $$
DECLARE
  v_time_slot_id UUID;
BEGIN
  -- Find the time slot for the activity being assigned to
  SELECT time_slot_id INTO v_time_slot_id
  FROM group_activities
  WHERE id = NEW.activity_id;

  -- Check if this client is already assigned to another activity in the same time slot
  IF EXISTS (
    SELECT 1
    FROM group_activity_assignments gaa
    JOIN group_activities ga ON ga.id = gaa.activity_id
    WHERE ga.time_slot_id = v_time_slot_id
      AND gaa.client_id = NEW.client_id
      AND gaa.activity_id != NEW.activity_id
  ) THEN
    RAISE EXCEPTION 'Client % is already assigned to another activity in time slot %',
      NEW.client_id, v_time_slot_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_one_activity_per_slot
  BEFORE INSERT ON group_activity_assignments
  FOR EACH ROW
  EXECUTE FUNCTION check_one_activity_per_slot();

-- ============================================
-- Step 6 — updated_at trigger for templates
-- ============================================

CREATE TRIGGER update_group_templates_updated_at
  BEFORE UPDATE ON group_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Step 7 — RLS policies
-- ============================================

ALTER TABLE group_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_activity_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_template_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_template_activities ENABLE ROW LEVEL SECURITY;

-- group_time_slots
CREATE POLICY "group_time_slots_select" ON group_time_slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_time_slots_insert" ON group_time_slots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_time_slots_update" ON group_time_slots FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_time_slots_delete" ON group_time_slots FOR DELETE TO authenticated USING (true);

-- group_activities
CREATE POLICY "group_activities_select" ON group_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_activities_insert" ON group_activities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_activities_update" ON group_activities FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_activities_delete" ON group_activities FOR DELETE TO authenticated USING (true);

-- group_activity_assignments
CREATE POLICY "group_assignments_select" ON group_activity_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_assignments_insert" ON group_activity_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_assignments_update" ON group_activity_assignments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_assignments_delete" ON group_activity_assignments FOR DELETE TO authenticated USING (true);

-- group_templates
CREATE POLICY "group_templates_select" ON group_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_templates_insert" ON group_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_templates_update" ON group_templates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_templates_delete" ON group_templates FOR DELETE TO authenticated USING (true);

-- group_template_slots
CREATE POLICY "group_template_slots_select" ON group_template_slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_template_slots_insert" ON group_template_slots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_template_slots_update" ON group_template_slots FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_template_slots_delete" ON group_template_slots FOR DELETE TO authenticated USING (true);

-- group_template_activities
CREATE POLICY "group_template_activities_select" ON group_template_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_template_activities_insert" ON group_template_activities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_template_activities_update" ON group_template_activities FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_template_activities_delete" ON group_template_activities FOR DELETE TO authenticated USING (true);
```

- [ ] **Step 2: Apply the migration**

Run via Supabase MCP: `apply_migration` with name `groups_redesign` and the SQL above.

- [ ] **Step 3: Verify tables exist**

Run via Supabase MCP: `list_tables` and confirm all 6 new tables appear and old `daily_groups`/`daily_group_members` are gone.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/014_groups_redesign.sql
git commit -m "feat: add groups redesign migration — time slots, activities, templates"
```

---

## Task 2: Service Layer — Day Operations

**Files:**
- Create: `src/services/groups/groupService.js` (full rewrite)

This task builds the service functions for day-to-day group operations (CRUD for time slots, activities, assignments, cleanup). Template functions come in Task 3.

- [ ] **Step 1: Write the day operations service**

Rewrite `src/services/groups/groupService.js` with these functions:

```javascript
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
  // fields can include: name, time, position
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
  // fields can include: name, responsible, position
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
```

- [ ] **Step 2: Verify the service file compiles (no syntax errors)**

```bash
cd /Users/nacholorenzo/Desktop/nacho/software/gervital && npx -y acorn --ecma2020 --module src/services/groups/groupService.js > /dev/null
```

Or simply run `npm start` and confirm no import/syntax errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/groups/groupService.js
git commit -m "feat: rewrite groupService with time slot, activity, assignment CRUD"
```

---

## Task 3: Service Layer — Template Operations

**Files:**
- Modify: `src/services/groups/groupService.js` (append template functions)

- [ ] **Step 1: Add template functions to groupService.js**

Append these functions to the end of `src/services/groups/groupService.js`:

```javascript
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
  // Create template
  const { data: tmpl, error: tmplErr } = await supabase
    .from('group_templates')
    .insert({ name, shift })
    .select('id')
    .single()
  if (tmplErr) throw new Error(tmplErr.message)

  // Insert slots and their activities
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
  // 1. Get template detail
  const template = await getTemplateDetail(templateId)

  // 2. Delete existing day data for this date+shift
  const { error: delErr } = await supabase
    .from('group_time_slots')
    .delete()
    .eq('date', dateStr)
    .eq('shift', shift)
  if (delErr) throw new Error(delErr.message)

  // 3. Copy slots and activities (no client assignments)
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
  // Get current day structure (without client assignments)
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

// Template slot/activity CRUD for the template editor

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
```

- [ ] **Step 2: Update api.js re-exports**

Replace the current groups imports in `src/services/api.js`. The old file imports from `./groups/groupService` (getGroupsForDate, saveShiftGroups, etc.). Replace with the new exports. Add at the bottom of `api.js`:

```javascript
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
```

Note: the old `groupService` functions are NOT exported from `api.js` currently (DailyGroups.jsx imports directly from the service), so this is purely additive.

- [ ] **Step 3: Commit**

```bash
git add src/services/groups/groupService.js src/services/api.js
git commit -m "feat: add template operations and update api.js re-exports"
```

---

## Task 4: ClientChip and ClientPool Components

**Files:**
- Create: `src/pages/Groups/ClientChip.jsx`
- Create: `src/pages/Groups/ClientPool.jsx`

These are the building blocks: the draggable client chip and the right-side pool panel.

- [ ] **Step 1: Create ClientChip.jsx**

`src/pages/Groups/ClientChip.jsx` — a client chip used in both the pool (draggable source) and inside activities (with X to remove). Uses `@dnd-kit/core`'s `useDraggable`.

```jsx
import { useDraggable } from '@dnd-kit/core'
import { Xmark } from 'iconoir-react'

const COGNITIVE_LEVEL_COLORS = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-amber-100 text-amber-700',
  D: 'bg-red-100 text-red-700'
}

// Pool chip — draggable source that creates clones
export function PoolClientChip({ client }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pool-${client.id}`,
    data: { type: 'pool-client', client }
  })

  const initials = `${client.firstName?.[0] || ''}${client.lastName?.[0] || ''}`

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 px-3 py-2.5 bg-white border border-gray-200 rounded-lg cursor-grab active:cursor-grabbing select-none transition-opacity ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      {client.avatarUrl ? (
        <img src={client.avatarUrl} alt={initials} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-semibold text-gray-600 flex-shrink-0">
          {initials}
        </div>
      )}
      <span className="text-sm text-gray-800 font-medium flex-1 truncate">
        {client.firstName} {client.lastName}
      </span>
      <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${COGNITIVE_LEVEL_COLORS[client.cognitiveLevel] || 'bg-gray-100 text-gray-600'}`}>
        {client.cognitiveLevel}
      </span>
    </div>
  )
}

// Assigned chip — inside an activity, with remove button
export function AssignedClientChip({ client, onRemove, readOnly }) {
  const initials = `${client.firstName?.[0] || ''}${client.lastName?.[0] || ''}`

  return (
    <div className="group flex items-center gap-1.5 px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-sm">
      {client.avatarUrl ? (
        <img src={client.avatarUrl} alt={initials} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-semibold text-gray-600 flex-shrink-0">
          {initials}
        </div>
      )}
      <span className="text-gray-800 font-medium truncate">
        {client.firstName} {client.lastName?.[0]}.
      </span>
      <span className={`px-1 py-0.5 text-[9px] font-semibold rounded ${COGNITIVE_LEVEL_COLORS[client.cognitiveLevel] || 'bg-gray-100 text-gray-600'}`}>
        {client.cognitiveLevel}
      </span>
      {!readOnly && onRemove && (
        <button
          onClick={onRemove}
          className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition-opacity"
          title="Quitar"
        >
          <Xmark className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create ClientPool.jsx**

`src/pages/Groups/ClientPool.jsx` — right-side panel with search and draggable chips.

```jsx
import { useState } from 'react'
import { PoolClientChip } from './ClientChip'

export default function ClientPool({ clients }) {
  const [search, setSearch] = useState('')

  const filtered = search
    ? clients.filter(c => {
        const term = search.toLowerCase()
        return (
          c.firstName?.toLowerCase().includes(term) ||
          c.lastName?.toLowerCase().includes(term)
        )
      })
    : clients

  return (
    <div className="w-60 flex-shrink-0 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Asistentes ({clients.length})
      </div>
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar..."
        className="w-full px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg mb-3 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
      <div className="flex flex-col gap-1.5">
        {filtered.map(client => (
          <PoolClientChip key={client.id} client={client} />
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">Sin resultados</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Groups/ClientChip.jsx src/pages/Groups/ClientPool.jsx
git commit -m "feat: add ClientChip and ClientPool components for groups"
```

---

## Task 5: ActivityCard and TimeSlotCard Components

**Files:**
- Create: `src/pages/Groups/ActivityCard.jsx`
- Create: `src/pages/Groups/TimeSlotCard.jsx`

- [ ] **Step 1: Create ActivityCard.jsx**

`src/pages/Groups/ActivityCard.jsx` — a drop zone for client assignments. Shows activity name, responsible, and assigned client chips.

```jsx
import { useDroppable } from '@dnd-kit/core'
import { Trash, Plus } from 'iconoir-react'
import { AssignedClientChip } from './ClientChip'

export default function ActivityCard({
  activity,
  slotId,
  clientsById,
  onRemoveClient,
  onUpdateActivity,
  onDeleteActivity,
  readOnly,
  isInvalidDrop   // true when a dragged client would violate the one-per-slot rule
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `activity-${activity.id}`,
    data: { type: 'activity', activityId: activity.id, slotId }
  })

  const dropHighlight = isOver
    ? isInvalidDrop
      ? 'border-red-400 bg-red-50'
      : 'border-indigo-400 bg-indigo-50'
    : 'border-gray-200 bg-gray-50'

  const assignedClients = activity.clientIds
    .map(id => clientsById.get(id))
    .filter(Boolean)

  return (
    <div
      ref={setNodeRef}
      className={`border border-dashed rounded-lg p-3 min-h-[56px] transition-colors ${dropHighlight}`}
    >
      {/* Activity header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {readOnly ? (
            <span className="text-sm font-semibold text-gray-700 truncate">{activity.name}</span>
          ) : (
            <input
              defaultValue={activity.name}
              onBlur={e => {
                const val = e.target.value.trim()
                if (val && val !== activity.name) onUpdateActivity(activity.id, { name: val })
              }}
              className="text-sm font-semibold text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none truncate flex-1"
            />
          )}
          {readOnly ? (
            activity.responsible && <span className="text-[10px] text-gray-400 flex-shrink-0">{activity.responsible}</span>
          ) : (
            <input
              defaultValue={activity.responsible || ''}
              placeholder="Responsable"
              onBlur={e => {
                const val = e.target.value.trim()
                if (val !== (activity.responsible || '')) onUpdateActivity(activity.id, { responsible: val || null })
              }}
              className="text-[10px] text-gray-400 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none w-24 flex-shrink-0"
            />
          )}
        </div>
        {!readOnly && (
          <button
            onClick={() => onDeleteActivity(activity.id)}
            className="p-1 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
            title="Eliminar actividad"
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Client chips */}
      <div className="flex flex-wrap gap-1.5">
        {assignedClients.map(client => (
          <AssignedClientChip
            key={client.id}
            client={client}
            readOnly={readOnly}
            onRemove={() => onRemoveClient(activity.id, client.id)}
          />
        ))}
        {assignedClients.length === 0 && (
          <p className="text-xs text-gray-400 py-1">Arrastrá asistentes aquí</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create TimeSlotCard.jsx**

`src/pages/Groups/TimeSlotCard.jsx` — a time slot card containing its activities stacked vertically.

```jsx
import { Trash, Plus } from 'iconoir-react'
import ActivityCard from './ActivityCard'

export default function TimeSlotCard({
  slot,
  clientsById,
  onRemoveClient,
  onUpdateSlot,
  onDeleteSlot,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
  readOnly,
  invalidDropSlotId,   // slotId that would be invalid for the currently dragged client
  draggedClientId       // clientId being dragged (to check per-activity conflicts)
}) {

  function isInvalidDropForActivity(activity) {
    if (!draggedClientId || invalidDropSlotId !== slot.id) return false
    // Only flag activities that the client is NOT already in
    // (the one they're in is a no-op, not a violation)
    return !activity.clientIds.includes(draggedClientId)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Slot header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {readOnly ? (
            <>
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded flex-shrink-0">
                {slot.time?.slice(0, 5)}
              </span>
              <span className="text-sm font-semibold text-gray-700 truncate">{slot.name}</span>
            </>
          ) : (
            <>
              <input
                type="time"
                defaultValue={slot.time?.slice(0, 5)}
                onBlur={e => {
                  const val = e.target.value
                  if (val && val !== slot.time?.slice(0, 5)) onUpdateSlot(slot.id, { time: val })
                }}
                className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded w-[72px] flex-shrink-0 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <input
                defaultValue={slot.name}
                onBlur={e => {
                  const val = e.target.value.trim()
                  if (val && val !== slot.name) onUpdateSlot(slot.id, { name: val })
                }}
                className="text-sm font-semibold text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none truncate flex-1"
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400">
            {slot.activities.length} {slot.activities.length === 1 ? 'actividad' : 'actividades'}
          </span>
          {!readOnly && (
            <>
              <button
                onClick={() => onAddActivity(slot.id)}
                className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
                title="Agregar actividad"
              >
                + Actividad
              </button>
              <button
                onClick={() => onDeleteSlot(slot.id)}
                className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                title="Eliminar horario"
              >
                <Trash className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Activities list */}
      <div className="p-3 flex flex-col gap-2">
        {slot.activities.map(activity => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            slotId={slot.id}
            clientsById={clientsById}
            onRemoveClient={onRemoveClient}
            onUpdateActivity={onUpdateActivity}
            onDeleteActivity={onDeleteActivity}
            readOnly={readOnly}
            isInvalidDrop={isInvalidDropForActivity(activity)}
          />
        ))}
        {slot.activities.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-3">Sin actividades</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Groups/ActivityCard.jsx src/pages/Groups/TimeSlotCard.jsx
git commit -m "feat: add ActivityCard and TimeSlotCard components"
```

---

## Task 6: Main DailyGroups Page (DnD, Day Nav, Shift Tabs)

**Files:**
- Rewrite: `src/pages/Groups/DailyGroups.jsx`

This is the main page component tying everything together: day navigation, shift tabs, DnD context, data loading.

- [ ] **Step 1: Rewrite DailyGroups.jsx**

Full rewrite of `src/pages/Groups/DailyGroups.jsx`. Key behaviors:

- **Day navigation**: `selectedDate` state, left/right arrows, "Hoy" button. Back arrow disabled at today - 14 days. Forward disabled on today.
- **Shift tabs**: `activeShift` state (`'morning'` | `'afternoon'`).
- **Data loading**: on mount and when `selectedDate`/`activeShift` changes, call `getTimeSlotsForDate` and filter clients for the shift.
- **DnD**: single `DndContext` from `@dnd-kit/core`. On drag start, capture the dragged client. On drag end, if dropped on a valid activity drop zone, call `assignClientToActivity`. Validation: check if client is already in another activity of the same time slot.
- **Read-only mode**: when `selectedDate` is not today, hide all edit controls and disable DnD.
- **Cleanup**: call `cleanupOldGroups` on mount.

The code should import `TimeSlotCard`, `ClientPool`, and the service functions. Use `date-fns` for date manipulation (`addDays`, `subDays`, `format`, `isToday`, `differenceInCalendarDays`).

Structure:
```
Page header (title + date + nav arrows + Hoy + Plantillas button)
Shift tabs
Main area:
  Left: time slots list + "Agregar horario" button
  Right: ClientPool
DndContext wraps the main area
DragOverlay shows a ghost ClientChip while dragging
```

The component should be ~200-300 lines. The DnD logic is simpler than current (no sortable, no cross-container moves — just drop-to-assign). Full code to be written during implementation; the structure above is the blueprint.

- [ ] **Step 2: Compile Tailwind**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
```

- [ ] **Step 3: Run the app and verify the page loads**

```bash
npm start
```

Navigate to `/grupos`, verify:
- Day navigation works (arrows, Hoy button)
- Shift tabs switch content
- Time slot/activity structure renders
- Client pool shows on the right
- Dragging from pool to activity works
- X button removes clients from activities
- Past days show read-only

- [ ] **Step 4: Commit**

```bash
git add src/pages/Groups/DailyGroups.jsx src/tailwind.output.css
git commit -m "feat: rewrite DailyGroups with day nav, shift tabs, clone-drag DnD"
```

---

## Task 7: Template Modal

**Files:**
- Create: `src/pages/Groups/TemplateModal.jsx`
- Modify: `src/pages/Groups/DailyGroups.jsx` (add template modal trigger)

The template modal has two screens with in-modal navigation:

**Screen 1 (Grid):**
- 2x2 grid of template cards, filtered by active shift
- Client-side pagination slider (page state, 4 per page)
- "Guardar actual" button → prompts for name, calls `saveCurrentAsTemplate`
- "Nueva plantilla" button → creates blank template, navigates to Screen 2

**Screen 2 (Detail):**
- Back arrow + template name as header (editable)
- Time slots + activities editor (same visual structure, no clients)
- Add/remove slots and activities with inline editing
- "Aplicar" → calls `applyTemplate`, with confirmation if day has data
- "Eliminar" → deletes template with confirmation
- "Guardar cambios" → saves edits

- [ ] **Step 1: Create TemplateModal.jsx**

Full implementation of the two-screen template modal. Uses the existing `Modal` component from `src/components/ui/Modal` and `Button` from `src/components/ui/Button`. Service calls: `getTemplates`, `getTemplateDetail`, `saveTemplate`, `updateTemplateName`, `deleteTemplate`, `applyTemplate`, `saveCurrentAsTemplate`, and template slot/activity CRUD functions.

- [ ] **Step 2: Wire up in DailyGroups.jsx**

Add state `showTemplateModal` to DailyGroups. The "Plantillas" button in the header sets it to true. Pass `activeShift`, `selectedDate`, and an `onApplied` callback (to reload the day data) as props.

- [ ] **Step 3: Test template flows**

Verify:
- Modal opens with filtered templates for active shift
- "Guardar actual" saves current structure as template
- "Nueva plantilla" creates blank and opens editor
- Clicking a template opens detail view with back navigation
- Editing slots/activities works
- "Aplicar" copies skeleton to today (with override warning if data exists)
- "Eliminar" deletes template
- Pagination slider works when > 4 templates exist

- [ ] **Step 4: Compile Tailwind and commit**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
git add src/pages/Groups/TemplateModal.jsx src/pages/Groups/DailyGroups.jsx src/tailwind.output.css
git commit -m "feat: add template modal with grid/detail screens"
```

---

## Task 8: Polish and Final Verification

**Files:**
- Various touch-ups across Groups components

- [ ] **Step 1: Invalid drop feedback**

In `DailyGroups.jsx`, track which time slots would be invalid for the currently dragged client (check if client already has an assignment in any activity of that slot). Pass this info to `TimeSlotCard` → `ActivityCard` so invalid drop zones show a red border.

- [ ] **Step 2: Weekend handling**

When navigated to a weekend day, show the same "no attendees" placeholder (the client filtering already handles this since no client has `saturday`/`sunday` in assignedDays).

- [ ] **Step 3: DragOverlay ghost chip**

Ensure the `DragOverlay` in `DailyGroups.jsx` renders a semi-transparent `ClientChip` while dragging from the pool.

- [ ] **Step 4: Compile Tailwind, full smoke test**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
npm start
```

Full test:
- Create time slots and activities on today
- Drag clients from pool into activities
- Verify one-per-slot constraint (drag to a second activity in same slot should be rejected)
- Remove clients via X button
- Navigate to yesterday — verify read-only
- Navigate back 14 days — verify back arrow disables
- Open template modal, save current as template
- Apply template to a blank day
- Create template from scratch in editor

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: polish groups redesign — invalid drop feedback, drag overlay, weekend handling"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Database migration | `014_groups_redesign.sql` |
| 2 | Service — day operations | `groupService.js` |
| 3 | Service — template operations | `groupService.js`, `api.js` |
| 4 | ClientChip + ClientPool | `ClientChip.jsx`, `ClientPool.jsx` |
| 5 | ActivityCard + TimeSlotCard | `ActivityCard.jsx`, `TimeSlotCard.jsx` |
| 6 | Main DailyGroups page | `DailyGroups.jsx` |
| 7 | Template modal | `TemplateModal.jsx` |
| 8 | Polish + final verification | Various |
