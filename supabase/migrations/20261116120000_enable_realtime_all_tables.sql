-- Enable Supabase Realtime postgres_changes publication on all core PressingLite tables
-- (Idempotent: safely ignores tables already added to supabase_realtime)

DO $$
DECLARE
  tbl text;
  tables_to_add text[] := ARRAY[
    'clients',
    'depots',
    'depot_articles',
    'depot_avances',
    'articles',
    'article_variants',
    'types_traitement',
    'modes_reglement',
    'depenses',
    'depense_categories',
    'consommables',
    'fidelite_points',
    'entreprise',
    'entreprise_members',
    'licences',
    'join_requests'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_to_add LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
      EXCEPTION
        WHEN duplicate_object THEN
          NULL;
      END;
    END IF;
  END LOOP;
END $$;
