-- 037_fixed_expenses_updated_at_trigger.sql
-- Follow the per-table convention (see 006_triggers.sql): keep updated_at fresh
-- on UPDATE for the fixed_expenses table added in 036.

CREATE TRIGGER update_fixed_expenses_updated_at
  BEFORE UPDATE ON fixed_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
