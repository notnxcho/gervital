-- 067_today_is_present_attendance.sql
-- Alinea el backend con el modelo del frontend: HOY = presente = 'attended'
-- (no futuro/'scheduled'). Antes había una inconsistencia de frontera:
--   - unmark_day_vacation revertía con `p_date >= CURRENT_DATE` => hoy volvía a 'scheduled'
--   - advance_scheduled_attendance avanzaba solo `date < CURRENT_DATE` => un 'scheduled'
--     de hoy nunca pasaba a 'attended' hasta el día siguiente
-- Resultado: un día asignado con registro 'scheduled' de hoy quedaba congelado como
-- "Programado" y no dejaba marcar la falta. El frontend deriva hoy como 'attended'
-- (day > today), así que 'scheduled' solo debe existir para días estrictamente futuros.

-- 1) Al deshacer una vacación/falta justificada, hoy revierte a 'attended' (no 'scheduled').
--    Solo un día estrictamente futuro (> hoy) vuelve a 'scheduled'.
CREATE OR REPLACE FUNCTION public.unmark_day_vacation(p_client_id uuid, p_date date, p_created_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_record_id UUID; v_month_paid BOOLEAN; v_new_balance INTEGER; v_year INTEGER; v_month INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_month := EXTRACT(MONTH FROM p_date)::INTEGER - 1;
  SELECT id INTO v_record_id FROM attendance_records
  WHERE client_id=p_client_id AND date=p_date AND status='vacation';
  IF v_record_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'No existe vacación para este día'); END IF;
  SELECT (payment_status='paid') INTO v_month_paid FROM monthly_invoices
  WHERE client_id=p_client_id AND year=v_year AND month=v_month;
  UPDATE attendance_records SET
    status = CASE WHEN p_date > CURRENT_DATE THEN 'scheduled' ELSE 'attended' END, updated_at=NOW()
  WHERE id=v_record_id;
  IF v_month_paid THEN
    DELETE FROM recovery_credits WHERE grant_attendance_id=v_record_id AND status='available';
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name)
    VALUES (p_client_id, p_date, -1, 'reverted_vacation_post_payment', v_record_id, v_new_balance, p_created_by);
  END IF;
  RETURN jsonb_build_object('success', true, 'creditRevoked', COALESCE(v_month_paid, false));
END;
$function$;

-- 2) El avance de 'scheduled' -> 'attended' ahora incluye HOY (<=), no solo días pasados.
--    Así un 'scheduled' que se creó para un día futuro que ya llegó se materializa como asistencia.
CREATE OR REPLACE FUNCTION public.advance_scheduled_attendance()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE attendance_records SET status = 'attended', updated_at = NOW()
  WHERE status = 'scheduled' AND date <= CURRENT_DATE;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

-- 3) Saneo puntual de registros 'scheduled' de hoy o del pasado ya existentes en la base.
UPDATE attendance_records
SET status = 'attended', updated_at = NOW()
WHERE status = 'scheduled' AND date <= CURRENT_DATE;
