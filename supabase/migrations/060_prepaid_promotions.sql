-- ════════════════════════════════════════════════════════════════════════════
-- 060_prepaid_promotions.sql
-- Promo prepaga como entidad con run propio.
--   1. tabla promotions (identidad del run + datos del pago adelantado)
--   2. monthly_invoices.promo_id: etiqueta cada mes con su promo (evita fusion de
--      promos concatenadas al derivar X/Y)
--   3. RLS: SELECT de promotions solo superadmin; sin INSERT/UPDATE/DELETE por RLS
--      (solo el RPC SECURITY DEFINER create_prepaid_promo escribe).
-- month es 0-indexed.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  discount_percent numeric(5,2) NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  start_year       integer NOT NULL,
  start_month      integer NOT NULL CHECK (start_month >= 0 AND start_month <= 11),
  end_year         integer NOT NULL,
  end_month        integer NOT NULL CHECK (end_month >= 0 AND end_month <= 11),
  paid_date        date NOT NULL,
  paid_amount      numeric(12,2) NOT NULL DEFAULT 0,
  payment_method   text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid
);

ALTER TABLE public.monthly_invoices
  ADD COLUMN IF NOT EXISTS promo_id uuid REFERENCES public.promotions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promotions_client ON public.promotions(client_id);
CREATE INDEX IF NOT EXISTS idx_monthly_invoices_promo ON public.monthly_invoices(promo_id);

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promotions_select_superadmin" ON public.promotions;
CREATE POLICY "promotions_select_superadmin"
  ON public.promotions FOR SELECT
  USING (is_superadmin());
