/*
# Add dashboard_visible_roles to entreprise

1. New column
- `dashboard_visible_roles` (text[], NOT NULL, default '{gerant,commercial}')
- Controls which non-admin roles can see the dashboard in the sidebar.
- Admin always sees the dashboard regardless of this setting.
2. Backfill
- All existing rows get '{gerant,commercial}' by default (current behavior).
*/

ALTER TABLE entreprise ADD COLUMN IF NOT EXISTS dashboard_visible_roles text[] NOT NULL DEFAULT '{gerant,commercial}';
