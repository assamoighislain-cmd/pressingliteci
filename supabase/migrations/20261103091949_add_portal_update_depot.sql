/*
# Add portal_update_depot — client can modify an uncollected order

## Description
Clients sometimes need to modify an order after placing it (add/remove items,
change treatment type, update pickup/delivery details). This is only allowed
while the order has NOT been collected yet (statut = 'COMMANDE'). Once the
pressing collects the items (statut becomes 'EN_COURS'), the order is locked.

## New function
- `portal_update_depot(p_code text, e_id int, p_depot_id uuid, p_articles json,
  p_type_traitement_id uuid, p_pickup_requested boolean, p_pickup_address text,
  p_pickup_latitude double precision, p_pickup_longitude double precision,
  p_pickup_day text, p_delivery_requested boolean, p_delivery_address text,
  p_delivery_latitude double precision, p_delivery_longitude double precision,
  p_delivery_day text)` — SECURITY DEFINER function that:
    1. Validates the portal code + entreprise pair and that the depot belongs
       to that client.
    2. Verifies the depot is still in 'COMMANDE' status (not yet collected).
    3. Deletes all existing depot_articles and re-inserts the new set.
    4. Recalculates the total (articles × coefficient + pickup/delivery fees).
    5. Updates type_traitement_id, coefficient, traitement, pickup/delivery
       fields, frais_collecte, frais_livraison, and total on the depot row.
    6. Returns the updated depot id.

## Security
- SECURITY DEFINER with fixed search_path, callable by anon and authenticated.
- Only the client matching the portal code + entreprise can update their own depot.
- Only 'COMMANDE' status depots can be modified — collected/in-progress orders are locked.
*/

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

  -- Fetch the depot and verify ownership + status
  SELECT d.id, d.statut
  INTO v_depot
  FROM depots d
  WHERE d.id = p_depot_id AND d.client_id = v_client.id
  LIMIT 1;

  IF v_depot.id IS NULL THEN
    RAISE EXCEPTION 'depot_not_found';
  END IF;

  IF v_depot.statut <> 'COMMANDE' THEN
    RAISE EXCEPTION 'depot_not_editable';
  END IF;

  -- Resolve treatment type
  IF p_type_traitement_id IS NOT NULL THEN
    SELECT t.libelle, t.coefficient, t.nb_jours
    INTO v_traitement_libelle, v_coef, v_nb_jours
    FROM types_traitement t
    WHERE t.id = p_type_traitement_id AND t.tenant_id = v_client.tenant_id
    LIMIT 1;
  END IF;

  -- Calculate total from articles
  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_prix_unitaire := (v_article->>'prix_unitaire')::numeric;
    v_prix_traitement := v_prix_unitaire * v_coef;
    v_prix_total := v_prix_traitement * (v_article->>'nb_pieces')::int * (v_article->>'quantite')::int;
    v_total := v_total + v_prix_total;
  END LOOP;

  -- Apply client discount
  IF v_client.taux_remise > 0 AND v_client.condition_remise IS NOT NULL AND v_total >= v_client.condition_remise THEN
    v_total := v_total - (v_total * v_client.taux_remise / 100);
  END IF;

  -- Pickup fee
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

  -- Delivery fee
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

  -- Update the depot row
  UPDATE depots SET
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

  -- Replace articles: delete old, insert new
  DELETE FROM depot_articles WHERE depot_id = p_depot_id;

  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_prix_unitaire := (v_article->>'prix_unitaire')::numeric;
    v_prix_traitement := v_prix_unitaire * v_coef;
    v_prix_total := v_prix_traitement * (v_article->>'nb_pieces')::int * (v_article->>'quantite')::int;

    INSERT INTO depot_articles (
      depot_id, designation, prix_unitaire, prix_traitement,
      quantite, nb_pieces, prix_total, couleur, signe_particulier, griffe
    ) VALUES (
      p_depot_id,
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

  RETURN QUERY SELECT p_depot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_update_depot(text, int, uuid, json, uuid, boolean, text, double precision, double precision, text, boolean, text, double precision, double precision, text) TO anon, authenticated;
