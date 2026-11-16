/*
# Add mode_reglement to depot_avances

1. Modified Tables
- `depot_avances`
  - Add `mode_reglement` (text, nullable) — stores the payment mode code (e.g. 'ESPECES', 'VIREMENT') used for this individual payment.
  - Nullable so existing rows are not affected; new payments will always set it.

2. Notes
- A depot can have one or several payments (depot_avances rows). Each payment
  is now associated with a mode of règlement, allowing the journal and receipt
  to show exactly how each installment was paid.
- The modes_reglement table already exists and stores the available modes.
- No foreign key constraint is added to keep the schema flexible (the mode
  codes are managed in the modes_reglement table but stored as text here for
  offline resilience).
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'depot_avances' AND column_name = 'mode_reglement'
  ) THEN
    ALTER TABLE depot_avances ADD COLUMN mode_reglement text;
  END IF;
END $$;
