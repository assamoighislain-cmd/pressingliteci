/*
# Add ready_for_delivery column to depots table

1. New Columns
- `depots.ready_for_delivery` (boolean, default false) — indicates that a deposit
  has been processed and is ready to be delivered to the client.
  Only deposits with this flag set to true can be marked as delivered (RETIRE)
  from the LivraisonView.

2. Security
- No new policies needed. The column is updated by authenticated users via the
  standard depots RLS policies.
*/

ALTER TABLE depots ADD COLUMN IF NOT EXISTS ready_for_delivery boolean DEFAULT false;
