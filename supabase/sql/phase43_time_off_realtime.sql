-- Ensure realtime broadcasts fire for time_off_requests so approvals
-- propagate live to every connected client (staff + admins).

ALTER TABLE public.time_off_requests REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'time_off_requests'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.time_off_requests';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- Safe to ignore: the table is already registered for Realtime.
    NULL;
END $$;
