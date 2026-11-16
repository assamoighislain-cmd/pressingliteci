/*
# Create logos storage bucket

1. Purpose
- Provides a public storage bucket `logos` for entreprise logo images.
- Each entreprise uploads its logo to a path scoped by its tenant id, e.g. `logos/<tenant_id>/logo.png`.
- Logos must be publicly readable (shown in receipts, headers, client portal, QR flyer).

2. Storage changes
- New bucket `logos` (public = true).
- Storage policies:
  - SELECT (read): public — anyone (anon + authenticated) can read.
  - INSERT/UPDATE/DELETE: authenticated users may write only to a path whose folder matches their tenant id.

3. Notes
- The bucket is public so logo URLs resolve without signed URLs (needed for receipts, print, and portal meta tags).
- Path-based ownership scoping keeps one tenant from overwriting another tenant's logo.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "logos_public_read" ON storage.objects;
CREATE POLICY "logos_public_read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'logos');

DROP POLICY IF EXISTS "logos_tenant_insert" ON storage.objects;
CREATE POLICY "logos_tenant_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'logos'
  AND (storage.foldername(name))[1] = (
    SELECT em.tenant_id::text FROM entreprise_members em
    WHERE em.user_id = auth.uid()
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "logos_tenant_update" ON storage.objects;
CREATE POLICY "logos_tenant_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'logos'
  AND (storage.foldername(name))[1] = (
    SELECT em.tenant_id::text FROM entreprise_members em
    WHERE em.user_id = auth.uid()
    LIMIT 1
  )
)
WITH CHECK (
  bucket_id = 'logos'
  AND (storage.foldername(name))[1] = (
    SELECT em.tenant_id::text FROM entreprise_members em
    WHERE em.user_id = auth.uid()
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "logos_tenant_delete" ON storage.objects;
CREATE POLICY "logos_tenant_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'logos'
  AND (storage.foldername(name))[1] = (
    SELECT em.tenant_id::text FROM entreprise_members em
    WHERE em.user_id = auth.uid()
    LIMIT 1
  )
);
