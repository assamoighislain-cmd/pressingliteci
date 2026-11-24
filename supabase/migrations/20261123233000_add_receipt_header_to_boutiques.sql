-- Migration: Add per-boutique receipt header fields (email, slogan, message_pied)
-- Each boutique already has nom, adresse, ville, telephone; these optional columns
-- allow every boutique to customize its complete receipt header & footer independently.

ALTER TABLE public.boutiques
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS slogan text,
  ADD COLUMN IF NOT EXISTS message_pied text;
