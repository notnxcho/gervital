-- 057_fix_transport_iva_in_set_pricing.sql
-- FIX: set_pricing derivaba el neto como gross/1.22 para TODO. El transporte lleva IVA
-- mínimo (10%), no 22%. Los planes van a ÷1.22, el transporte a ÷1.10.
-- (Los precios sembrados nunca fueron corrompidos: set_pricing no se ejecutó sobre datos
-- reales antes de este fix. calculate_month_billing lee net/gross almacenados, no deriva.)

CREATE OR REPLACE FUNCTION set_pricing(
  p_effective_year INTEGER,
  p_effective_month INTEGER,
  p_plan_prices JSONB,
  p_transport_prices JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_item JSONB;
  v_gross NUMERIC;
  v_net NUMERIC;
  v_current_ym INTEGER;
  v_target_ym INTEGER;
BEGIN
  IF NOT is_superadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autorizado');
  END IF;

  v_current_ym := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER * 12
                  + (EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER - 1);
  v_target_ym := p_effective_year * 12 + p_effective_month;
  IF v_target_ym < v_current_ym THEN
    RETURN jsonb_build_object('success', false,
      'error', 'El mes de vigencia no puede ser anterior al mes actual');
  END IF;

  -- Planes: IVA 22%
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_plan_prices) LOOP
    v_gross := (v_item->>'price_gross')::NUMERIC;
    v_net := ROUND(v_gross / 1.22, 2);
    INSERT INTO plan_pricing (frequency, schedule, price_net, price_gross, effective_year, effective_month)
    VALUES ((v_item->>'frequency')::INTEGER, v_item->>'schedule', v_net, v_gross,
            p_effective_year, p_effective_month)
    ON CONFLICT (frequency, schedule, effective_year, effective_month)
    DO UPDATE SET price_net = EXCLUDED.price_net,
                  price_gross = EXCLUDED.price_gross,
                  updated_at = NOW();
  END LOOP;

  -- Transporte: IVA 10% (mínimo)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_transport_prices) LOOP
    v_gross := (v_item->>'price_gross')::NUMERIC;
    v_net := ROUND(v_gross / 1.10, 2);
    INSERT INTO transport_pricing (frequency, distance_range, price_net, price_gross, effective_year, effective_month)
    VALUES ((v_item->>'frequency')::INTEGER, v_item->>'distance_range', v_net, v_gross,
            p_effective_year, p_effective_month)
    ON CONFLICT (frequency, distance_range, effective_year, effective_month)
    DO UPDATE SET price_net = EXCLUDED.price_net,
                  price_gross = EXCLUDED.price_gross,
                  updated_at = NOW();
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
