# Groups Module Redesign — Design Spec

## Overview

Redesign the Daily Groups module from a simple morning/afternoon group-based layout to a structured system of **shifts → time slots → activities → client assignments**, with 15-day history, templates, and clone-drag interaction.

## Current State

- Two side-by-side columns (morning/afternoon shifts)
- Each shift has drag-and-drop groups containing clients
- Today-only view, past data cleaned up on load
- DB tables: `daily_groups`, `daily_group_members`
- Auto-create groups by cognitive level
- Edit mode toggle for drag handles

## New System

### Core Hierarchy

```
Shift (morning | afternoon)
  └── Time Slot (name + time, user-created)
        └── Activity (name + optional responsible, user-created)
              └── Client assignments (drag from pool)
```

### Constraint

A client can only be assigned to **one activity per time slot**. They can appear in activities across different time slots within the same shift.

### Day Navigation

- Today + 14 days in the past (15 days total)
- Navigate with left/right arrows + "Hoy" button to jump back to today
- Forward arrow disabled on today
- Past days are **read-only**
- Weekends are included in navigation and count toward the 14 calendar days. Weekend days show the same "no attendees" message as current system
- Cleanup: delete `group_time_slots` where `date < today - 14 days` (cascades to activities and assignments). Triggered on page load (same pattern as current `cleanupPastGroups`)

## Data Model

### Day Tables

**`group_time_slots`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| date | date | |
| shift | text | `'morning'` or `'afternoon'` |
| name | text | e.g. "Taller 1" |
| time | time | e.g. 09:00 |
| position | int | ordering within shift+date |
| created_at | timestamptz | default now() |

**`group_activities`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| time_slot_id | uuid FK → group_time_slots | ON DELETE CASCADE |
| name | text | e.g. "Memoria", "Gimnasia" |
| responsible | text | nullable, free text |
| position | int | ordering within time slot |
| created_at | timestamptz | default now() |

**`group_activity_assignments`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| activity_id | uuid FK → group_activities | ON DELETE CASCADE |
| client_id | uuid FK → clients | ON DELETE CASCADE |
| created_at | timestamptz | default now() |
| | UNIQUE | (activity_id, client_id) |

**One-activity-per-slot constraint**: enforced via a `BEFORE INSERT` trigger on `group_activity_assignments`. The trigger joins `group_activities` to find the parent `time_slot_id`, then checks if any other assignment exists for the same `client_id` + `time_slot_id`. If found, it raises an exception. This prevents race conditions that app-level checks would miss.

**Indexes**:
- Composite index on `group_time_slots(date, shift)` — primary query pattern
- Index on `group_activities(time_slot_id)` — for nested lookups
- Index on `group_activity_assignments(activity_id)` — for nested lookups
- Index on `group_activity_assignments(client_id)` — for constraint trigger lookups

### Template Tables

**`group_templates`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | e.g. "Lunes estándar" |
| shift | text | `'morning'` or `'afternoon'` |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now(), auto-updated via trigger |

**`group_template_slots`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| template_id | uuid FK → group_templates | ON DELETE CASCADE |
| name | text | |
| time | time | |
| position | int | |

**`group_template_activities`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| template_slot_id | uuid FK → group_template_slots | ON DELETE CASCADE |
| name | text | |
| responsible | text | nullable |
| position | int | |

### Migration Plan

- New migration `014_groups_redesign.sql`
- Drop old `daily_group_members` and `daily_groups` tables
- Create all 6 new tables with indexes, RLS policies, and cascade deletes
- Add DB function for one-activity-per-slot validation
- Add cleanup function for 15-day retention

## UI Layout

### Page Structure

```
┌─────────────────────────────────────────────────────┐
│ Grupos del dia          ← → [Hoy]  [Plantillas]    │
│ Lunes 4 de abril, 2026                              │
├────────────┬────────────────────────────────────────-┤
│ [Mañana]   │  Tarde                                  │
├────────────┴─────────────────────┬───────────────────┤
│                                  │                   │
│  Time Slots (vertical stack)     │  Client Pool      │
│                                  │  - Search bar     │
│  ┌─ 09:00 Taller 1 ──────────┐  │  - Client chips   │
│  │  ┌── Memoria (Laura G.) ──┐│  │    (draggable,    │
│  │  │ [Maria R.] [Jorge L.]  ││  │     persistent)   │
│  │  └────────────────────────┘│  │                   │
│  │  ┌── Gimnasia (Carlos M.)─┐│  │                   │
│  │  │ [Ana P.] [Eduardo G.]  ││  │                   │
│  │  └────────────────────────┘│  │                   │
│  └────────────────────────────┘  │                   │
│                                  │                   │
│  ┌─ 10:30 Taller 2 ──────────┐  │                   │
│  │  ┌── Arte ────────────────┐│  │                   │
│  │  │ [Maria R.] [Ana P.]    ││  │                   │
│  │  └────────────────────────┘│  │                   │
│  └────────────────────────────┘  │                   │
│                                  │                   │
│  [+ Agregar horario]             │                   │
└──────────────────────────────────┴───────────────────┘
```

### Shift Tabs

- Morning / Afternoon tabs below the header
- Switching tabs changes the left panel content and the client pool
- Pool shows clients scheduled for that shift on the selected day (same logic as current: plan.assignedDays + plan.schedule). `full_day` clients appear in both morning and afternoon pools and can be assigned to activities in both shifts

### Client Pool (Right Side)

