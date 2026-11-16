/*
# Add date of birth to clients

## Description
Adds an optional `date_naissance` (date of birth) column to the `clients` table
so the pressing can track client birthdays and wish them via WhatsApp.

## New column on `clients`
- `date_naissance` date (nullable) — the client's birthday

## Security
No new policies needed — the existing CRUD policies on `clients` already cover
SELECT/INSERT/UPDATE/DELETE for authenticated users. The new column is
automatically covered by the existing grants.
*/

ALTER TABLE clients ADD COLUMN IF NOT EXISTS date_naissance date;
