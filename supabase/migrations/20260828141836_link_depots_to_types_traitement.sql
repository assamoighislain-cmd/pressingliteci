/*
# Link depots to types_traitement via foreign key

Adds `type_traitement_id` column to `depots` referencing `types_traitement(id)`.
The existing `traitement` (text) and `coefficient` (numeric) columns are kept for
backward compatibility but the new FK provides a proper relational link.
*/

ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS type_traitement_id uuid
  REFERENCES public.types_traitement(id) ON DELETE SET NULL;

-- Index for faster joins
CREATE INDEX IF NOT EXISTS idx_depots_type_traitement_id
  ON public.depots(type_traitement_id);

-- Backfill existing rows: match by libelle within the same tenant
UPDATE public.depots d
SET type_traitement_id = (
  SELECT t.id FROM public.types_traitement t
  WHERE t.tenant_id = d.tenant_id
    AND t.libelle = d.traitement
  LIMIT 1
)
WHERE d.type_traitement_id IS NULL
  AND d.traitement IS NOT NULL;
