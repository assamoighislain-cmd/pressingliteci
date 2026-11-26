-- Migration: Add atomic RPC to normalize client code prefixes per boutique
-- and normalize any non-conforming client codes for boutique "Pressing Eco-citoyen".
--
-- Standard client code nomenclature:
--   - Without prefix: `C-0001`, `C-0002`, ...
--   - With billing-point prefix (e.g. `PEC`, `C1`): `PEC-C-0001`, `C1-C-0001`, ...

CREATE OR REPLACE FUNCTION public.normalize_boutique_client_codes(
  p_boutique_id uuid,
  p_target_prefix text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_tenant_id uuid;
  v_is_super boolean := false;
  v_is_allowed boolean := false;
  v_clean_prefix text;
  v_conform_regex text;
  v_total integer := 0;
  v_already integer := 0;
  v_updated integer := 0;
  v_max_seq integer := 0;
  v_rec record;
  v_extracted_seq integer;
  v_candidate text;
  v_next_seq integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  IF p_boutique_id IS NULL THEN
    RAISE EXCEPTION 'Boutique cible invalide.';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.boutiques
  WHERE id = p_boutique_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Boutique introuvable.';
  END IF;

  v_is_super := public.is_super_admin();
  IF NOT v_is_super THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.entreprise_members em
      WHERE em.tenant_id = v_tenant_id
        AND em.user_id = v_caller
        AND em.role IN ('admin', 'gerant')
    ) OR (v_tenant_id = v_caller)
    INTO v_is_allowed;

    IF NOT v_is_allowed THEN
      RAISE EXCEPTION 'Accès refusé : seul un administrateur ou gérant peut harmoniser les codes clients.';
    END IF;
  END IF;

  v_clean_prefix := substring(regexp_replace(upper(COALESCE(p_target_prefix, '')), '[^A-Z0-9]', '', 'g') FROM 1 FOR 8);

  IF v_clean_prefix <> '' THEN
    v_conform_regex := '^' || v_clean_prefix || '-C-([0-9]{4,})$';
  ELSE
    v_conform_regex := '^C-([0-9]{4,})$';
  END IF;

  CREATE TEMP TABLE _used_codes (
    code text PRIMARY KEY
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _client_renames (
    client_id uuid PRIMARY KEY,
    new_code text NOT NULL
  ) ON COMMIT DROP;

  -- Record all codes belonging to other boutiques in this tenant (clients_code_tenant_idx is tenant-scoped)
  INSERT INTO _used_codes (code)
  SELECT DISTINCT upper(trim(code))
  FROM public.clients
  WHERE tenant_id = v_tenant_id
    AND (boutique_id IS DISTINCT FROM p_boutique_id)
    AND code IS NOT NULL
    AND trim(code) <> ''
  ON CONFLICT DO NOTHING;

  -- Record codes already conforming in the target boutique
  INSERT INTO _used_codes (code)
  SELECT DISTINCT upper(trim(code))
  FROM public.clients
  WHERE tenant_id = v_tenant_id
    AND boutique_id = p_boutique_id
    AND code IS NOT NULL
    AND upper(trim(code)) ~ v_conform_regex
    AND code = upper(trim(code))
  ON CONFLICT DO NOTHING;

  SELECT COUNT(*) INTO v_total
  FROM public.clients
  WHERE tenant_id = v_tenant_id
    AND boutique_id = p_boutique_id;

  SELECT COUNT(*) INTO v_already
  FROM public.clients
  WHERE tenant_id = v_tenant_id
    AND boutique_id = p_boutique_id
    AND code IS NOT NULL
    AND code = upper(trim(code))
    AND upper(trim(code)) ~ v_conform_regex;

  -- Compute current max sequence among existing codes using the target prefix
  SELECT COALESCE(MAX((substring(upper(trim(code)) FROM v_conform_regex))::integer), 0)
  INTO v_max_seq
  FROM public.clients
  WHERE tenant_id = v_tenant_id
    AND code IS NOT NULL
    AND upper(trim(code)) ~ v_conform_regex;

  v_next_seq := v_max_seq + 1;

  -- Plan collision-free target codes for every non-conforming client in this boutique
  FOR v_rec IN
    SELECT id, code
    FROM public.clients
    WHERE tenant_id = v_tenant_id
      AND boutique_id = p_boutique_id
      AND NOT (
        code IS NOT NULL
        AND code = upper(trim(code))
        AND upper(trim(code)) ~ v_conform_regex
      )
    ORDER BY created_at ASC, id ASC
  LOOP
    v_extracted_seq := NULL;
    IF v_rec.code IS NOT NULL THEN
      -- Try preserving existing numeric suffix (e.g. C1-C-0042, C-42, CL0042 -> 42)
      v_extracted_seq := NULLIF(substring(upper(trim(v_rec.code)) FROM '([0-9]+)$'), '')::integer;
    END IF;

    v_candidate := NULL;
    IF v_extracted_seq IS NOT NULL AND v_extracted_seq > 0 AND v_extracted_seq < 10000000 THEN
      IF v_clean_prefix <> '' THEN
        v_candidate := v_clean_prefix || '-C-' || lpad(v_extracted_seq::text, 4, '0');
      ELSE
        v_candidate := 'C-' || lpad(v_extracted_seq::text, 4, '0');
      END IF;

      IF EXISTS (SELECT 1 FROM _used_codes WHERE code = v_candidate) THEN
        v_candidate := NULL;
      END IF;
    END IF;

    IF v_candidate IS NULL THEN
      LOOP
        IF v_clean_prefix <> '' THEN
          v_candidate := v_clean_prefix || '-C-' || lpad(v_next_seq::text, 4, '0');
        ELSE
          v_candidate := 'C-' || lpad(v_next_seq::text, 4, '0');
        END IF;
        v_next_seq := v_next_seq + 1;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM _used_codes WHERE code = v_candidate);
      END LOOP;
    END IF;

    INSERT INTO _used_codes (code) VALUES (v_candidate) ON CONFLICT DO NOTHING;
    INSERT INTO _client_renames (client_id, new_code) VALUES (v_rec.id, v_candidate);
    v_updated := v_updated + 1;
  END LOOP;

  IF v_updated > 0 THEN
    -- Phase 1: Assign temporary unique codes to prevent any swap collision on clients_code_tenant_idx
    UPDATE public.clients c
    SET code = '__NORM_' || c.id::text
    FROM _client_renames r
    WHERE c.id = r.client_id;

    -- Phase 2: Assign final conforming codes
    UPDATE public.clients c
    SET code = r.new_code
    FROM _client_renames r
    WHERE c.id = r.client_id;

    -- Sync tenant client_counter
    UPDATE public.code_counter
    SET client_counter = GREATEST(
      COALESCE(client_counter, 0),
      COALESCE((
        SELECT MAX((substring(upper(trim(code)) FROM v_conform_regex))::integer)
        FROM public.clients
        WHERE tenant_id = v_tenant_id
          AND code IS NOT NULL
          AND upper(trim(code)) ~ v_conform_regex
      ), 0)
    )
    WHERE id = 1 AND tenant_id = v_tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'already_compliant', v_already,
    'total', v_total,
    'prefix', v_clean_prefix
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_boutique_client_codes(uuid, text) TO authenticated;

