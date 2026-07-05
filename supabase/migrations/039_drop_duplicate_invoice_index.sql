-- 039_drop_duplicate_invoice_index.sql
-- monthly_invoices tenía dos índices únicos idénticos sobre (client_id, year, month):
--   - monthly_invoices_client_id_year_month_key  → respalda la constraint UNIQUE (se conserva)
--   - monthly_invoices_client_year_month_uniq     → índice standalone duplicado (se elimina)
-- monthly_invoices es la tabla más escrita (una fila por cliente/mes, actualizada en cada
-- facturación/cobro); mantener dos índices idénticos duplica el costo de escritura sin
-- beneficio de lectura. Detectado por el linter de performance de Supabase.
DROP INDEX IF EXISTS public.monthly_invoices_client_year_month_uniq;
