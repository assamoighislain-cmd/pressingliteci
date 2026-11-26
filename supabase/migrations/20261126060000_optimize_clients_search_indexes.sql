-- Optimize client search and boutique-scoped pagination for large client lists (4,000+ rows)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes accelerate leading-wildcard ILIKE '%term%' searches on nom, telephone, and code
CREATE INDEX IF NOT EXISTS idx_clients_nom_trgm
  ON public.clients USING gin (nom gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_telephone_trgm
  ON public.clients USING gin (telephone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_code_trgm
  ON public.clients USING gin (code gin_trgm_ops);

-- Composite B-Tree index accelerates boutique-scoped paginated fetches ordered by (nom, id)
CREATE INDEX IF NOT EXISTS idx_clients_boutique_nom_id
  ON public.clients (boutique_id, nom, id);
