/*
# Fix duplicate licences creation

## Problem
The `ensure_trial_licence()` function is called on every app load (App.tsx line 78).
It checks for an existing licence with `IF NOT EXISTS`, then inserts if none found.
But concurrent calls (React re-renders, Strict Mode double-mount, page reloads) race
past the check before any insert completes, creating duplicate licences.

Result: 4 entreprises have duplicate licences (one has 235, another 97, etc.).

## Fix
1. Add a UNIQUE constraint on `licences.entreprise_id` so only one licence can
   exist per entreprise — the database enforces what the function tried to do.
2. Rewrite `ensure_trial_licence()` to use `ON CONFLICT (entreprise_id) DO NOTHING`
   so concurrent calls are safe at the database level.
3. Clean up existing duplicates: keep the most recent active licence per entreprise,
   delete the rest. This is safe because the app only ever uses the latest licence
   (get_licence_status returns ORDER BY created_at DESC LIMIT 1).

## Affected tables
- `licences` — adds unique constraint on `entreprise_id`
- `ensure_trial_licence()` function — rewritten to be race-safe
*/

-- 1. Clean up duplicate licences: keep the latest one per entreprise
DELETE FROM licences
WHERE id NOT IN (
  SELECT DISTINCT ON (entreprise_id) id
  FROM licences
  ORDER BY entreprise_id, created_at DESC
);

-- 2. Add unique constraint so only one licence per entreprise can exist
CREATE UNIQUE INDEX IF NOT EXISTS licences_entreprise_id_uniq
  ON licences (entreprise_id);

-- 3. Rewrite ensure_trial_licence to be race-safe
CREATE OR REPLACE FUNCTION public.ensure_trial_licence()
RETURNS licences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entreprise_id integer;
  v_cle text;
  v_result licences;
BEGIN
  -- Find the caller's entreprise
  SELECT e.id INTO v_entreprise_id
  FROM public.entreprise e
  WHERE e.user_id = auth.uid()
  LIMIT 1;

  IF v_entreprise_id IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise trouvée pour cet utilisateur.';
  END IF;

  -- Return existing licence if one exists (unique constraint guarantees at most one)
  SELECT * INTO v_result FROM public.licences WHERE entreprise_id = v_entreprise_id LIMIT 1;
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  -- Create a 30-day trial licence; ON CONFLICT handles concurrent races
  v_cle := 'PRS-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' ||
    upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  INSERT INTO public.licences (entreprise_id, cle_licence, date_debut, date_fin, statut, created_by)
  VALUES (v_entreprise_id, v_cle, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'active', auth.uid())
  ON CONFLICT (entreprise_id) DO NOTHING
  RETURNING * INTO v_result;

  -- If a concurrent insert won, fetch it
  IF v_result IS NULL THEN
    SELECT * INTO v_result FROM public.licences WHERE entreprise_id = v_entreprise_id LIMIT 1;
  END IF;

  RETURN v_result;
END;
$$;
