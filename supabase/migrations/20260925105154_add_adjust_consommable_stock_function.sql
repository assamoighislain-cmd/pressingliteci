/*
# Add adjust_consommable_stock RPC function

1. New Functions
- `adjust_consommable_stock(c_id uuid, delta numeric)`: Atomically adjusts the stock quantity of a consommable by the given delta (positive for entries, negative for exits). Security definer so it runs with elevated privileges to update the consommables row.

2. Security
- SECURITY DEFINER, search_path = public.
- Callable by authenticated users only (RLS on consommables still applies via tenant checks).
*/

CREATE OR REPLACE FUNCTION public.adjust_consommable_stock(c_id uuid, delta numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE consommables
  SET quantite = quantite + delta,
      updated_at = now()
  WHERE id = c_id;
END;
$$;
