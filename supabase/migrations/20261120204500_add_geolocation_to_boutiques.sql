-- Add GPS geolocation coordinates (latitude, longitude) to public.boutiques
ALTER TABLE public.boutiques
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

NOTIFY pgrst, 'reload schema';
