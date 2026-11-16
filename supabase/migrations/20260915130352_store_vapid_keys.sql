/*
# Store VAPID keys for web push notifications

1. New Tables
- `app_settings` (key-value store for app-level configuration)
  - `key` (text, primary key)
  - `value` (text, not null)
  - `created_at` (timestamptz, default now())

2. Security
- Enable RLS on `app_settings`.
- Only service role can read/write (no anon or authenticated access).
- This protects the VAPID private key.
*/

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- No policies: only the service role (which bypasses RLS) can access this table.

INSERT INTO app_settings (key, value) VALUES
  ('vapid_public_key', 'BLtRBjIXLX_w0Q7YuoNv8PedYjWI5QnOSvc9lZYORgKeT3wHjIZpSn5Bvubx5et_XK4DK-52uYRmlZAAvXlixdk'),
  ('vapid_private_key', '3Qbos0U4SQJLBRKEzLH1kW-DqbfGz2jdAFffEan0kyo')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
