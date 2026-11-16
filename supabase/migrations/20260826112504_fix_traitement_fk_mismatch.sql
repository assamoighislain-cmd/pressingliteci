/*
# Fix traitement FK mismatch

## Problem
depots.traitement has FK to types_traitement(code), but the app sends
TraitementCode enum values ('NORMAL', 'EXPRESS', 'EXPRESS_LENDemain').
types_traitement.code now holds generated codes like 'T-MT5LFYNI'.

## Fix
1. Drop the FK constraint.
2. Backfill depots.traitement with the matching types_traitement.code
   by matching on libelle (NORMAL -> T-MT5LFYNI, etc).
3. Re-add FK on depots.traitement -> types_traitement(code).
*/

ALTER TABLE depots DROP CONSTRAINT IF EXISTS depots_traitement_fkey;

UPDATE depots d
SET traitement = tt.code
FROM types_traitement tt
WHERE d.traitement IN ('NORMAL', 'EXPRESS', 'EXPRESS_LENDemain')
  AND (
    (d.traitement = 'NORMAL' AND tt.libelle = 'NORMAL')
    OR (d.traitement = 'EXPRESS' AND tt.libelle = 'EXPRESS')
    OR (d.traitement = 'EXPRESS_LENDemain' AND tt.libelle = 'EXPRESS LENDEMENT')
  );

ALTER TABLE depots
  ADD CONSTRAINT depots_traitement_fkey
  FOREIGN KEY (traitement)
  REFERENCES types_traitement(code)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;
