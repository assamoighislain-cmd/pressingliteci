/*
# Fix depot counter: boutique-scoped and gap-free

## Problem
The `increment_depot_counter()` function is tenant-scoped only, not boutique-scoped.
When a tenant has multiple boutiques, they share one counter, so the numero jumps
(e.g. counter=346 but only 119 depots exist — 227 numbers were wasted).

The counter is also incremented BEFORE the depot insert. If the insert fails
(validation error, network issue), the counter is consumed and the number is
lost forever, creating gaps.

Additionally, the counter table can drift from the actual max numero in depots
if rows are deleted or inserts fail.

## Fix
Replace the counter-table approach with a function that computes the next numero
from the actual MAX(numero) in the depots table for the given tenant+boutique.
This is:
- Boutique-scoped: each point of sale gets its own sequence
- Gap-resistant: failed inserts don't consume a number since no counter is pre-incremented
- Self-healing: always derived from actual data, never drifts

The function `next_depot_numero(p_boutique_id uuid)` returns the next numero
string (e.g. 'D-0120') by finding the max existing numero for the tenant+boutique
and incrementing it by 1. If no depots exist yet, it starts at 'D-0001'.

## Changes
1. New function `next_depot_numero(p_boutique_id uuid)` — computes next numero from MAX(numero)
2. Keep old `increment_depot_counter()` for backwards compat but it is no longer used
3. The depot_counter table is left in place (not dropped) to avoid data loss

## Security
- SECURITY DEFINER so it can read depots regardless of RLS
- Granted to authenticated only
- SET search_path TO 'public'
*/

CREATE OR REPLACE FUNCTION public.next_depot_numero(p_boutique_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
  v_max_numero text;
  v_max_int integer;
  v_next text;
BEGIN
  v_tenant_id := public.get_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise trouvée';
  END IF;

  -- Find the highest existing numero for this tenant+boutique
  SELECT MAX(numero) INTO v_max_numero
  FROM depots
  WHERE tenant_id = v_tenant_id
    AND (p_boutique_id IS NULL OR boutique_id = p_boutique_id);

  IF v_max_numero IS NULL THEN
    v_next := 'D-0001';
  ELSE
    -- Extract the numeric part after 'D-' and increment
    v_max_int := CAST(REPLACE(v_max_numero, 'D-', '') AS integer);
    v_next := 'D-' || lpad(CAST(v_max_int + 1 AS text), 4, '0');
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_depot_numero(uuid) TO authenticated;
