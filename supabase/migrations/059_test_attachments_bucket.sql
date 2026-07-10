-- ════════════════════════════════════════════════════════════════════════════
-- 059_test_attachments_bucket.sql
-- Bucket de Storage para adjuntos de tests clínicos (imagen del Test del reloj).
-- Espeja las políticas de 'client-avatars': lectura pública, escritura autenticada.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('test-attachments', 'test-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "test_attach_read"   ON storage.objects;
DROP POLICY IF EXISTS "test_attach_write"  ON storage.objects;
DROP POLICY IF EXISTS "test_attach_update" ON storage.objects;
DROP POLICY IF EXISTS "test_attach_delete" ON storage.objects;

CREATE POLICY "test_attach_read"   ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'test-attachments');
CREATE POLICY "test_attach_write"  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'test-attachments');
CREATE POLICY "test_attach_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'test-attachments');
CREATE POLICY "test_attach_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'test-attachments');
