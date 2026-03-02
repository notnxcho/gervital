-- ============================================
-- Seed Plan Pricing Matrix
-- ============================================

INSERT INTO plan_pricing (frequency, schedule, price) VALUES
  -- 1 day per week
  (1, 'morning', 50000),
  (1, 'afternoon', 50000),
  (1, 'full_day', 80000),
  -- 2 days per week
  (2, 'morning', 90000),
  (2, 'afternoon', 90000),
  (2, 'full_day', 150000),
  -- 3 days per week
  (3, 'morning', 120000),
  (3, 'afternoon', 120000),
  (3, 'full_day', 200000),
  -- 4 days per week
  (4, 'morning', 150000),
  (4, 'afternoon', 150000),
  (4, 'full_day', 250000)
ON CONFLICT (frequency, schedule) DO UPDATE
SET price = EXCLUDED.price;

-- ============================================
-- Seed Supplier Categories (for reference)
-- The frontend currently uses a const array, but these can be stored in DB if needed
-- ============================================
-- Categories:
-- - Alimentación
-- - Limpieza
-- - Transporte
-- - Salud
-- - Insumos
-- - Mantenimiento
-- - Servicios profesionales
-- - Otros
