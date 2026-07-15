-- 066_vacation_reason_notes.sql
-- "Marcar vacaciones" pasa a "Marcar falta justificada" con motivo elegible en el frontend
-- (Vacaciones, Enfermo/a, Invierno, Cita médica, o texto libre). El mecanismo no cambia:
-- el día futuro sigue guardándose como status 'vacation' (no cobrado, acredita recupero si
-- el mes ya fue cobrado). Solo se agrega el motivo, que se guarda en attendance_records.notes
-- igual que ya hacen las faltas (mark_day_absent).
--
-- Agregar un parámetro crea una NUEVA sobrecarga (no reemplaza), así que primero se dropean
-- las firmas viejas de 3/4 args.

DROP FUNCTION IF EXISTS public.mark_day_vacation(uuid, date, text);
DROP FUNCTION IF EXISTS public.mark_vacation_range(uuid, date, date, text);

CREATE OR REPLACE FUNCTION public.mark_day_vacation(
  p_client_id uuid,
  p_date date,
  p_created_by text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_record_id UUID; v_month_paid BOOLEAN; v_credit_id UUID; v_new_balance INTEGER; v_year INTEGER; v_month INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_month := EXTRACT(MONTH FROM p_date)::INTEGER - 1;
  SELECT (payment_status='paid') INTO v_month_paid FROM monthly_invoices
  WHERE client_id=p_client_id AND year=v_year AND month=v_month;
  INSERT INTO attendance_records (client_id, date, status, notes)
  VALUES (p_client_id, p_date, 'vacation', NULLIF(trim(coalesce(p_notes, '')), ''))
  ON CONFLICT (client_id, date) DO UPDATE SET status='vacation', is_justified=NULL, notes=NULLIF(trim(coalesce(p_notes, '')), ''), updated_at=NOW()
  RETURNING id INTO v_record_id;
  IF v_month_paid THEN
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, grant_attendance_id, created_by_name)
    VALUES (p_client_id, p_date, p_date + 30, 'vacation_post_payment', v_record_id, p_created_by)
    RETURNING id INTO v_credit_id;
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
    VALUES (p_client_id, p_date, 1, 'vacation_post_payment', v_record_id, v_new_balance, p_created_by, v_credit_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'creditEarned', COALESCE(v_month_paid, false));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_vacation_range(
  p_client_id uuid,
  p_from_date date,
  p_to_date date,
  p_created_by text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_day DATE; v_day_of_week INTEGER; v_day_name TEXT;
  v_assigned_days TEXT[]; v_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM client_plans WHERE client_id = p_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan no encontrado');
  END IF;
  v_day := p_from_date;
  WHILE v_day <= p_to_date LOOP
    SELECT assigned_days INTO v_assigned_days
    FROM client_plans
    WHERE client_id = p_client_id AND effective_from <= date_trunc('month', v_day)::date
    ORDER BY effective_from DESC LIMIT 1;

    v_day_of_week := EXTRACT(DOW FROM v_day)::INTEGER;
    v_day_name := CASE v_day_of_week
      WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
      WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' ELSE NULL END;
    IF v_day_name IS NOT NULL AND v_assigned_days IS NOT NULL AND v_day_name = ANY(v_assigned_days) THEN
      PERFORM mark_day_vacation(p_client_id, v_day, p_created_by, p_notes);
      v_count := v_count + 1;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;
  RETURN jsonb_build_object('success', true, 'daysMarked', v_count);
END;
$function$;
