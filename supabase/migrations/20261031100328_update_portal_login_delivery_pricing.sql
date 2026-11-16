/*
# Update portal_login to include delivery pricing fields

## Description
The portal_login function now returns the entreprise's delivery pricing configuration
(base fee, price per km, and GPS coordinates) so the client portal can calculate
delivery fee estimates before submitting an order.

## Modified function
- `portal_login`: dropped and recreated with 4 new return columns
*/

DROP FUNCTION IF EXISTS public.portal_login(text, int);

CREATE FUNCTION public.portal_login(p_code text, e_id int)
RETURNS TABLE (
  client_id uuid,
  client_nom text,
  client_telephone text,
  taux_remise numeric,
  condition_remise numeric,
  entreprise_nom text,
  entreprise_telephone text,
  entreprise_adresse text,
  entreprise_ville text,
  delivery_base_fee numeric,
  delivery_price_per_km numeric,
  delivery_latitude double precision,
  delivery_longitude double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.nom,
    c.telephone,
    c.taux_remise,
    c.condition_remise,
    e.nom,
    e.telephone,
    e.adresse,
    e.ville,
    e.delivery_base_fee,
    e.delivery_price_per_km,
    e.delivery_latitude,
    e.delivery_longitude
  FROM clients c
  JOIN entreprise e ON e.user_id = c.tenant_id
  WHERE c.portal_code = UPPER(TRIM(p_code))
    AND e.id = e_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_login(text, int) TO anon, authenticated;
