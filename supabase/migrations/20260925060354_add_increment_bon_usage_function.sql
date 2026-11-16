/*
# Add increment_bon_usage RPC function

Atomically increments usage_count on a bon de reduction.
Used when a coupon is redeemed during deposit.
*/

CREATE OR REPLACE FUNCTION public.increment_bon_usage(bon_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE bons_reduction
  SET usage_count = usage_count + 1
  WHERE id = bon_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_bon_usage(uuid) TO authenticated;
