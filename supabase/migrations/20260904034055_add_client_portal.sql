/*
# Add client portal access code

1. New Columns
- `clients.portal_code` (text, nullable) — a short unique code a client types to log into the client portal.
  Generated automatically for every existing and new client as a 6-character alphanumeric string.

2. New Constraints
- Unique constraint on (tenant_id, portal_code) so that within one entreprise the portal code is unique.

3. New Functions
- `generate_portal_code()` — generates a random 6-char uppercase alphanumeric string.
- `auto_portal_code_on_insert()` — trigger that auto-sets portal_code on new client insert if not provided.
- `portal_login(p_code text, e_id int)` — SECURITY DEFINER function that validates a portal code
  against a specific entreprise and returns the client record (id, nom, telephone, taux_remise, condition_remise).
  This is callable by the anon role (no auth needed) so clients can log in.
- `portal_get_releve(p_code text, e_id int)` — SECURITY DEFINER function that returns all depots
  for the client matching the portal code, with articles and avances, for the account statement view.
- `portal_create_depot(p_code text, e_id int, p_articles json, p_notes text, p_date_retrait text)` —
  SECURITY DEFINER function that creates a new depot (status EN_COURS) with articles from the client portal.
  Returns the new depot id and numero.

4. Security
- portal_code is unique per tenant so guessing codes within one entreprise is hard enough for a portal.
- All portal_* functions are SECURITY DEFINER with fixed search_path, callable by anon and authenticated.
- They only expose data for the specific client matching the code + entreprise pair.
- No write access to other tables is granted to anon — only through these functions.
*/

-- ─── Generate portal code helper ──────────────────────────
CREATE OR REPLACE FUNCTION public.generate_portal_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
    ''
  ) FROM generate_series(1, 6);
$$;

-- ─── Add portal_code column ───────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_code text;

-- Backfill existing clients with a unique code per tenant
DO $$
DECLARE
  rec RECORD;
  new_code text;
BEGIN
  FOR rec IN SELECT id FROM clients WHERE portal_code IS NULL LOOP
    LOOP
      new_code := public.generate_portal_code();
      IF NOT EXISTS (
        SELECT 1 FROM clients c2
        WHERE c2.tenant_id = (SELECT tenant_id FROM clients WHERE id = rec.id)
          AND c2.portal_code = new_code
      ) THEN
        UPDATE clients SET portal_code = new_code WHERE id = rec.id;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Unique constraint per tenant
CREATE UNIQUE INDEX IF NOT EXISTS clients_tenant_portal_code_unique
  ON clients (tenant_id, portal_code)
  WHERE portal_code IS NOT NULL;

-- ─── Auto-generate portal_code on insert ───────────────────
CREATE OR REPLACE FUNCTION public.auto_portal_code_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_code text;
BEGIN
  IF NEW.portal_code IS NULL THEN
    LOOP
      new_code := public.generate_portal_code();
      IF NOT EXISTS (
        SELECT 1 FROM clients c
        WHERE c.tenant_id = NEW.tenant_id AND c.portal_code = new_code
      ) THEN
        NEW.portal_code := new_code;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_portal_code ON clients;
CREATE TRIGGER trg_auto_portal_code
  BEFORE INSERT ON clients
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_portal_code_on_insert();

-- ─── Portal login function ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_login(p_code text, e_id int)
RETURNS TABLE (
  client_id uuid,
  client_nom text,
  client_telephone text,
  taux_remise numeric,
  condition_remise numeric,
  entreprise_nom text,
  entreprise_telephone text,
  entreprise_adresse text,
  entreprise_ville text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.nom,
    c.telephone,
    c.taux_remise,
    c.condition_remise,
    e.nom,
    e.telephone,
    e.adresse,
    e.ville
  FROM clients c
  JOIN entreprise e ON e.user_id = c.tenant_id
  WHERE c.portal_code = UPPER(TRIM(p_code))
    AND e.id = e_id;
END;
$$;

-- ─── Portal get releve (depots + articles) ─────────────────
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

-- ─── Portal create depot ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_create_depot(
  p_code text,
  e_id int,
  p_articles json,
  p_notes text DEFAULT NULL,
  p_date_retrait text DEFAULT NULL
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

  -- Generate depot number
  INSERT INTO depot_counter (id, counter, user_id, tenant_id)
  VALUES (1, 0, v_client.tenant_id, v_client.tenant_id)
  ON CONFLICT (id, tenant_id) DO NOTHING;

  UPDATE depot_counter SET counter = counter + 1
  WHERE id = 1 AND tenant_id = v_client.tenant_id
  RETURNING counter INTO v_next_num;

  v_numero := 'D-' || lpad(v_next_num::text, 4, '0');

  -- Calculate total from articles
  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    v_total := v_total + (v_article->>'prix_total')::numeric;
  END LOOP;

  -- Apply client discount if applicable
  IF v_client.taux_remise > 0 AND v_client.condition_remise IS NOT NULL AND v_total >= v_client.condition_remise THEN
    v_total := v_total - (v_total * v_client.taux_remise / 100);
  END IF;

  -- Parse retrait date
  IF p_date_retrait IS NOT NULL THEN
    v_date_retrait := p_date_retrait::timestamptz;
  ELSE
    v_date_retrait := now() + interval '1 day';
  END IF;

  -- Create depot
  INSERT INTO depots (
    numero, client_id, statut, mode_reglement, avance_amount,
    total, traitement, coefficient, date_depot, date_retrait_prevue,
    notes, taux_remise, user_id, tenant_id, boutique_id
  ) VALUES (
    v_numero, v_client.id, 'EN_COURS', NULL, 0,
    v_total, 'PORTAL', 1.0, now(), v_date_retrait,
    p_notes, v_client.taux_remise, v_client.tenant_id, v_client.tenant_id, v_client.boutique_id
  ) RETURNING id INTO v_depot_id;

  -- Insert articles
  FOR v_article IN SELECT * FROM json_array_elements(p_articles) LOOP
    INSERT INTO depot_articles (
      depot_id, designation, prix_unitaire, prix_traitement,
      quantite, nb_pieces, prix_total, couleur, signe_particulier, griffe
    ) VALUES (
      v_depot_id,
      v_article->>'designation',
      (v_article->>'prix_unitaire')::numeric,
      (v_article->>'prix_traitement')::numeric,
      (v_article->>'quantite')::int,
      (v_article->>'nb_pieces')::int,
      (v_article->>'prix_total')::numeric,
      v_article->>'couleur',
      v_article->>'signe_particulier',
      v_article->>'griffe'
    );
  END LOOP;

  RETURN QUERY SELECT v_depot_id, v_numero;
END;
$$;

-- ─── Grant access ──────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.portal_login(text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_releve(text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_create_depot(text, int, json, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_portal_code() TO authenticated;
