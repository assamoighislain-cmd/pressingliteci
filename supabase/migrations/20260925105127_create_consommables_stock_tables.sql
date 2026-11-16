/*
# Create consommables stock management tables

1. New Tables
- `consommables`: Stores consumable items (e.g. detergent, hangers, plastic bags) with current stock quantity.
  - id (uuid PK)
  - tenant_id (uuid, FK to entreprise)
  - boutique_id (uuid, nullable, FK to boutiques)
  - nom (text, not null) — item name
  - unite (text, not null default 'pièce') — unit of measure (L, kg, pièce, etc.)
  - quantite (numeric, default 0) — current stock quantity
  - seuil_alerte (numeric, default 0) — low-stock threshold
  - prix_unitaire (numeric, default 0) — purchase price per unit
  - fournisseur (text, nullable) — supplier name
  - created_at, updated_at (timestamps)
- `consommable_mouvements`: Stock movement log (entries and exits).
  - id (uuid PK)
  - consommable_id (uuid, FK to consommables ON DELETE CASCADE)
  - tenant_id (uuid, FK to entreprise)
  - boutique_id (uuid, nullable)
  - type_mouvement (text: 'entree' | 'sortie') — in or out
  - quantite (numeric, not null) — quantity moved
  - motif (text, nullable) — reason
  - date_mouvement (date, not null)
  - created_at (timestamp)

2. Security
- RLS enabled on both tables.
- SELECT/INSERT/UPDATE/DELETE scoped to tenant members.
- UPDATE/DELETE further restricted to admin or gerant.

3. Notes
- Stock quantity on `consommables` is updated via application logic on each movement insert.
- All tables use `is_tenant_member()` for read, `is_tenant_admin_or_gerant()` for write.
*/

CREATE TABLE IF NOT EXISTS public.consommables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.entreprise(user_id) ON DELETE CASCADE,
  boutique_id uuid REFERENCES public.boutiques(id) ON DELETE SET NULL,
  nom text NOT NULL,
  unite text NOT NULL DEFAULT 'pièce',
  quantite numeric NOT NULL DEFAULT 0,
  seuil_alerte numeric NOT NULL DEFAULT 0,
  prix_unitaire numeric NOT NULL DEFAULT 0,
  fournisseur text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consommables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_tenant_consommables" ON public.consommables;
CREATE POLICY "select_tenant_consommables" ON public.consommables
  FOR SELECT TO authenticated
  USING (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "insert_tenant_consommables" ON public.consommables;
CREATE POLICY "insert_tenant_consommables" ON public.consommables
  FOR INSERT TO authenticated
  WITH CHECK (is_tenant_admin_or_gerant(tenant_id));

DROP POLICY IF EXISTS "update_tenant_consommables" ON public.consommables;
CREATE POLICY "update_tenant_consommables" ON public.consommables
  FOR UPDATE TO authenticated
  USING (is_tenant_admin_or_gerant(tenant_id))
  WITH CHECK (is_tenant_admin_or_gerant(tenant_id));

DROP POLICY IF EXISTS "delete_tenant_consommables" ON public.consommables;
CREATE POLICY "delete_tenant_consommables" ON public.consommables
  FOR DELETE TO authenticated
  USING (is_tenant_admin_or_gerant(tenant_id));

CREATE TABLE IF NOT EXISTS public.consommable_mouvements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consommable_id uuid NOT NULL REFERENCES public.consommables(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.entreprise(user_id) ON DELETE CASCADE,
  boutique_id uuid REFERENCES public.boutiques(id) ON DELETE SET NULL,
  type_mouvement text NOT NULL CHECK (type_mouvement IN ('entree', 'sortie')),
  quantite numeric NOT NULL,
  motif text,
  date_mouvement date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consommable_mouvements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_tenant_consommable_mouvements" ON public.consommable_mouvements;
CREATE POLICY "select_tenant_consommable_mouvements" ON public.consommable_mouvements
  FOR SELECT TO authenticated
  USING (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "insert_tenant_consommable_mouvements" ON public.consommable_mouvements;
CREATE POLICY "insert_tenant_consommable_mouvements" ON public.consommable_mouvements
  FOR INSERT TO authenticated
  WITH CHECK (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "delete_tenant_consommable_mouvements" ON public.consommable_mouvements;
CREATE POLICY "delete_tenant_consommable_mouvements" ON public.consommable_mouvements
  FOR DELETE TO authenticated
  USING (is_tenant_admin_or_gerant(tenant_id));

CREATE INDEX IF NOT EXISTS idx_consommables_tenant ON public.consommables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consommable_mouvements_consommable ON public.consommable_mouvements(consommable_id);
CREATE INDEX IF NOT EXISTS idx_consommable_mouvements_tenant ON public.consommable_mouvements(tenant_id);
