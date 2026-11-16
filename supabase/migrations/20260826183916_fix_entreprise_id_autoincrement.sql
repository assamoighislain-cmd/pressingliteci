/*
# Fix entreprise table primary key

The entreprise table was originally single-row (id=1, DEFAULT 1).
After multi-tenant conversion, every user's row gets id=1 by default,
causing a primary key conflict when a second user saves their info.

Fix: make id auto-increment via a sequence so each row gets a unique id.
The existing UNIQUE(user_id) constraint handles the per-user conflict.
*/

-- Create a sequence for entreprise.id
CREATE SEQUENCE IF NOT EXISTS entreprise_id_seq;

-- Set current sequence value to max existing id
SELECT setval('entreprise_id_seq', COALESCE((SELECT MAX(id) FROM entreprise), 1));

-- Attach sequence as default for id
ALTER TABLE entreprise ALTER COLUMN id SET DEFAULT nextval('entreprise_id_seq');

-- Make the sequence owned by the column for proper cleanup
ALTER SEQUENCE entreprise_id_seq OWNED BY entreprise.id;
