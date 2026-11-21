/*
# Fix portal_get_types_traitement ambiguous `id`, add article variants RPC, and align portal order totals

1. Fixes PostgreSQL error 42702 ("column reference id is ambiguous") in
   `public.portal_get_types_traitement(e_id int)` by qualifying `entreprise` with alias `ent`.
   Deduplicates identical treatment types across boutiques so each option appears once.
2. Adds `public.portal_get_article_variants(e_id int)` so clients can also pick article
   treatment variants (e.g. Lavage simple, Repassage, Nettoyage à sec) when placing an order.
3. Extends `public.portal_get_releve` to include `traitement` label on each depot.
4. Aligns `portal_create_depot` and `portal_update_depot` line-total calculation
   (`prix_unitaire * coef * quantite`) with DepotForm, CommandeView, and ClientPortal.
*/

-- ─── 1. Fix portal_get_types_traitement ───────────────────
CREATE OR REPLACE FUNCTION public.portal_get_types_traitement(e_id int)
RETURNS TABLE (
  id uuid,
  libelle text,
  coefficient numeric,
  nb_jours int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT ent.user_id INTO v_tenant_id
  FROM public.entreprise ent
  WHERE ent.id = e_id
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT sub.id, sub.libelle, sub.coefficient, sub.nb_jours
  FROM (
    SELECT DISTINCT ON (lower(trim(t.libelle)), t.coefficient, t.nb_jours)
      t.id,
      t.libelle,
      t.coefficient,
      t.nb_jours
    FROM public.types_traitement t
    LEFT JOIN public.boutiques b ON b.id = t.boutique_id
    WHERE t.tenant_id = v_tenant_id
    ORDER BY lower(trim(t.libelle)), t.coefficient, t.nb_jours, COALESCE(b.is_default, false) DESC, t.created_at ASC
  ) sub
  ORDER BY sub.coefficient ASC, sub.libelle ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_types_traitement(int) TO anon, authenticated;

-- ─── 2. Add portal_get_article_variants ───────────────────
CREATE OR REPLACE FUNCTION public.portal_get_article_variants(e_id int)
RETURNS TABLE (
  id uuid,
  article_id uuid,
  designation text,
  prix_traitement numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT ent.user_id INTO v_tenant_id
  FROM public.entreprise ent
  WHERE ent.id = e_id
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT av.id, av.article_id, av.designation, av.prix_traitement
  FROM public.article_variants av
  WHERE av.tenant_id = v_tenant_id
  ORDER BY av.created_at ASC, av.designation ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_article_variants(int) TO anon, authenticated;

-- ─── 3. Extend portal_get_releve with traitement label ────
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
        'total', d.total,
        'mode_reglement', d.mode_reglement,
        'avance_amount', d.avance_amount,
        'notes', d.notes,
        'type_traitement_id', d.type_traitement_id,
        'traitement', d.traitement,
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

-- ─── 4. Align portal_create_depot line total calculation ──
CREATE OR REPLACE FUNCTION public.portal_create_depot(
  p_code text,
  e_id int,
  p_articles json,
  p_notes text DEFAULT NULL,
  p_date_retrait text DEFAULT NULL,
  p_type_traitement_id uuid DEFAULT NULL,
  p_pickup_requested boolean DEFAULT false,
  p_pickup_address text DEFAULT NULL,
  p_pickup_latitude double precision DEFAULT NULL,
  p_pickup_longitude double precision DEFAULT NULL,
  p_pickup_day text DEFAULT NULL,
  p_delivery_requested boolean DEFAULT false,
  p_delivery_address text DEFAULT NULL,
  p_delivery_latitude double precision DEFAULT NULL,
  p_delivery_longitude double precision DEFAULT NULL,
  p_delivery_day text DEFAULT NULL
)
RETURNS TABLE (depot_id uuid, numero text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_client RECORD;
  v_depot_id uuid;
  v_article json;
  v_total numeric := 0;
  v_date_retrait timestamptz;
  v_coef numeric := 1.0;
  v_traitement_libelle text := '';
  v_nb_jours int := 1;
  v_prix_unitaire numeric;
  v_prix_traitement numeric;
  v_prix_total numeric;
  v_ent RECORD;
  v_frais_livraison numeric := 0;
  v_frais_collecte numeric := 0;
  v_distance_km double precision := 0;
  v_lat1 double precision;
  v_lon1 double precision;
  v_lat2 double precision;
  v_lon2 double precision;
  v_dlat double precision;
  v_dlon double precision;
  v_a double precision;
  v_c double precision;
BEGIN
  SELECT c.id, c.nom, c.tenant_id, c.taux_remise, c.condition_remise, c.boutique_id
  INTO v_client
  FROM public.clients c
  JOIN public.entreprise e ON e.user_id = c.tenant_id
  WHERE c.portal_code = UPPER(TRIM(p_code)) AND e.id = e_id
  LIMIT 1;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT e.delivery_base_fee, e.delivery_price_per_km, e.delivery_latitude, e.delivery_longitude
  INTO v_ent
  FROM public.entreprise e
  WHERE e.id = e_id
  LIMIT 1;

  IF p_type_traitement_id IS NOT NULL THEN
    SELECT t.libelle, t.coefficient, t.nb_jours
    INTO v_traitement_libelle, v_coef, v_nb_jours
    FROM public.types_traitement t
    WHERE t.id = p_type_traitement_id AND t.tenant_id = v_client.tenant_id
    LIMIT 1;
  END IF;

  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_prix_unitaire := (v_article->>'prix_unitaire')::numeric;
    v_prix_traitement := v_prix_unitaire * v_coef;
    v_prix_total := v_prix_traitement * GREATEST(1, COALESCE((v_article->>'quantite')::int, 1));
    v_total := v_total + v_prix_total;
  END LOOP;

  IF v_coef <= 1 AND v_client.taux_remise > 0 AND v_client.condition_remise IS NOT NULL AND v_total >= v_client.condition_remise THEN
    v_total := v_total - (v_total * v_client.taux_remise / 100);
  END IF;

  -- Pickup fee based on distance
  IF p_pickup_requested AND p_pickup_latitude IS NOT NULL AND p_pickup_longitude IS NOT NULL
     AND v_ent.delivery_latitude IS NOT NULL AND v_ent.delivery_longitude IS NOT NULL THEN
    v_lat1 := radians(v_ent.delivery_latitude);
    v_lon1 := radians(v_ent.delivery_longitude);
    v_lat2 := radians(p_pickup_latitude);
    v_lon2 := radians(p_pickup_longitude);
    v_dlat := v_lat2 - v_lat1;
    v_dlon := v_lon2 - v_lon1;
    v_a := sin(v_dlat / 2) * sin(v_dlat / 2) + cos(v_lat1) * cos(v_lat2) * sin(v_dlon / 2) * sin(v_dlon / 2);
    v_c := 2 * asin(sqrt(v_a));
    v_distance_km := 6371.0 * v_c;
    v_frais_collecte := v_ent.delivery_base_fee + (v_ent.delivery_price_per_km * v_distance_km);
    v_total := v_total + v_frais_collecte;
  ELSIF p_pickup_requested THEN
    v_frais_collecte := v_ent.delivery_base_fee;
    v_total := v_total + v_frais_collecte;
  END IF;

  -- Delivery fee based on distance
  IF p_delivery_requested AND p_delivery_latitude IS NOT NULL AND p_delivery_longitude IS NOT NULL
     AND v_ent.delivery_latitude IS NOT NULL AND v_ent.delivery_longitude IS NOT NULL THEN
    v_lat1 := radians(v_ent.delivery_latitude);
    v_lon1 := radians(v_ent.delivery_longitude);
    v_lat2 := radians(p_delivery_latitude);
    v_lon2 := radians(p_delivery_longitude);
    v_dlat := v_lat2 - v_lat1;
    v_dlon := v_lon2 - v_lon1;
    v_a := sin(v_dlat / 2) * sin(v_dlat / 2) + cos(v_lat1) * cos(v_lat2) * sin(v_dlon / 2) * sin(v_dlon / 2);
    v_c := 2 * asin(sqrt(v_a));
    v_distance_km := 6371.0 * v_c;
    v_frais_livraison := v_ent.delivery_base_fee + (v_ent.delivery_price_per_km * v_distance_km);
    v_total := v_total + v_frais_livraison;
  ELSIF p_delivery_requested THEN
    v_frais_livraison := v_ent.delivery_base_fee;
    v_total := v_total + v_frais_livraison;
  END IF;

  IF p_date_retrait IS NOT NULL THEN
    v_date_retrait := p_date_retrait::timestamptz;
  ELSE
    v_date_retrait := now() + (v_nb_jours || ' days')::interval;
  END IF;

  INSERT INTO public.depots (
    numero, client_id, statut, mode_reglement, avance_amount,
    total, traitement, coefficient, date_depot, date_retrait_prevue,
    notes, taux_remise, user_id, tenant_id, boutique_id, type_traitement_id,
    pickup_requested, pickup_address, pickup_latitude, pickup_longitude, pickup_day,
    delivery_requested, delivery_address, delivery_latitude, delivery_longitude, delivery_day,
    frais_livraison, frais_collecte
  ) VALUES (
    NULL, v_client.id, 'COMMANDE', NULL, 0,
    v_total, v_traitement_libelle, v_coef, now(), v_date_retrait,
    p_notes, v_client.taux_remise, v_client.tenant_id, v_client.tenant_id, v_client.boutique_id, p_type_traitement_id,
    p_pickup_requested, p_pickup_address, p_pickup_latitude, p_pickup_longitude, p_pickup_day,
    p_delivery_requested, p_delivery_address, p_delivery_latitude, p_delivery_longitude, p_delivery_day,
    v_frais_livraison, v_frais_collecte
  ) RETURNING id INTO v_depot_id;

  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_prix_unitaire := (v_article->>'prix_unitaire')::numeric;
    v_prix_traitement := v_prix_unitaire * v_coef;
    v_prix_total := v_prix_traitement * GREATEST(1, COALESCE((v_article->>'quantite')::int, 1));

    INSERT INTO public.depot_articles (
      depot_id, designation, prix_unitaire, prix_traitement,
      quantite, nb_pieces, prix_total, couleur, signe_particulier, griffe
    ) VALUES (
      v_depot_id,
      v_article->>'designation',
      v_prix_unitaire,
      v_prix_traitement,
      GREATEST(1, COALESCE((v_article->>'quantite')::int, 1)),
      GREATEST(1, COALESCE((v_article->>'nb_pieces')::int, 1)),
      v_prix_total,
      v_article->>'couleur',
      v_article->>'signe_particulier',
      v_article->>'griffe'
    );
  END LOOP;

  RETURN QUERY SELECT v_depot_id, NULL::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_create_depot(text, int, json, text, text, uuid, boolean, text, double precision, double precision, text, boolean, text, double precision, double precision, text) TO anon, authenticated;

-- ─── 5. Align portal_update_depot line total calculation ──
CREATE OR REPLACE FUNCTION public.portal_update_depot(
  p_code text,
  e_id int,
  p_depot_id uuid,
  p_articles json,
  p_type_traitement_id uuid DEFAULT NULL,
  p_pickup_requested boolean DEFAULT false,
  p_pickup_address text DEFAULT NULL,
  p_pickup_latitude double precision DEFAULT NULL,
  p_pickup_longitude double precision DEFAULT NULL,
  p_pickup_day text DEFAULT NULL,
  p_delivery_requested boolean DEFAULT false,
  p_delivery_address text DEFAULT NULL,
  p_delivery_latitude double precision DEFAULT NULL,
  p_delivery_longitude double precision DEFAULT NULL,
  p_delivery_day text DEFAULT NULL
)
RETURNS TABLE (depot_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_client RECORD;
  v_ent RECORD;
  v_depot RECORD;
  v_article json;
  v_total numeric := 0;
  v_coef numeric := 1.0;
  v_traitement_libelle text := '';
  v_nb_jours int := 1;
  v_prix_unitaire numeric;
  v_prix_traitement numeric;
  v_prix_total numeric;
  v_frais_livraison numeric := 0;
  v_frais_collecte numeric := 0;
  v_distance_km double precision := 0;
  v_lat1 double precision;
  v_lon1 double precision;
  v_lat2 double precision;
  v_lon2 double precision;
  v_dlat double precision;
  v_dlon double precision;
  v_a double precision;
  v_c double precision;
  v_date_retrait timestamptz;
BEGIN
  SELECT c.id, c.tenant_id, c.taux_remise, c.condition_remise
  INTO v_client
  FROM public.clients c
  JOIN public.entreprise e ON e.user_id = c.tenant_id
  WHERE c.portal_code = UPPER(TRIM(p_code)) AND e.id = e_id
  LIMIT 1;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT e.delivery_base_fee, e.delivery_price_per_km, e.delivery_latitude, e.delivery_longitude
  INTO v_ent
  FROM public.entreprise e
  WHERE e.id = e_id
  LIMIT 1;

  SELECT d.id, d.statut
  INTO v_depot
  FROM public.depots d
  WHERE d.id = p_depot_id AND d.client_id = v_client.id
  LIMIT 1;

  IF v_depot.id IS NULL THEN
    RAISE EXCEPTION 'depot_not_found';
  END IF;

  IF v_depot.statut <> 'COMMANDE' THEN
    RAISE EXCEPTION 'depot_not_editable';
  END IF;

  IF p_type_traitement_id IS NOT NULL THEN
    SELECT t.libelle, t.coefficient, t.nb_jours
    INTO v_traitement_libelle, v_coef, v_nb_jours
    FROM public.types_traitement t
    WHERE t.id = p_type_traitement_id AND t.tenant_id = v_client.tenant_id
    LIMIT 1;
  END IF;

  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_prix_unitaire := (v_article->>'prix_unitaire')::numeric;
    v_prix_traitement := v_prix_unitaire * v_coef;
    v_prix_total := v_prix_traitement * GREATEST(1, COALESCE((v_article->>'quantite')::int, 1));
    v_total := v_total + v_prix_total;
  END LOOP;

  IF v_coef <= 1 AND v_client.taux_remise > 0 AND v_client.condition_remise IS NOT NULL AND v_total >= v_client.condition_remise THEN
    v_total := v_total - (v_total * v_client.taux_remise / 100);
  END IF;

  IF p_pickup_requested AND p_pickup_latitude IS NOT NULL AND p_pickup_longitude IS NOT NULL
     AND v_ent.delivery_latitude IS NOT NULL AND v_ent.delivery_longitude IS NOT NULL THEN
    v_lat1 := radians(v_ent.delivery_latitude);
    v_lon1 := radians(v_ent.delivery_longitude);
    v_lat2 := radians(p_pickup_latitude);
    v_lon2 := radians(p_pickup_longitude);
    v_dlat := v_lat2 - v_lat1;
    v_dlon := v_lon2 - v_lon1;
    v_a := sin(v_dlat / 2) * sin(v_dlat / 2) + cos(v_lat1) * cos(v_lat2) * sin(v_dlon / 2) * sin(v_dlon / 2);
    v_c := 2 * asin(sqrt(v_a));
    v_distance_km := 6371.0 * v_c;
    v_frais_collecte := v_ent.delivery_base_fee + (v_ent.delivery_price_per_km * v_distance_km);
    v_total := v_total + v_frais_collecte;
  ELSIF p_pickup_requested THEN
    v_frais_collecte := v_ent.delivery_base_fee;
    v_total := v_total + v_frais_collecte;
  END IF;

  IF p_delivery_requested AND p_delivery_latitude IS NOT NULL AND p_delivery_longitude IS NOT NULL
     AND v_ent.delivery_latitude IS NOT NULL AND v_ent.delivery_longitude IS NOT NULL THEN
    v_lat1 := radians(v_ent.delivery_latitude);
    v_lon1 := radians(v_ent.delivery_longitude);
    v_lat2 := radians(p_delivery_latitude);
    v_lon2 := radians(p_delivery_longitude);
    v_dlat := v_lat2 - v_lat1;
    v_dlon := v_lon2 - v_lon1;
    v_a := sin(v_dlat / 2) * sin(v_dlat / 2) + cos(v_lat1) * cos(v_lat2) * sin(v_dlon / 2) * sin(v_dlon / 2);
    v_c := 2 * asin(sqrt(v_a));
    v_distance_km := 6371.0 * v_c;
    v_frais_livraison := v_ent.delivery_base_fee + (v_ent.delivery_price_per_km * v_distance_km);
    v_total := v_total + v_frais_livraison;
  ELSIF p_delivery_requested THEN
    v_frais_livraison := v_ent.delivery_base_fee;
    v_total := v_total + v_frais_livraison;
  END IF;

  v_date_retrait := now() + (v_nb_jours || ' days')::interval;

  UPDATE public.depots SET
    total = v_total,
    type_traitement_id = p_type_traitement_id,
    traitement = v_traitement_libelle,
    coefficient = v_coef,
    date_retrait_prevue = v_date_retrait,
    pickup_requested = p_pickup_requested,
    pickup_address = p_pickup_address,
    pickup_latitude = p_pickup_latitude,
    pickup_longitude = p_pickup_longitude,
    pickup_day = p_pickup_day,
    delivery_requested = p_delivery_requested,
    delivery_address = p_delivery_address,
    delivery_latitude = p_delivery_latitude,
    delivery_longitude = p_delivery_longitude,
    delivery_day = p_delivery_day,
    frais_collecte = v_frais_collecte,
    frais_livraison = v_frais_livraison
  WHERE id = p_depot_id;

  DELETE FROM public.depot_articles WHERE depot_id = p_depot_id;

  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_prix_unitaire := (v_article->>'prix_unitaire')::numeric;
    v_prix_traitement := v_prix_unitaire * v_coef;
    v_prix_total := v_prix_traitement * GREATEST(1, COALESCE((v_article->>'quantite')::int, 1));

    INSERT INTO public.depot_articles (
      depot_id, designation, prix_unitaire, prix_traitement,
      quantite, nb_pieces, prix_total, couleur, signe_particulier, griffe
    ) VALUES (
      p_depot_id,
      v_article->>'designation',
      v_prix_unitaire,
      v_prix_traitement,
      GREATEST(1, COALESCE((v_article->>'quantite')::int, 1)),
      GREATEST(1, COALESCE((v_article->>'nb_pieces')::int, 1)),
      v_prix_total,
      v_article->>'couleur',
      v_article->>'signe_particulier',
      v_article->>'griffe'
    );
  END LOOP;

  RETURN QUERY SELECT p_depot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_update_depot(text, int, uuid, json, uuid, boolean, text, double precision, double precision, text, boolean, text, double precision, double precision, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
