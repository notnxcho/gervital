-- 069_register_absence_no_double_credit.sql
-- Fix (final review #3): register_absence borraba solo créditos 'available' antes de
-- re-otorgar. Si el crédito de una falta ya había sido CONSUMIDO (se usó un día de
-- recupero) y luego se re-marca ese mismo día (p.ej. vía register_absence_range con un
-- rango justificado que lo solapa), se insertaba un SEGUNDO crédito -> una falta generaba
-- 2 entitlements. Se agrega una guarda: si ya existe un crédito consumido para esa falta,
-- no se toca nada de créditos ni se otorga uno nuevo (la falta ya produjo su único recupero).

CREATE OR REPLACE FUNCTION public.register_absence(
  p_client_id uuid,
  p_date date,
  p_is_justified boolean DEFAULT false,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
  v_year INTEGER; v_month INTEGER; v_month_paid BOOLEAN;
  v_is_future BOOLEAN; v_is_chargeable BOOLEAN; v_grants_credit BOOLEAN;
  v_clean_notes TEXT; v_has_consumed BOOLEAN;
BEGIN
  v_clean_notes := NULLIF(TRIM(COALESCE(p_notes, '')), '');
  v_year := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_month := EXTRACT(MONTH FROM p_date)::INTEGER - 1;
  SELECT (payment_status = 'paid') INTO v_month_paid FROM monthly_invoices
  WHERE client_id = p_client_id AND year = v_year AND month = v_month;
  v_month_paid := COALESCE(v_month_paid, false);

  v_is_future := p_date > CURRENT_DATE;
  v_is_chargeable := NOT (p_is_justified AND v_is_future AND NOT v_month_paid);
  v_grants_credit := p_is_justified AND v_is_chargeable;

  INSERT INTO attendance_records (client_id, date, status, is_justified, is_chargeable, notes)
  VALUES (p_client_id, p_date, 'absent', p_is_justified, v_is_chargeable, v_clean_notes)
  ON CONFLICT (client_id, date) DO UPDATE SET
    status = 'absent',
    is_justified = EXCLUDED.is_justified,
    is_chargeable = EXCLUDED.is_chargeable,
    notes = EXCLUDED.notes,
    updated_at = NOW()
  RETURNING id INTO v_record_id;

  -- ¿La falta ya tiene un crédito consumido? Entonces su único recupero ya se usó:
  -- no se otorga otro y no se toca nada de créditos.
  SELECT EXISTS (
    SELECT 1 FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'consumed'
  ) INTO v_has_consumed;

  IF NOT v_has_consumed THEN
    -- Re-marca idempotente: revoca cualquier crédito vivo previo de este registro
    DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status = 'available';
    IF v_grants_credit THEN
      INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, note, grant_attendance_id, created_by_name)
      VALUES (p_client_id, p_date, p_date + 30, 'justified_absence', v_clean_notes, v_record_id, p_created_by)
      RETURNING id INTO v_credit_id;
      v_new_balance := _recovery_balance(p_client_id);
      INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
      VALUES (p_client_id, p_date, 1, 'justified_absence', v_record_id, v_new_balance, p_created_by, v_credit_id);
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'isChargeable', v_is_chargeable, 'creditEarned', v_grants_credit AND NOT v_has_consumed);
END;
$function$;