-- Idempotent one-time normalization for boutique "Pressing Eco-citoyen":
-- Detects the prefix used by its deposits (if any, e.g. PEC-D-001-2026 -> PEC; otherwise '')
-- and normalizes all non-conforming client codes in that boutique to `<PREFIX>-C-0001` or `C-0001`.
DO $$
DECLARE
  v_boutique record;
  v_detected_prefix text;
  v_conform_regex text;
  v_rec record;
  v_extracted_seq integer;
  v_candidate text;
  v_next_seq integer;
  v_has_renames boolean;
BEGIN
  FOR v_boutique IN
    SELECT id, tenant_id, nom
    FROM public.boutiques
    WHERE lower(nom) LIKE '%eco%citoyen%'
       OR lower(nom) LIKE '%éco%citoyen%'
  LOOP
    -- Detect majority deposit prefix used on this boutique (empty string if standard D-001-YYYY)
    SELECT COALESCE(
      (
        SELECT substring(upper(trim(numero)) FROM '^([A-Z0-9]{1,8})-D-?[0-9]+')
        FROM public.depots
        WHERE tenant_id = v_boutique.tenant_id
          AND boutique_id = v_boutique.id
          AND numero IS NOT NULL
          AND upper(trim(numero)) ~ '^[A-Z0-9]{1,8}-D-?[0-9]+'
        GROUP BY 1
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ),
      ''
    )
    INTO v_detected_prefix;

    v_detected_prefix := substring(regexp_replace(upper(COALESCE(v_detected_prefix, '')), '[^A-Z0-9]', '', 'g') FROM 1 FOR 8);

    IF v_detected_prefix <> '' THEN
      v_conform_regex := '^' || v_detected_prefix || '-C-([0-9]{4,})$';
    ELSE
      v_conform_regex := '^C-([0-9]{4,})$';
    END IF;

    DROP TABLE IF EXISTS _mig_used_codes;
    DROP TABLE IF EXISTS _mig_renames;
    CREATE TEMP TABLE _mig_used_codes (code text PRIMARY KEY) ON COMMIT DROP;
    CREATE TEMP TABLE _mig_renames (client_id uuid PRIMARY KEY, new_code text NOT NULL) ON COMMIT DROP;

    INSERT INTO _mig_used_codes (code)
    SELECT DISTINCT upper(trim(code))
    FROM public.clients
    WHERE tenant_id = v_boutique.tenant_id
      AND (boutique_id IS DISTINCT FROM v_boutique.id)
      AND code IS NOT NULL
      AND trim(code) <> ''
    ON CONFLICT DO NOTHING;

    INSERT INTO _mig_used_codes (code)
    SELECT DISTINCT upper(trim(code))
    FROM public.clients
    WHERE tenant_id = v_boutique.tenant_id
      AND boutique_id = v_boutique.id
      AND code IS NOT NULL
      AND code = upper(trim(code))
      AND upper(trim(code)) ~ v_conform_regex
    ON CONFLICT DO NOTHING;

    SELECT COALESCE(MAX((substring(upper(trim(code)) FROM v_conform_regex))::integer), 0) + 1
    INTO v_next_seq
    FROM public.clients
    WHERE tenant_id = v_boutique.tenant_id
      AND code IS NOT NULL
      AND upper(trim(code)) ~ v_conform_regex;

    v_has_renames := false;

    FOR v_rec IN
      SELECT id, code
      FROM public.clients
      WHERE tenant_id = v_boutique.tenant_id
        AND boutique_id = v_boutique.id
        AND NOT (
          code IS NOT NULL
          AND code = upper(trim(code))
          AND upper(trim(code)) ~ v_conform_regex
        )
      ORDER BY created_at ASC, id ASC
    LOOP
      v_extracted_seq := NULL;
      IF v_rec.code IS NOT NULL THEN
        v_extracted_seq := NULLIF(substring(upper(trim(v_rec.code)) FROM '([0-9]+)$'), '')::integer;
      END IF;

      v_candidate := NULL;
      IF v_extracted_seq IS NOT NULL AND v_extracted_seq > 0 AND v_extracted_seq < 10000000 THEN
        IF v_detected_prefix <> '' THEN
          v_candidate := v_detected_prefix || '-C-' || lpad(v_extracted_seq::text, 4, '0');
        ELSE
          v_candidate := 'C-' || lpad(v_extracted_seq::text, 4, '0');
        END IF;

        IF EXISTS (SELECT 1 FROM _mig_used_codes WHERE code = v_candidate) THEN
          v_candidate := NULL;
        END IF;
      END IF;

      IF v_candidate IS NULL THEN
        LOOP
          IF v_detected_prefix <> '' THEN
            v_candidate := v_detected_prefix || '-C-' || lpad(v_next_seq::text, 4, '0');
          ELSE
            v_candidate := 'C-' || lpad(v_next_seq::text, 4, '0');
          END IF;
          v_next_seq := v_next_seq + 1;
          EXIT WHEN NOT EXISTS (SELECT 1 FROM _mig_used_codes WHERE code = v_candidate);
        END LOOP;
      END IF;

      INSERT INTO _mig_used_codes (code) VALUES (v_candidate) ON CONFLICT DO NOTHING;
      INSERT INTO _mig_renames (client_id, new_code) VALUES (v_rec.id, v_candidate);
      v_has_renames := true;
    END LOOP;

    IF v_has_renames THEN
      UPDATE public.clients c
      SET code = '__NORM_' || c.id::text
      FROM _mig_renames r
      WHERE c.id = r.client_id;

      UPDATE public.clients c
      SET code = r.new_code
      FROM _mig_renames r
      WHERE c.id = r.client_id;
    END IF;
  END LOOP;
END $$;
