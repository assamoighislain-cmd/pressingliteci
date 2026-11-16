/*
# Add treatment type selector to client portal

1. New function: portal_get_types_traitement(e_id int)
   Returns the treatment types for the entreprise (via tenant_id match).
   Callable by anon so the portal can display them.

2. Modify portal_create_depot to accept p_type_traitement_id (uuid, nullable)
   and apply the coefficient to article prices + set the depot's traitement
   label, coefficient, type_traitement_id, and date_retrait_prevue based on it.
*/

-- ─── Portal: get treatment types ───────────────────────────
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
  SELECT user_id INTO v_tenant_id FROM entreprise WHERE id = e_id LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.id, t.libelle, t.coefficient, t.nb_jours
  FROM types_traitement t
  WHERE t.tenant_id = v_tenant_id
  ORDER BY t.coefficient ASC, t.libelle ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_types_traitement(int) TO anon, authenticated;

-- ─── Portal: create depot with treatment type ─────────────
CREATE OR REPLACE FUNCTION public.portal_create_depot(
  p_code text,
  e_id int,
  p_articles json,
  p_notes text DEFAULT NULL,
  p_date_retrait text DEFAULT NULL,
  p_type_traitement_id uuid DEFAULT NULL
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
  v_type RECORD;
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

  -- Fetch treatment type info
  IF p_type_traitement_id IS NOT NULL THEN
    SELECT t.libelle, t.coefficient, t.nb_jours
    INTO v_traitement_libelle, v_coef, v_nb_jours
    FROM types_traitement t
    WHERE t.id = p_type_traitement_id AND t.tenant_id = v_client.tenant_id
    LIMIT 1;
  END IF;

  -- Generate depot number
  INSERT INTO depot_counter (id, counter, user_id, tenant_id)
  VALUES (1, 0, v_client.tenant_id, v_client.tenant_id)
  ON CONFLICT (id, tenant_id) DO NOTHING;

  UPDATE depot_counter SET counter = counter + 1
  WHERE id = 1 AND tenant_id = v_client.tenant_id
  RETURNING counter INTO v_next_num;

  v_numero := 'D-' || lpad(v_next_num::text, 4, '0');

  -- Calculate total from articles (apply coefficient to unit price)
  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_prix_unitaire := (v_article->>'prix_unitaire')::numeric;
    v_prix_traitement := v_prix_unitaire * v_coef;
    v_prix_total := v_prix_traitement * (v_article->>'nb_pieces')::int * (v_article->>'quantite')::int;
    v_total := v_total + v_prix_total;
  END LOOP;

  -- Apply client discount if applicable
  IF v_client.taux_remise > 0 AND v_client.condition_remise IS NOT NULL AND v_total >= v_client.condition_remise THEN
    v_total := v_total - (v_total * v_client.taux_remise / 100);
  END IF;

  -- Parse retrait date
  IF p_date_retrait IS NOT NULL THEN
    v_date_retrait := p_date_retrait::timestamptz;
  ELSE
    v_date_retrait := now() + (v_nb_jours || ' days')::interval;
  END IF;

  -- Create depot
  INSERT INTO depots (
    numero, client_id, statut, mode_reglement, avance_amount,
    total, traitement, coefficient, date_depot, date_retrait_prevue,
    notes, taux_remise, user_id, tenant_id, boutique_id, type_traitement_id
  ) VALUES (
    v_numero, v_client.id, 'EN_COURS', NULL, 0,
    v_total, v_traitement_libelle, v_coef, now(), v_date_retrait,
    p_notes, v_client.taux_remise, v_client.tenant_id, v_client.tenant_id, v_client.boutique_id, p_type_traitement_id
  ) RETURNING id INTO v_depot_id;

  -- Insert articles (with coefficient applied to prix_traitement)
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

GRANT EXECUTE ON FUNCTION public.portal_create_depot(text, int, json, text, text, uuid) TO anon, authenticated;
