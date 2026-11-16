/*
# Create relances table for inactive client outreach tracking

## Description
Adds a `relances` table to record each outreach action (WhatsApp, call, SMS, etc.)
toward an inactive client, plus a printable journal of all relances.

## New table: relances
- id (uuid, PK)
- client_id (uuid, FK to clients, ON DELETE CASCADE)
- tenant_id (uuid, nullable — matches entreprise_members.tenant_id)
- boutique_id (uuid, nullable)
- canal (text: 'whatsapp' | 'telephone' | 'sms' | 'autre')
- note (text, nullable)
- date_relance (timestamptz, default now())
- created_at (timestamptz, default now())

## Security
- RLS enabled on relances
- CRUD granted to authenticated
- Owner-scoped via tenant_id check against entreprise_members
*/

CREATE TABLE IF NOT EXISTS relances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tenant_id uuid,
  boutique_id uuid,
  canal text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp','telephone','sms','autre')),
  note text,
  date_relance timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE relances ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON relances TO authenticated;

DROP POLICY IF EXISTS "select_own_relances" ON relances;
CREATE POLICY "select_own_relances" ON relances
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM entreprise_members em
      WHERE em.user_id = auth.uid() AND em.tenant_id = relances.tenant_id
    )
  );

DROP POLICY IF EXISTS "insert_own_relances" ON relances;
CREATE POLICY "insert_own_relances" ON relances
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM entreprise_members em
      WHERE em.user_id = auth.uid() AND em.tenant_id = relances.tenant_id
    )
  );

DROP POLICY IF EXISTS "update_own_relances" ON relances;
CREATE POLICY "update_own_relances" ON relances
  FOR UPDATE TO authenticated
  USING (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM entreprise_members em
      WHERE em.user_id = auth.uid() AND em.tenant_id = relances.tenant_id
    )
  )
  WITH CHECK (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM entreprise_members em
      WHERE em.user_id = auth.uid() AND em.tenant_id = relances.tenant_id
    )
  );

DROP POLICY IF EXISTS "delete_own_relances" ON relances;
CREATE POLICY "delete_own_relances" ON relances
  FOR DELETE TO authenticated
  USING (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM entreprise_members em
      WHERE em.user_id = auth.uid() AND em.tenant_id = relances.tenant_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_relances_client_id ON relances(client_id);
CREATE INDEX IF NOT EXISTS idx_relances_date_relance ON relances(date_relance DESC);
