-- ============================================
-- 014: Groups Redesign
-- Replaces daily_groups/daily_group_members with
-- time slots → activities → assignments hierarchy
-- plus template tables
-- ============================================

-- Step 1 — Drop old tables
DROP TABLE IF EXISTS daily_group_members CASCADE;
DROP TABLE IF EXISTS daily_groups CASCADE;

-- Step 2 — Day tables
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

-- Step 3 — Template tables
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

-- Step 4 — Indexes
CREATE INDEX idx_group_time_slots_date_shift ON group_time_slots(date, shift);
CREATE INDEX idx_group_activities_slot ON group_activities(time_slot_id);
CREATE INDEX idx_group_assignments_activity ON group_activity_assignments(activity_id);
CREATE INDEX idx_group_assignments_client ON group_activity_assignments(client_id);
CREATE INDEX idx_group_template_slots_template ON group_template_slots(template_id);
CREATE INDEX idx_group_template_activities_slot ON group_template_activities(template_slot_id);

-- Step 5 — One-activity-per-slot constraint trigger
CREATE OR REPLACE FUNCTION check_one_activity_per_slot()
RETURNS TRIGGER AS $$
DECLARE
  v_time_slot_id UUID;
BEGIN
  SELECT time_slot_id INTO v_time_slot_id
  FROM group_activities
  WHERE id = NEW.activity_id;

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

-- Step 6 — updated_at trigger for templates
CREATE TRIGGER update_group_templates_updated_at
  BEFORE UPDATE ON group_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 7 — RLS policies
ALTER TABLE group_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_activity_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_template_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_template_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_time_slots_select" ON group_time_slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_time_slots_insert" ON group_time_slots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_time_slots_update" ON group_time_slots FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_time_slots_delete" ON group_time_slots FOR DELETE TO authenticated USING (true);

CREATE POLICY "group_activities_select" ON group_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_activities_insert" ON group_activities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_activities_update" ON group_activities FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_activities_delete" ON group_activities FOR DELETE TO authenticated USING (true);

CREATE POLICY "group_assignments_select" ON group_activity_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_assignments_insert" ON group_activity_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_assignments_update" ON group_activity_assignments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_assignments_delete" ON group_activity_assignments FOR DELETE TO authenticated USING (true);

CREATE POLICY "group_templates_select" ON group_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_templates_insert" ON group_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_templates_update" ON group_templates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_templates_delete" ON group_templates FOR DELETE TO authenticated USING (true);

CREATE POLICY "group_template_slots_select" ON group_template_slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_template_slots_insert" ON group_template_slots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_template_slots_update" ON group_template_slots FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_template_slots_delete" ON group_template_slots FOR DELETE TO authenticated USING (true);

CREATE POLICY "group_template_activities_select" ON group_template_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_template_activities_insert" ON group_template_activities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "group_template_activities_update" ON group_template_activities FOR UPDATE TO authenticated USING (true);
CREATE POLICY "group_template_activities_delete" ON group_template_activities FOR DELETE TO authenticated USING (true);
