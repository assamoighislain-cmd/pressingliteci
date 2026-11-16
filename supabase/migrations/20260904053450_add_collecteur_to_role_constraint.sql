-- Add 'collecteur' to the allowed roles in entreprise_members
ALTER TABLE entreprise_members DROP CONSTRAINT IF EXISTS entreprise_members_role_check;
ALTER TABLE entreprise_members ADD CONSTRAINT entreprise_members_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'gerant'::text, 'commercial'::text, 'collecteur'::text]));
