/*
# Add delivery support and COLLECTE statut

1. New Columns
- `depots.delivery_requested` (boolean, nullable, default false) — client requests home delivery of the finished order
- `depots.delivery_address` (text, nullable) — delivery address when delivery is requested
- `depots.delivery_latitude` (double precision, nullable) — delivery geo lat
- `depots.delivery_longitude` (double precision, nullable) — delivery geo lng
- `depots.delivery_day` (text, nullable) — preferred delivery day
- `depots.collected_at` (timestamptz, nullable) — timestamp when collector marked the order as collected

2. Modified Tables
- `depots` — add the columns above (all nullable, no data loss)

3. Security
- No new tables. Existing RLS policies on `depots` cover the new columns automatically.

4. Notes
- The `statut` column has no CHECK constraint (confirmed in original schema), so 'COLLECTE' is accepted without ALTER.
- `delivery_requested` parallels the existing `pickup_requested` pattern.
*/

ALTER TABLE depots ADD COLUMN IF NOT EXISTS delivery_requested boolean DEFAULT false;
ALTER TABLE depots ADD COLUMN IF NOT EXISTS delivery_address text;
ALTER TABLE depots ADD COLUMN IF NOT EXISTS delivery_latitude double precision;
ALTER TABLE depots ADD COLUMN IF NOT EXISTS delivery_longitude double precision;
ALTER TABLE depots ADD COLUMN IF NOT EXISTS delivery_day text;
ALTER TABLE depots ADD COLUMN IF NOT EXISTS collected_at timestamptz;
