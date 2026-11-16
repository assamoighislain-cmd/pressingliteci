/*
  # Nomenclature annuelle D001-YYYY & anti-doublon multi-points de facturation

  1. Format des numéros de dépôt :
     - Poste principal (sans code caisse) : `D001-2026`, `D002-2026`, ...
     - Multi-points de facturation (avec code caisse ex. `C1`, `C2`) : `C1-D001-2026`, `C2-D001-2026`
  2. Remise à zéro annuelle automatique chaque 1er janvier :
     - Le compteur repart automatiquement à `001` lorsque l'année change (`D001-2027`).
  3. Compatibilité totale avec les anciens numéros `D-0001` :
     - Extraction par expression régulière sécurisée (sans `CAST(REPLACE(...))` fragile).
*/

CREATE OR REPLACE FUNCTION public.next_depot_numero(
  p_boutique_id uuid DEFAULT NULL,
  p_point_code text DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_year integer;
  v_clean_point text;
  v_regex text;
  v_max_seq integer;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_year := COALESCE(p_year, EXTRACT(YEAR FROM now())::integer);
  v_clean_point := regexp_replace(upper(COALESCE(p_point_code, '')), '[^A-Z0-9]', '', 'g');
  v_clean_point := substring(v_clean_point FROM 1 FOR 6);

  IF v_clean_point <> '' THEN
    v_regex := '^' || v_clean_point || '-D([0-9]+)-' || v_year::text || '$';
  ELSE
    v_regex := '^D([0-9]+)-' || v_year::text || '$';
  END IF;

  SELECT COALESCE(MAX((substring(upper(trim(numero)) FROM v_regex))::integer), 0)
  INTO v_max_seq
  FROM public.depots
  WHERE tenant_id = v_tenant_id
    AND (
      (p_boutique_id IS NULL AND boutique_id IS NULL)
      OR (p_boutique_id IS NOT NULL AND boutique_id = p_boutique_id)
    )
    AND upper(trim(numero)) ~ v_regex;

  IF v_clean_point <> '' THEN
    RETURN v_clean_point || '-D' || lpad((v_max_seq + 1)::text, 3, '0') || '-' || v_year::text;
  ELSE
    RETURN 'D' || lpad((v_max_seq + 1)::text, 3, '0') || '-' || v_year::text;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.valider_commande(depot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_boutique_id uuid;
  v_year integer;
  v_max_seq integer;
  v_numero text;
  v_regex text;
BEGIN
  SELECT tenant_id, boutique_id INTO v_tenant_id, v_boutique_id
  FROM public.depots
  WHERE id = depot_id AND statut = 'COMMANDE';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'commande_not_found';
  END IF;

  v_year := EXTRACT(YEAR FROM now())::integer;
  v_regex := '^D([0-9]+)-' || v_year::text || '$';

  SELECT COALESCE(MAX((substring(upper(trim(numero)) FROM v_regex))::integer), 0)
  INTO v_max_seq
  FROM public.depots
  WHERE tenant_id = v_tenant_id
    AND (
      (v_boutique_id IS NULL AND boutique_id IS NULL)
      OR (v_boutique_id IS NOT NULL AND boutique_id = v_boutique_id)
    )
    AND upper(trim(numero)) ~ v_regex;

  v_numero := 'D' || lpad((v_max_seq + 1)::text, 3, '0') || '-' || v_year::text;

  UPDATE public.depots
  SET statut = 'EN_COURS',
      date_depot = now(),
      numero = v_numero
  WHERE id = depot_id AND statut = 'COMMANDE';
END;
$function$;
