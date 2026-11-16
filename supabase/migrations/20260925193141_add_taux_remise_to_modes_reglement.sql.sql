/*
# Add taux_remise to modes_reglement

1. Changes
- Add column `taux_remise` (numeric, default 0) to `modes_reglement`.
  This allows each payment method to have an optional discount rate (percentage).
  When a client selects a payment method during a deposit, the discount rate
  is applied to the invoice total automatically.

2. Notes
- taux_remise is a percentage (0–100). Default 0 means no discount.
- Existing rows get 0 (no discount), preserving current behavior.
*/

ALTER TABLE modes_reglement
  ADD COLUMN IF NOT EXISTS taux_remise numeric NOT NULL DEFAULT 0;
