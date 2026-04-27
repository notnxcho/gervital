-- ============================================
-- 013: Create client-avatars storage bucket
-- The bucket was missing — 011 only added the column + view
-- ============================================

-- Create the storage bucket (public so avatar URLs work without auth)
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-avatars', 'client-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload avatars
CREATE POLICY "Allow authenticated uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'client-avatars');

-- Allow authenticated users to update (overwrite) avatars
CREATE POLICY "Allow authenticated updates"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'client-avatars');

-- Allow authenticated users to delete avatars
CREATE POLICY "Allow authenticated deletes"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'client-avatars');

-- Allow public reads (so avatar URLs work without auth tokens)
CREATE POLICY "Allow public reads"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'client-avatars');
