-- ════════════════════════════════════════════════════════════════════════════
-- 019_drop_legacy_client_rpc_overloads.sql
--
-- Tech-debt cleanup. Over successive migrations, create_client_full and
-- update_client_full accumulated several overloads: every time a migration
-- added parameters (p_addr_distance_range in 012, the medical flags in 018),
-- `CREATE OR REPLACE FUNCTION` saw a NEW signature and created a brand-new
-- function instead of replacing the old one. The stale versions piled up:
--
--   create_client_full:  base · +distance · +flags · +distance+flags (KEEP)
--   update_client_full:  base · +distance · +distance+flags (KEEP)
--
-- Only the fullest signature (with p_addr_distance_range AND the three medical
-- flags) is ever called by the frontend. The leftovers are dead code and, worse,
-- a footgun: a partial named-arg call that omits distance_range/flags matches
-- multiple signatures and fails with "function ... is not unique".
--
-- This migration drops every legacy overload, leaving exactly ONE of each — the
-- canonical version with all parameters defaulted, so any partial call resolves
-- unambiguously.
-- ════════════════════════════════════════════════════════════════════════════

-- ── create_client_full — drop the 3 stale overloads (keep distance + flags) ──

-- base (no distance_range, no flags)
DROP FUNCTION IF EXISTS create_client_full(
  p_first_name text, p_last_name text, p_email text, p_phone text, p_birth_date date,
  p_cognitive_level text, p_start_date date, p_plan_frequency integer, p_plan_schedule text,
  p_plan_has_transport boolean, p_plan_assigned_days text[], p_ec_name text, p_ec_relationship text,
  p_ec_phone text, p_addr_street text, p_addr_access_notes text, p_addr_doorbell text,
  p_addr_concierge text, p_med_dietary text, p_med_medical text, p_med_mobility text,
  p_med_medication text, p_med_medication_schedule text, p_med_notes text);

-- +distance_range, no flags
DROP FUNCTION IF EXISTS create_client_full(
  p_first_name text, p_last_name text, p_email text, p_phone text, p_birth_date date,
  p_cognitive_level text, p_start_date date, p_plan_frequency integer, p_plan_schedule text,
  p_plan_has_transport boolean, p_plan_assigned_days text[], p_ec_name text, p_ec_relationship text,
  p_ec_phone text, p_addr_street text, p_addr_access_notes text, p_addr_doorbell text,
  p_addr_concierge text, p_addr_distance_range text, p_med_dietary text, p_med_medical text,
  p_med_mobility text, p_med_medication text, p_med_medication_schedule text, p_med_notes text);

-- +flags, no distance_range
DROP FUNCTION IF EXISTS create_client_full(
  p_first_name text, p_last_name text, p_email text, p_phone text, p_birth_date date,
  p_cognitive_level text, p_start_date date, p_plan_frequency integer, p_plan_schedule text,
  p_plan_has_transport boolean, p_plan_assigned_days text[], p_ec_name text, p_ec_relationship text,
  p_ec_phone text, p_addr_street text, p_addr_access_notes text, p_addr_doorbell text,
  p_addr_concierge text, p_med_dietary text, p_med_medical text, p_med_mobility text,
  p_med_medication text, p_med_medication_schedule text, p_med_notes text,
  p_med_is_diabetic boolean, p_med_is_celiac boolean, p_med_is_hypertensive boolean);

-- ── update_client_full — drop the 2 stale overloads (keep distance + flags) ──

-- base (no distance_range, no flags)
DROP FUNCTION IF EXISTS update_client_full(
  p_client_id uuid, p_first_name text, p_last_name text, p_email text, p_phone text,
  p_birth_date date, p_cognitive_level text, p_start_date date, p_plan_frequency integer,
  p_plan_schedule text, p_plan_has_transport boolean, p_plan_assigned_days text[], p_ec_name text,
  p_ec_relationship text, p_ec_phone text, p_addr_street text, p_addr_access_notes text,
  p_addr_doorbell text, p_addr_concierge text, p_med_dietary text, p_med_medical text,
  p_med_mobility text, p_med_medication text, p_med_medication_schedule text, p_med_notes text);

-- +distance_range, no flags
DROP FUNCTION IF EXISTS update_client_full(
  p_client_id uuid, p_first_name text, p_last_name text, p_email text, p_phone text,
  p_birth_date date, p_cognitive_level text, p_start_date date, p_plan_frequency integer,
  p_plan_schedule text, p_plan_has_transport boolean, p_plan_assigned_days text[], p_ec_name text,
  p_ec_relationship text, p_ec_phone text, p_addr_street text, p_addr_access_notes text,
  p_addr_doorbell text, p_addr_concierge text, p_addr_distance_range text, p_med_dietary text,
  p_med_medical text, p_med_mobility text, p_med_medication text, p_med_medication_schedule text,
  p_med_notes text);
