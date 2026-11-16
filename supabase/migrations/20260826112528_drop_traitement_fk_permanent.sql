/*
# Drop traitement FK permanently

The app uses TraitementCode enum values ('NORMAL', 'EXPRESS', 'EXPRESS_LENDemain')
in depots.traitement. The types_traitement.code column holds generated codes
('T-MT5LFYNI'). These two systems don't match, so the FK causes sync failures.

Drop the FK and revert depots.traitement back to enum values.
*/

ALTER TABLE depots DROP CONSTRAINT IF EXISTS depots_traitement_fkey;

-- Revert: set depots.traitement back to enum values by matching on libelle
UPDATE depots d
SET traitement = CASE
  WHEN tt.libelle = 'NORMAL' THEN 'NORMAL'
  WHEN tt.libelle = 'EXPRESS' THEN 'EXPRESS'
  WHEN tt.libelle = 'EXPRESS LENDEMENT' THEN 'EXPRESS_LENDemain'
  ELSE d.traitement
END
FROM types_traitement tt
WHERE d.traitement = tt.code;
