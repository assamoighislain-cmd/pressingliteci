/*
# Fix valider_commande: use next_depot_numero instead of broken depot_counter insert

## Problem
The `valider_commande` function inserts into `depot_counter` with `user_id = v_tenant_id`
(the entreprise UUID), but `depot_counter.user_id` has a FK to `auth.users(id)`.
The entreprise UUID is NOT a user in auth.users, so the INSERT fails with a FK violation,
which is silently swallowed by the frontend catch block — making "Valider la commande"
appear to do nothing.

## Fix
Replace the manual depot_counter insert/update logic with a call to the existing
`next_depot_numero(p_boutique_id)` function, which computes the next numero from
MAX(numero) in the depots table for the tenant+boutique — no depot_counter needed.

## Changes
1. `valider_commande(depot_id uuid)` — rewritten to:
   - Look up the depot's tenant_id AND boutique_id
   - Call `next_depot_numero(boutique_id)` to get the next numero
   - Update the depot statut to EN_COURS with the new numero
2. No schema changes, no new tables, no RLS changes.
*/

CREATE OR REPLACE FUNCTION public.valider_commande(depot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_boutique_id uuid;
  v_numero text;
BEGIN
  SELECT tenant_id, boutique_id INTO v_tenant_id, v_boutique_id
  FROM depots WHERE id = depot_id AND statut = 'COMMANDE';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'commande_not_found';
  END IF;

  v_numero := public.next_depot_numero(v_boutique_id);

  UPDATE depots
  SET statut = 'EN_COURS',
      date_depot = now(),
      numero = v_numero
  WHERE id = depot_id AND statut = 'COMMANDE';
END;
$function$;
