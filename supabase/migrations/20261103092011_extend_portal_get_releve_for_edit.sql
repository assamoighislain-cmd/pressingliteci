/*
# Extend portal_get_releve with edit-related fields

## Description
To support editing uncollected orders from the client portal, portal_get_releve
must return additional fields per depot: type_traitement_id, coefficient,
pickup/delivery details, and prix_unitaire on each article (so the edit form
can reconstruct the original catalog price before the treatment coefficient
was applied).

## Modified function
- `portal_get_releve`: now also returns per-depot:
    type_traitement_id, coefficient, pickup_requested, pickup_address,
    pickup_latitude, pickup_longitude, pickup_day,
    delivery_requested, delivery_address, delivery_latitude,
    delivery_longitude, delivery_day
  And per-article: prix_unitaire, prix_traitement
*/

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
  FROM clients c
  JOIN entreprise e ON e.user_id = c.tenant_id
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
        'total', d.total,
        'mode_reglement', d.mode_reglement,
        'avance_amount', d.avance_amount,
        'notes', d.notes,
        'type_traitement_id', d.type_traitement_id,
        'coefficient', d.coefficient,
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
          FROM depot_articles da WHERE da.depot_id = d.id
        ), '[]'::json),
        'avances', COALESCE((
          SELECT json_agg(json_build_object(
            'id', av.id,
            'montant', av.montant,
            'mode_reglement', av.mode_reglement,
            'date_paiement', av.date_paiement
          ))
          FROM depot_avances av WHERE av.depot_id = d.id
        ), '[]'::json)
      ) ORDER BY d.date_depot DESC)
      FROM depots d WHERE d.client_id = v_client_id
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_releve(text, int) TO anon, authenticated;
