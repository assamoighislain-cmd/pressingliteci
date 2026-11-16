/*
# Simplify modes_reglement to only designation

1. Modified Tables
- `modes_reglement`
  - Add `designation` (text, NOT NULL) — single property: the mode's name.
  - Migrate existing rows: copy `label` into `designation`.
  - Drop `code`, `label`, `description`, `actif`, `ordre` columns.

2. Notes
- The `depots.mode_reglement` and `depot_avances.mode_reglement` columns
  previously stored the `code` value. We migrate them to store the
  `designation` (the old `label`) instead, so they remain consistent.
- RLS policies are unchanged.
*/

-- 1. Add designation column and migrate data
ALTER TABLE modes_reglement ADD COLUMN IF NOT EXISTS designation text;

UPDATE modes_reglement
SET designation = COALESCE(label, code)
WHERE designation IS NULL;

ALTER TABLE modes_reglement ALTER COLUMN designation SET NOT NULL;

-- 2. Migrate depots.mode_reglement from code to designation
UPDATE depots d
SET mode_reglement = mr.designation
FROM modes_reglement mr
WHERE d.mode_reglement = mr.code;

-- 3. Migrate depot_avances.mode_reglement from code to designation
UPDATE depot_avances da
SET mode_reglement = mr.designation
FROM modes_reglement mr
WHERE da.mode_reglement = mr.code;

-- 4. Drop old columns
ALTER TABLE modes_reglement
  DROP COLUMN IF EXISTS code,
  DROP COLUMN IF EXISTS label,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS actif,
  DROP COLUMN IF EXISTS ordre;
