/*
# Add pickup (collecte) distance-based fees

## Description
Just like delivery fees, pickup (collecte) now generates fees based on the distance
between the pressing and the client's pickup address. The same entreprise pricing
(base fee + price per km) applies to both pickup and delivery.

## New column on `depots`
- `frais_collecte` numeric DEFAULT 0 — the computed pickup fee for this order

## Modified function
- `portal_create_depot`: now computes the Haversine distance for pickup coordinates
  too, stores the fee in `frais_collecte`, and adds it to `total`.
*/

ALTER TABLE depots ADD COLUMN IF NOT EXISTS frais_collecte numeric NOT NULL DEFAULT 0;

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
  FROM clients c
  JOIN entreprise e ON e.user_id = c.tenant_id
  WHERE c.portal_code = UPPER(TRIM(p_code)) AND e.id = e_id
  LIMIT 1;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT e.delivery_base_fee, e.delivery_price_per_km, e.delivery_latitude, e.delivery_longitude
  INTO v_ent
  FROM entreprise e
  WHERE e.id = e_id
  LIMIT 1;

  IF p_type_traitement_id IS NOT NULL THEN
    SELECT t.libelle, t.coefficient, t.nb_jours
    INTO v_traitement_libelle, v_coef, v_nb_jours
    FROM types_traitement t
    WHERE t.id = p_type_traitement_id AND t.tenant_id = v_client.tenant_id
    LIMIT 1;
  END IF;

  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_prix_unitaire := (v_article->>'prix_unitaire')::numeric;
    v_prix_traitement := v_prix_unitaire * v_coef;
    v_prix_total := v_prix_traitement * (v_article->>'nb_pieces')::int * (v_article->>'quantite')::int;
    v_total := v_total + v_prix_total;
  END LOOP;

  IF v_client.taux_remise > 0 AND v_client.condition_remise IS NOT NULL AND v_total >= v_client.condition_remise THEN
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

  INSERT INTO depots (
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
    v_prix_total := v_prix_traitement * (v_article->>'nb_pieces')::int * (v_article->>'quantite')::int;

    INSERT INTO depot_articles (
      depot_id, designation, prix_unitaire, prix_traitement,
      quantite, nb_pieces, prix_total, couleur, signe_particulier, griffe
    ) VALUES (
      v_depot_id,
      v_article->>'designation',
      v_prix_unitaire,
      v_prix_traitement,
      (v_article->>'quantite')::int,
      (v_article->>'nb_pieces')::int,
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
