/*
# Add entreprise usage stats function

1. New Functions
- `get_entreprise_usage_stats()` — SECURITY DEFINER function that returns
  per-entreprise usage statistics: total clients, total depots, depots by status
  (commande, en_cours, collecte, retire), total revenue (sum of depot.total),
  total articles, number of boutiques, and the date of the most recent depot.
  Only callable by super admins.
2. Security
- SECURITY DEFINER so it can read across all tenants (depots, clients, articles,
  boutiques are tenant-scoped with RLS — a super admin session would otherwise
  see zero rows from those tables).
- REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated only.
- Guarded by `is_super_admin()` check at the top so only super admins get data.
3. Notes
- Uses LEFT JOINs so entreprises with zero activity still appear with zeros.
- `last_activity` is the most recent depot created_at, or the entreprise
  created_at if no depots exist yet.
*/

CREATE OR REPLACE FUNCTION public.get_entreprise_usage_stats()
RETURNS TABLE (
  entreprise_id integer,
  ent_nom text,
  ent_statut text,
  total_clients bigint,
  total_depots bigint,
  depots_commande bigint,
  depots_en_cours bigint,
  depots_collecte bigint,
  depots_retire bigint,
  total_articles bigint,
  total_boutiques bigint,
  total_revenue numeric,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin only';
  END IF;

  RETURN QUERY
  SELECT
    e.id AS entreprise_id,
    e.nom AS ent_nom,
    e.statut AS ent_statut,
    COALESCE(c.cnt, 0) AS total_clients,
    COALESCE(d.cnt, 0) AS total_depots,
    COALESCE(d.cmd, 0) AS depots_commande,
    COALESCE(d.enc, 0) AS depots_en_cours,
    COALESCE(d.col, 0) AS depots_collecte,
    COALESCE(d.ret, 0) AS depots_retire,
    COALESCE(a.cnt, 0) AS total_articles,
    COALESCE(b.cnt, 0) AS total_boutiques,
    COALESCE(d.rev, 0) AS total_revenue,
    COALESCE(d.last_act, e.created_at) AS last_activity
  FROM entreprise e
  LEFT JOIN (
    SELECT tenant_id, COUNT(*) AS cnt
    FROM clients
    GROUP BY tenant_id
  ) c ON c.tenant_id = e.user_id
  LEFT JOIN (
    SELECT
      tenant_id,
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE statut = 'COMMANDE') AS cmd,
      COUNT(*) FILTER (WHERE statut = 'EN_COURS') AS enc,
      COUNT(*) FILTER (WHERE statut = 'COLLECTE') AS col,
      COUNT(*) FILTER (WHERE statut = 'RETIRE') AS ret,
      COALESCE(SUM(total), 0) AS rev,
      MAX(created_at) AS last_act
    FROM depots
    GROUP BY tenant_id
  ) d ON d.tenant_id = e.user_id
  LEFT JOIN (
    SELECT tenant_id, COUNT(*) AS cnt
    FROM articles
    GROUP BY tenant_id
  ) a ON a.tenant_id = e.user_id
  LEFT JOIN (
    SELECT tenant_id, COUNT(*) AS cnt
    FROM boutiques
    GROUP BY tenant_id
  ) b ON b.tenant_id = e.user_id
  ORDER BY COALESCE(d.cnt, 0) DESC, e.nom ASC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_entreprise_usage_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_entreprise_usage_stats() TO authenticated;
