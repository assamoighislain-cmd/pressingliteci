/*
# Add GPS coordinates to entreprise table

1. Changes
- Add `latitude` (double precision, nullable) column to `entreprise`
- Add `longitude` (double precision, nullable) column to `entreprise`

2. Notes
- These columns store the GPS position captured during self-signup.
- The super admin can view the location on a map in the admin panel.
- No RLS or policy changes needed — existing policies cover the new columns.
*/

ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS longitude double precision;