- Fixed-width panel (~240px) on the right
- Shows all clients for the active shift+day
- Search bar to filter by name
- Client chips: avatar initials + name + cognitive tier badge
- **Clone-drag**: dragging a client from the pool creates a copy; the original stays. The clone only persists if dropped on a valid activity (one where the client doesn't already occupy another activity in the same time slot)
- **Removing a client**: X button on each client chip inside an activity (visible on hover). Clicking removes the assignment
- Generous padding on chips for comfortable touch/grab targets

### Time Slots (Left Side)

- Vertically stacked cards
- Each card header: time badge + name + activity count + "+ Actividad" button
- Activities stack vertically inside each slot
- Each activity: name + optional responsible label + client chips (wrapping horizontally)
- "+ Agregar horario" button at the bottom
- Time slot name and time are inline-editable
- Activity name and responsible are inline-editable

### Edit Mode vs View Mode

- Today: always editable (no separate edit mode toggle needed — structure editing like adding/removing slots and activities can use inline buttons)
- Past days: read-only, no drag, no edit buttons, no add buttons

### Invalid Drop Feedback

- When a client is dragged over an activity where they're already assigned to a sibling activity in the same time slot, the drop zone shows a visual rejection (e.g., red border or shake animation)
- Dropping in an invalid zone causes the clone to disappear (snap back / fade out)

## Templates

### Template Modal

Accessed via "Plantillas" button in the header. Two screens with in-modal navigation:

**Screen 1 — Template Grid**
- 2-column × 2-row grid of template cards
- Pagination slider below the grid (client-side, not query-based)
- Each card shows: template name, shift badge, slot/activity count preview
- Two action buttons:
  - "Guardar actual" — saves the current day's structure (for the active shift) as a new template (prompts for name)
  - "Nueva plantilla" — creates a blank template to build from scratch
- Template grid is **filtered by the active shift tab** — only shows templates matching the current shift
- Clicking a template card navigates to Screen 2

**Screen 2 — Template Detail**
- Back arrow + template name as header
- Editable view of the template's time slots and activities (same visual structure as the main page, but no client assignments)
- Inline editing of slot names/times, activity names/responsible
- Add/remove slots and activities
- Three actions:
  - "Aplicar" — applies template to current day+shift. If day already has data, show confirmation: "Esto reemplazará la configuración actual del turno. ¿Continuar?"
  - "Eliminar" — deletes the template with confirmation
  - "Guardar cambios" — saves edits to the template

### Applying a Template

1. Delete all existing time slots (cascade) for the current date+shift
2. Copy template slots → `group_time_slots` with current date+shift
3. Copy template activities → `group_activities` linked to new slot IDs
4. No client assignments copied (templates are skeletons only)

## Service Layer

### File: `src/services/groups/groupService.js`

Complete rewrite. Key functions:

- `getTimeSlotsForDate(dateStr, shift)` — returns slots with nested activities and assignments
- `createTimeSlot(dateStr, shift, { name, time, position })` — create a new time slot
- `updateTimeSlot(slotId, { name, time, position })` — update an existing time slot
- `deleteTimeSlot(slotId)` — cascade deletes activities + assignments
- `createActivity(slotId, { name, responsible, position })` — create a new activity
- `updateActivity(activityId, { name, responsible, position })` — update an existing activity
- `deleteActivity(activityId)` — cascade deletes assignments
- `assignClientToActivity(activityId, clientId)` — with one-per-slot validation
- `removeClientFromActivity(activityId, clientId)`
- `cleanupOldGroups(dateStr)` — delete data older than 14 days from today
- `getTemplates(shift?)` — list all templates, optionally filtered by shift
- `getTemplateDetail(templateId)` — template with nested slots and activities
- `saveTemplate({ name, shift, slots })` — create a new template
- `updateTemplate(templateId, { name, slots })` — update existing template
- `deleteTemplate(templateId)`
- `applyTemplate(templateId, dateStr, shift)` — copy template skeleton to a day
- `saveCurrentAsTemplate(dateStr, shift, name)` — snapshot current day structure as template (copies slots and activities only, strips all client assignments)

### RLS Policies

Same pattern as existing tables: all operations require authenticated user. Both `admin` and `superadmin` roles have full access to group and template tables. Position gaps after deletions are acceptable and do not need renormalization.

## Component Structure

### File: `src/pages/Groups/DailyGroups.jsx`

Main page component (rewrite). Manages:
- Day navigation state
- Shift tab state
- Data loading per day+shift
- Client pool filtering

### Subcomponents (same file or split if large)

- `TimeSlotCard` — renders a time slot with its activities
- `ActivityCard` — renders an activity with client chips, drop zone
- `ClientChip` — draggable client chip (used in pool and inside activities)
- `TemplateModal` — modal with grid/detail screens
- `TemplateCard` — card in the template grid
- `TemplateEditor` — detail screen for editing a template's structure

### DnD Strategy

- Continue using `@dnd-kit/core`
- Client pool items use a custom drag source that creates clones (not moves)
- Activity cards are drop targets
- Validation on drop: check if client already has assignment in same time slot
- No sorting within activities (clients are unordered within an activity) — simplifies DnD significantly vs current implementation
- `@dnd-kit/sortable` is no longer needed — only `@dnd-kit/core` required for clone-drag + drop targets

## Migration from Current System

- The old `daily_groups` and `daily_group_members` tables are dropped
- No data migration needed (current system only stores today's data, which is ephemeral)
- The `cleanupPastGroups` function in the old service is replaced by the new 15-day cleanup
- Route remains `/grupos`
- Nav entry remains the same
