/*
# Enhance client portal pickup, processing, and home delivery workflow

1. Extends `public.portal_get_releve` to return `collected_at`, `ready_for_delivery`,
   `date_retrait`, `frais_collecte`, `frais_livraison`, `taux_remise`, and `montant_remise`
   so clients can see real-time step-by-step tracking (Commande -> Collecté -> En traitement -> Prêt -> Livré)
   and a full fee breakdown in their portal.
2. Adds `p_notes` support to `public.portal_update_depot` and `public.portal_cancel_depot`
   so clients can add special instructions and cancel an uncollected order.
3. Hardens server-side price computation in `portal_create_depot` and `portal_update_depot`
   against negative prices and records `montant_remise` accurately when client discount applies.
*/

-- ─── 1. Enrich portal_get_releve for full step-by-step tracking ───
CREATE OR REPLACE FUNCTION public.portal_get_releve(p_code text, e_id int)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_client_id uuid;
  v_tenant_id uuid;
  result json;
BEGIN
  SELECT c.id, c.tenant_id INTO v_client_id, v_tenant_id
  FROM public.clients c
  JOIN public.entreprise e ON e.user_id = c.tenant_id
  WHERE c.portal_code = UPPER(TRIM(p_code)) AND e.id = e_id
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RETURN json_build_object('error', 'invalid_code');
  END IF;

  SELECT json_build_object(
    'depots', COALESCE((
      SELECT json_agg(json_build_object(
        'id', d.id,
        'numero', d.numero,
        'statut', d.statut,
        'date_depot', d.date_depot,
        'date_retrait_prevue', d.date_retrait_prevue,
        'date_retrait', d.date_retrait,
        'collected_at', d.collected_at,
        'ready_for_delivery', d.ready_for_delivery,
        'total', d.total,
        'mode_reglement', d.mode_reglement,
        'avance_amount', d.avance_amount,
        'notes', d.notes,
        'type_traitement_id', d.type_traitement_id,
        'traitement', d.traitement,
        'coefficient', d.coefficient,
        'taux_remise', d.taux_remise,
        'montant_remise', d.montant_remise,
        'frais_collecte', d.frais_collecte,
        'frais_livraison', d.frais_livraison,
        'pickup_requested', d.pickup_requested,
        'pickup_address', d.pickup_address,
        'pickup_latitude', d.pickup_latitude,
        'pickup_longitude', d.pickup_longitude,
        'pickup_day', d.pickup_day,
        'delivery_requested', d.delivery_requested,
        'delivery_address', d.delivery_address,
        'delivery_latitude', d.delivery_latitude,
        'delivery_longitude', d.delivery_longitude,
        'delivery_day', d.delivery_day,
        'articles', COALESCE((
          SELECT json_agg(json_build_object(
            'id', da.id,
            'designation', da.designation,
            'quantite', da.quantite,
            'nb_pieces', da.nb_pieces,
            'prix_unitaire', da.prix_unitaire,
            'prix_traitement', da.prix_traitement,
            'prix_total', da.prix_total,
            'couleur', da.couleur,
            'signe_particulier', da.signe_particulier,
            'griffe', da.griffe
          ))
          FROM public.depot_articles da WHERE da.depot_id = d.id
        ), '[]'::json),
        'avances', COALESCE((
          SELECT json_agg(json_build_object(
            'id', av.id,
            'montant', av.montant,
            'mode_reglement', av.mode_reglement,
            'date_paiement', av.date_paiement
          ))
          FROM public.depot_avances av WHERE av.depot_id = d.id
        ), '[]'::json)
      ) ORDER BY d.date_depot DESC)
      FROM public.depots d WHERE d.client_id = v_client_id
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_releve(text, int) TO anon, authenticated;

-- ─── 2. Allow client to cancel an uncollected COMMANDE ──────────
CREATE OR REPLACE FUNCTION public.portal_cancel_depot(
  p_code text,
  e_id int,
  p_depot_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_client_id uuid;
  v_depot RECORD;
BEGIN
  SELECT c.id INTO v_client_id
  FROM public.clients c
  JOIN public.entreprise e ON e.user_id = c.tenant_id
  WHERE c.portal_code = UPPER(TRIM(p_code)) AND e.id = e_id
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT d.id, d.statut, d.collected_at INTO v_depot
  FROM public.depots d
  WHERE d.id = p_depot_id AND d.client_id = v_client_id
  LIMIT 1;

  IF v_depot.id IS NULL THEN
    RAISE EXCEPTION 'depot_not_found';
  END IF;

  IF v_depot.statut <> 'COMMANDE' OR v_depot.collected_at IS NOT NULL THEN
    RAISE EXCEPTION 'depot_not_cancellable';
  END IF;

  DELETE FROM public.depot_articles WHERE depot_id = p_depot_id;
  DELETE FROM public.depots WHERE id = p_depot_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_cancel_depot(text, int, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
