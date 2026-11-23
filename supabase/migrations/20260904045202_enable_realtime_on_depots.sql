-- Enable realtime on depots table for pickup notifications (idempotent)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.depots;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

