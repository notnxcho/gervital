-- 054_absence_notes.sql
-- mark_day_absent gana p_notes: motivo de texto libre opcional persistido en
-- attendance_records.notes (columna ya existente, expuesta por attendance_view).
-- La columna y la vista NO cambian; solo la función. Se dropea la firma vieja de 4
-- params porque agregar un param con default crea una sobrecarga nueva (no reemplaza)
-- y dejaría dos funciones -> "function is not unique". Firma actual verificada en DB:
-- mark_day_absent(uuid, date, boolean, text).

DROP FUNCTION IF EXISTS public.mark_day_absent(uuid, date, boolean, text);

CREATE OR REPLACE FUNCTION public.mark_day_absent(
  p_client_id uuid,
  p_date date,
  p_is_justified boolean DEFAULT false,
  p_created_by text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_record_id UUID; v_credit_id UUID; v_new_balance INTEGER;
BEGIN
  INSERT INTO attendance_records (client_id, date, status, is_justified, notes)
  VALUES (p_client_id, p_date, 'absent', p_is_justified, NULLIF(TRIM(p_notes), ''))
  ON CONFLICT (client_id, date) DO UPDATE SET
    status='absent',
    is_justified=EXCLUDED.is_justified,
    notes=NULLIF(TRIM(EXCLUDED.notes), ''),
    updated_at=NOW()
  RETURNING id INTO v_record_id;
  IF p_is_justified THEN
    INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, grant_attendance_id, created_by_name)
    VALUES (p_client_id, p_date, p_date + 30, 'justified_absence', v_record_id, p_created_by)
    RETURNING id INTO v_credit_id;
    v_new_balance := _recovery_balance(p_client_id);
    INSERT INTO recovery_credit_ledger (client_id, date, change, reason, attendance_record_id, balance_after, created_by_name, credit_id)
    VALUES (p_client_id, p_date, 1, 'justified_absence', v_record_id, v_new_balance, p_created_by, v_credit_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'recordId', v_record_id);
END;
$function$;
