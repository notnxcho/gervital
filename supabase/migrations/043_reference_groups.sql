-- 043_reference_groups.sql
-- Reference groups: one saved layout + person assignments per (weekday, shift),
-- applied by copy to a concrete date with frontend-provided attendance reconciliation.

CREATE TABLE reference_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weekday TEXT NOT NULL CHECK (weekday IN ('monday','tuesday','wednesday','thursday','friday')),
  shift   TEXT NOT NULL CHECK (shift IN ('morning','afternoon')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (weekday, shift)
);
CREATE TABLE reference_group_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_group_id UUID NOT NULL REFERENCES reference_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  time TIME NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reference_group_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_slot_id UUID NOT NULL REFERENCES reference_group_slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  responsible TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reference_group_activity_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_activity_id UUID NOT NULL REFERENCES reference_group_activities(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  UNIQUE (reference_activity_id, client_id)
);

CREATE INDEX idx_reference_group_slots_group ON reference_group_slots(reference_group_id);
CREATE INDEX idx_reference_group_activities_slot ON reference_group_activities(reference_slot_id);
CREATE INDEX idx_reference_group_activity_clients_activity ON reference_group_activity_clients(reference_activity_id);

CREATE TRIGGER update_reference_groups_updated_at
  BEFORE UPDATE ON reference_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reference_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_group_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_group_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_group_activity_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reference_groups all" ON reference_groups FOR ALL USING (is_authenticated()) WITH CHECK (is_authenticated());
CREATE POLICY "reference_group_slots all" ON reference_group_slots FOR ALL USING (is_authenticated()) WITH CHECK (is_authenticated());
CREATE POLICY "reference_group_activities all" ON reference_group_activities FOR ALL USING (is_authenticated()) WITH CHECK (is_authenticated());
CREATE POLICY "reference_group_activity_clients all" ON reference_group_activity_clients FOR ALL USING (is_authenticated()) WITH CHECK (is_authenticated());

-- Snapshot the current day (date, shift) into the reference group for (weekday, shift).
CREATE OR REPLACE FUNCTION save_reference_group(p_date date, p_shift text, p_weekday text)
RETURNS uuid AS $$
DECLARE
  v_ref_id uuid;
  v_slot RECORD;
  v_new_slot_id uuid;
  v_act RECORD;
  v_new_act_id uuid;
BEGIN
  DELETE FROM reference_groups WHERE weekday = p_weekday AND shift = p_shift;
  INSERT INTO reference_groups (weekday, shift) VALUES (p_weekday, p_shift) RETURNING id INTO v_ref_id;

  FOR v_slot IN
    SELECT * FROM group_time_slots WHERE date = p_date AND shift = p_shift ORDER BY position
  LOOP
    INSERT INTO reference_group_slots (reference_group_id, name, time, position)
    VALUES (v_ref_id, v_slot.name, v_slot.time, v_slot.position)
    RETURNING id INTO v_new_slot_id;

    FOR v_act IN
      SELECT * FROM group_activities WHERE time_slot_id = v_slot.id ORDER BY position
    LOOP
      INSERT INTO reference_group_activities (reference_slot_id, name, responsible, position)
      VALUES (v_new_slot_id, v_act.name, v_act.responsible, v_act.position)
      RETURNING id INTO v_new_act_id;

      INSERT INTO reference_group_activity_clients (reference_activity_id, client_id)
      SELECT v_new_act_id, a.client_id
      FROM group_activity_assignments a
      WHERE a.activity_id = v_act.id;
    END LOOP;
  END LOOP;

  RETURN v_ref_id;
END;
$$ LANGUAGE plpgsql;

-- Apply the reference group for (weekday, shift) onto (date, shift), overwriting.
-- Only assigns clients whose id is in p_present_ids (frontend reconciliation).
CREATE OR REPLACE FUNCTION apply_reference_group(p_weekday text, p_shift text, p_date date, p_present_ids uuid[])
RETURNS void AS $$
DECLARE
  v_ref_id uuid;
  v_slot RECORD;
  v_new_slot_id uuid;
  v_act RECORD;
  v_new_act_id uuid;
BEGIN
  SELECT id INTO v_ref_id FROM reference_groups WHERE weekday = p_weekday AND shift = p_shift;
  IF v_ref_id IS NULL THEN RETURN; END IF;

  DELETE FROM group_time_slots WHERE date = p_date AND shift = p_shift;

  FOR v_slot IN
    SELECT * FROM reference_group_slots WHERE reference_group_id = v_ref_id ORDER BY position
  LOOP
    INSERT INTO group_time_slots (date, shift, name, time, position)
    VALUES (p_date, p_shift, v_slot.name, v_slot.time, v_slot.position)
    RETURNING id INTO v_new_slot_id;

    FOR v_act IN
      SELECT * FROM reference_group_activities WHERE reference_slot_id = v_slot.id ORDER BY position
    LOOP
      INSERT INTO group_activities (time_slot_id, name, responsible, position)
      VALUES (v_new_slot_id, v_act.name, v_act.responsible, v_act.position)
      RETURNING id INTO v_new_act_id;

      INSERT INTO group_activity_assignments (activity_id, client_id)
      SELECT v_new_act_id, rac.client_id
      FROM reference_group_activity_clients rac
      WHERE rac.reference_activity_id = v_act.id
        AND rac.client_id = ANY(p_present_ids);
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
