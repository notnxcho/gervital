-- ════════════════════════════════════════════════════════════════════════════
-- 061_create_prepaid_promo.sql
-- Crea una promo prepaga de forma atomica (solo superadmin):
--   1. valida rango (consecutivo, >=2 meses, todos pending pago+factura) y % 1-100
--   2. inserta fila en promotions
--   3. setea discount_percent + promo_id en cada mes del rango
--   4. marca cada mes pagado (mark_month_paid) con el mismo paid_date -> snapshot
--      paid_amount = plan*(1-dto)+transporte de ese mes
--   5. acumula paid_amount total en la promo
-- month es 0-indexed.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_prepaid_promo(
  p_client_id UUID,
  p_start_year INTEGER,
  p_start_month INTEGER,
  p_end_year INTEGER,
  p_end_month INTEGER,
  p_percent NUMERIC,
  p_paid_date DATE,
  p_payment_method TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_start_ord INTEGER;
  v_end_ord INTEGER;
  v_range_count INTEGER;
  v_eligible_count INTEGER;
  v_promo_id UUID;
  v_total NUMERIC(12,2);
  m RECORD;
BEGIN
  IF NOT is_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autorizado');
  END IF;

  IF p_percent <= 0 OR p_percent > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El porcentaje debe estar entre 1 y 100');
  END IF;
  IF p_paid_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Falta la fecha de pago');
  END IF;

  v_start_ord := p_start_year * 12 + p_start_month;
  v_end_ord := p_end_year * 12 + p_end_month;

  IF v_end_ord < v_start_ord THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rango inválido');
  END IF;
  IF v_end_ord = v_start_ord THEN
    RETURN jsonb_build_object('success', false, 'error', 'El rango debe tener al menos 2 meses');
  END IF;

  v_range_count := v_end_ord - v_start_ord + 1;

  SELECT COUNT(*) INTO v_eligible_count
  FROM monthly_invoices
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord
    AND payment_status = 'pending'
    AND invoice_status = 'pending';

  IF v_eligible_count <> v_range_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'El rango debe ser consecutivo y todos los meses deben estar sin cobrar ni facturar');
  END IF;

  INSERT INTO promotions (
    client_id, discount_percent, start_year, start_month, end_year, end_month,
    paid_date, payment_method, notes, created_by
  ) VALUES (
    p_client_id, p_percent, p_start_year, p_start_month, p_end_year, p_end_month,
    p_paid_date, p_payment_method, p_notes, auth.uid()
  ) RETURNING id INTO v_promo_id;

  -- Descuento + etiqueta de promo en cada mes (antes de cobrar, para que el snapshot
  -- de mark_month_paid ya refleje el descuento).
  UPDATE monthly_invoices
  SET discount_percent = p_percent,
      promo_id = v_promo_id,
      updated_at = now()
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord;

  -- Cobrar cada mes con el mismo paid_date (cash colapsa al mes de pago via mig 052).
  FOR m IN
    SELECT year, month FROM monthly_invoices
    WHERE client_id = p_client_id
      AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord
    ORDER BY year, month
  LOOP
    PERFORM mark_month_paid(p_client_id, m.year, m.month, NULL, p_payment_method, p_notes, p_paid_date);
  END LOOP;

  SELECT COALESCE(SUM(paid_amount), 0) INTO v_total
  FROM monthly_invoices
  WHERE client_id = p_client_id
    AND (year * 12 + month) BETWEEN v_start_ord AND v_end_ord;

  UPDATE promotions SET paid_amount = v_total WHERE id = v_promo_id;

  RETURN jsonb_build_object('success', true, 'promoId', v_promo_id, 'monthsUpdated', v_range_count, 'paidAmount', v_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_prepaid_promo(UUID, INT, INT, INT, INT, NUMERIC, DATE, TEXT, TEXT) TO authenticated;
