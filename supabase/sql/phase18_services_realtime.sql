-- Enable realtime broadcasts for the services table so newly added/edited/deleted
-- services propagate to all connected clients in real time.

ALTER TABLE public.services REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'services'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.services';
  END IF;
END $$;
