/*
# Add delivery requests to client portal orders

1. Modified Functions
- `portal_create_depot` now accepts a delivery request, address, coordinates, and preferred day.
- New portal orders continue to use the existing COMMANDE workflow.

2. Modified Tables
- `depots.delivery_requested`, `delivery_address`, `delivery_latitude`, `delivery_longitude`, and `delivery_day` receive the client request.

3. Security
- The existing SECURITY DEFINER function remains restricted to anon and authenticated callers.
- The client code and enterprise match checks remain unchanged.

4. Important Notes
- Existing order data is preserved.
- The old overloaded portal function signature is removed so named RPC calls remain unambiguous.
*/

DROP FUNCTION IF EXISTS public.portal_create_depot(text, int, json, text, text, uuid, boolean, text, double precision, double precision, text);

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
  v_numero text;
  v_next_num int;
  v_article json;
  v_total numeric := 0;
  v_date_retrait timestamptz;
  v_coef numeric := 1.0;
  v_traitement_libelle text := '';
  v_nb_jours int := 1;
  v_prix_unitaire numeric;
  v_prix_traitement numeric;
  v_prix_total numeric;
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

  IF p_type_traitement_id IS NOT NULL THEN
    SELECT t.libelle, t.coefficient, t.nb_jours
    INTO v_traitement_libelle, v_coef, v_nb_jours
    FROM types_traitement t
    WHERE t.id = p_type_traitement_id AND t.tenant_id = v_client.tenant_id
    LIMIT 1;
  END IF;

  INSERT INTO depot_counter (id, counter, user_id, tenant_id)
  VALUES (1, 0, v_client.tenant_id, v_client.tenant_id)
  ON CONFLICT (id, tenant_id) DO NOTHING;

  UPDATE depot_counter SET counter = counter + 1
  WHERE id = 1 AND tenant_id = v_client.tenant_id
  RETURNING counter INTO v_next_num;

  v_numero := 'D-' || lpad(v_next_num::text, 4, '0');

  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_prix_unitaire := (v_article->>'prix_unitaire')::numeric;
    v_prix_traitement := v_prix_unitaire * v_coef;
    v_prix_total := v_prix_traitement * (v_article->>'nb_pieces')::int * (v_article->>'quantite')::int;
    v_total := v_total + v_prix_total;
  END LOOP;

  IF v_client.taux_remise > 0 AND v_client.condition_remise IS NOT NULL AND v_total >= v_client.condition_remise THEN
    v_total := v_total - (v_total * v_client.taux_remise / 100);
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
    delivery_requested, delivery_address, delivery_latitude, delivery_longitude, delivery_day
  ) VALUES (
    v_numero, v_client.id, 'COMMANDE', NULL, 0,
    v_total, v_traitement_libelle, v_coef, now(), v_date_retrait,
    p_notes, v_client.taux_remise, v_client.tenant_id, v_client.tenant_id, v_client.boutique_id, p_type_traitement_id,
    p_pickup_requested, p_pickup_address, p_pickup_latitude, p_pickup_longitude, p_pickup_day,
    p_delivery_requested, p_delivery_address, p_delivery_latitude, p_delivery_longitude, p_delivery_day
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

  RETURN QUERY SELECT v_depot_id, v_numero;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_create_depot(text, int, json, text, text, uuid, boolean, text, double precision, double precision, text, boolean, text, double precision, double precision, text) TO anon, authenticated;
