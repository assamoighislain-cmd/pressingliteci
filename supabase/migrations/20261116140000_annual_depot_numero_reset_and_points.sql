/*
  # Numérotation anti-doublon hors-ligne : Dépôts (D-numero-Annee) & Codes Clients (C-XXXX)

  1. Dépôts (`public.next_depot_numero` & `public.valider_commande`) :
     - Format sans préfixe : `D-001-2026` (continue après les anciens `D-XXXX` en 2026, puis repart à `D-001-2027` au 1er janvier).
     - Format avec préfixe point de facturation (ex. `C1`, `P1`, `ABJ1`) : `C1-D-001-2026`.
  2. Clients (`public.generate_client_code`) :
     - Format sans préfixe : `C-0001`.
     - Format avec préfixe point de facturation : `C1-C-0001`.
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
  v_max_seq integer := 0;
  v_legacy_max integer := 0;
BEGIN
  v_tenant_id := public.get_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_year := COALESCE(p_year, EXTRACT(YEAR FROM now())::integer);
  v_clean_point := regexp_replace(upper(COALESCE(p_point_code, '')), '[^A-Z0-9]', '', 'g');
  v_clean_point := substring(v_clean_point FROM 1 FOR 8);

  IF v_clean_point <> '' THEN
    v_regex := '^' || v_clean_point || '-D-?([0-9]+)-' || v_year::text || '$';
  ELSE
    v_regex := '^D-?([0-9]+)-' || v_year::text || '$';
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

  -- Continuité avec les anciens numéros D-XXXX durant l'année de transition (<= 2026)
  IF v_year <= 2026 THEN
    SELECT COALESCE(MAX((substring(upper(trim(numero)) FROM '^D-?([0-9]+)$'))::integer), 0)
    INTO v_legacy_max
    FROM public.depots
    WHERE tenant_id = v_tenant_id
      AND (
        (p_boutique_id IS NULL AND boutique_id IS NULL)
        OR (p_boutique_id IS NOT NULL AND boutique_id = p_boutique_id)
      )
      AND upper(trim(numero)) ~ '^D-?[0-9]+$';

    IF v_legacy_max > v_max_seq THEN
      v_max_seq := v_legacy_max;
    END IF;
  END IF;

  IF v_clean_point <> '' THEN
    RETURN v_clean_point || '-D-' || lpad((v_max_seq + 1)::text, 3, '0') || '-' || v_year::text;
  ELSE
    RETURN 'D-' || lpad((v_max_seq + 1)::text, 3, '0') || '-' || v_year::text;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.next_depot_numero(uuid, text, integer) TO authenticated;

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
  FROM public.depots
  WHERE id = depot_id AND statut = 'COMMANDE';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'commande_not_found';
  END IF;

  v_numero := public.next_depot_numero(v_boutique_id, NULL, EXTRACT(YEAR FROM now())::integer);

  UPDATE public.depots
  SET statut = 'EN_COURS',
      date_depot = now(),
      numero = v_numero
  WHERE id = depot_id AND statut = 'COMMANDE';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.valider_commande(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_client_code(p_point_code text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tid uuid;
  v_clean_point text;
  v_regex text;
  v_point_max integer := 0;
  v_base_max integer := 0;
  v_next_num integer;
BEGIN
  v_tid := public.get_tenant_id();
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_clean_point := regexp_replace(upper(COALESCE(p_point_code, '')), '[^A-Z0-9]', '', 'g');
  v_clean_point := substring(v_clean_point FROM 1 FOR 8);

  SELECT COALESCE(MAX((substring(upper(trim(code)) FROM '^C-([0-9]+)$'))::integer), 0)
  INTO v_base_max
  FROM public.clients
  WHERE tenant_id = v_tid
    AND upper(trim(code)) ~ '^C-[0-9]+$';

  IF v_clean_point <> '' THEN
    v_regex := '^' || v_clean_point || '-C-([0-9]+)$';
    SELECT COALESCE(MAX((substring(upper(trim(code)) FROM v_regex))::integer), 0)
    INTO v_point_max
    FROM public.clients
    WHERE tenant_id = v_tid
      AND upper(trim(code)) ~ v_regex;
  ELSE
    v_point_max := v_base_max;
  END IF;

  v_next_num := GREATEST(v_point_max, v_base_max) + 1;

  UPDATE public.code_counter
  SET client_counter = v_next_num
  WHERE id = 1 AND tenant_id = v_tid;

  IF v_clean_point <> '' THEN
    RETURN v_clean_point || '-C-' || lpad(v_next_num::text, 4, '0');
  ELSE
    RETURN 'C-' || lpad(v_next_num::text, 4, '0');
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_client_code(text) TO authenticated;
