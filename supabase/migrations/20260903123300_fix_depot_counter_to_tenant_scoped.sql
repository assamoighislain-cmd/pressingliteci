-- The depot_counter table and increment_depot_counter() function were keyed
-- on (id, user_id), i.e. per team member. But depots.numero is unique per
-- tenant_id. When a second team member creates a depot, they get a counter
-- starting from 1, which collides with an existing numero for the same tenant.
--
-- Fix: scope the counter to tenant_id instead of user_id.

-- Step 1: Consolidate duplicate rows per tenant — keep the row with the
-- highest counter, merge the others into it, then delete the losers.
WITH ranked AS (
  SELECT id, tenant_id, counter, user_id,
    ROW_NUMBER() OVER (PARTITION BY id, tenant_id ORDER BY counter DESC) AS rn
  FROM depot_counter
),
max_vals AS (
  SELECT id, tenant_id, MAX(counter) AS max_counter
  FROM depot_counter
  GROUP BY id, tenant_id
)
UPDATE depot_counter dc
SET counter = mv.max_counter
FROM max_vals mv
WHERE dc.id = mv.id AND dc.tenant_id = mv.tenant_id;

-- Delete duplicate rows (keep the one with highest counter, which is rn=1)
DELETE FROM depot_counter
WHERE (id, tenant_id, counter) IN (
  SELECT id, tenant_id, counter
  FROM (
    SELECT id, tenant_id, counter,
      ROW_NUMBER() OVER (PARTITION BY id, tenant_id ORDER BY counter DESC) AS rn
    FROM depot_counter
  ) t
  WHERE rn > 1
);

-- Step 2: Change primary key from (id, user_id) to (id, tenant_id)
ALTER TABLE depot_counter DROP CONSTRAINT depot_counter_pkey;
ALTER TABLE depot_counter ADD CONSTRAINT depot_counter_pkey PRIMARY KEY (id, tenant_id);

-- Step 3: Backfill counters so next number never collides with existing depots
UPDATE depot_counter dc
SET counter = GREATEST(
  dc.counter,
  COALESCE((SELECT count(*) FROM depots d WHERE d.tenant_id = dc.tenant_id), 0)
);

-- Step 4: Rewrite the function to be tenant-scoped
CREATE OR REPLACE FUNCTION public.increment_depot_counter()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  next_num integer;
  uid uuid := auth.uid();
  t_id uuid;
BEGIN
  t_id := public.get_tenant_id();
  IF t_id IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise trouvée';
  END IF;

  INSERT INTO depot_counter (id, counter, user_id, tenant_id)
  VALUES (1, 0, uid, t_id)
  ON CONFLICT (id, tenant_id) DO NOTHING;

  UPDATE depot_counter SET counter = counter + 1
  WHERE id = 1 AND tenant_id = t_id
  RETURNING counter INTO next_num;

  RETURN next_num;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_depot_counter() TO authenticated;
