/*
# Add 'demo' to licences statut check constraint

1. Changes
- Drop existing check constraint on licences.statut that only allows 'active', 'expired', 'revoked'.
- Add new check constraint that also allows 'demo'.
2. Notes
- The 'demo' statut lets the super-admin mark a licence as demo directly via the statut dropdown.
*/

ALTER TABLE licences DROP CONSTRAINT IF EXISTS licences_statut_check;

ALTER TABLE licences ADD CONSTRAINT licences_statut_check
  CHECK (statut IN ('active', 'expired', 'revoked', 'demo'));
