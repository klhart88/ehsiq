-- ============================================================
-- EHS-IQ -- OPTIONAL automatic purge of expired client profiles
-- ============================================================
-- Not part of the MVP. Every profile already gets a
-- data_retention_expires_at one year after its last update
-- (trigger in 01_schema.sql), and the dashboard has a delete
-- button. Run this file when you want expired rows removed
-- automatically, every night.
--
-- If "create extension" fails, enable pg_cron in the Supabase
-- dashboard (Database > Extensions), then run only the
-- cron.schedule call.
-- ============================================================

create extension if not exists pg_cron;

select cron.schedule(
  'ehsiq-purge-expired-profiles',
  '0 8 * * *',
  $$
  delete from homeowner_profiles
  where data_retention_expires_at < now()
     or (deleted_at is not null and deleted_at < now() - interval '30 days');
  $$
);

-- Check it registered:
-- select * from cron.job where jobname = 'ehsiq-purge-expired-profiles';
