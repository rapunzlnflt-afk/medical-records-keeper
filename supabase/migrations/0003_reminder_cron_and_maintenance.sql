-- 0003_reminder_cron_and_maintenance.sql
--
-- Codifies the pg_cron jobs that drive phone reminders, plus the log
-- retention that keeps the project inside its Disk IO budget.
--
-- Before running this, enable the `pg_cron` and `pg_net` extensions from
-- Database -> Extensions in the Supabase dashboard. Then replace
-- <project-ref> below with your project ref and run the whole file in the
-- SQL editor.
--
-- cron.schedule() upserts by job name, so re-running this file is safe and
-- will bring an existing deployment onto these definitions.
--
-- ---------------------------------------------------------------------------
-- Why these schedules look the way they do
-- ---------------------------------------------------------------------------
--
-- 1. Every 2 minutes, not every minute.
--    Reminders fire on `fire_at <= now()`, so a coarser tick only delays
--    delivery, it never drops a reminder. Halving the tick rate halves the
--    rows written to net._http_response and cron.job_run_details.
--
-- 2. Even minutes here, odd minutes for Pawfolio.
--    A small Supabase compute instance has very few background worker slots
--    (max_worker_processes = 6 on the smallest tiers). If this project also
--    hosts the Pawfolio `send-pet-reminders` job, running both on the same
--    minute can exhaust those slots and pg_cron records the run as
--    "job startup timeout" -- a silent missed notification. Staggering them
--    onto even/odd minutes guarantees only one reminder worker at a time.
--
-- 3. timeout_milliseconds is mandatory.
--    pg_net's worker holds an open transaction while a request is in flight.
--    A request that never returns keeps that transaction open, which blocks
--    autovacuum from reclaiming dead rows anywhere in the database. Left
--    alone this bloated net._http_response to 224 MB and
--    cron.job_run_details to 123 MB against roughly 1 MB of real data, and
--    burned the project's Disk IO budget. An explicit timeout bounds it.

-- ---------------------------------------------------------------------------
-- Reminder delivery -- even minutes
-- ---------------------------------------------------------------------------

select cron.schedule(
  'send-reminders-every-minute',
  '*/2 * * * *',
  $job$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);

-- The job name is kept as 'send-reminders-every-minute' for continuity with
-- deployments created before this migration existed. The schedule above is
-- the source of truth, not the name.

-- If this project also serves Pawfolio, its job belongs on the odd minutes:
--
--   select cron.schedule(
--     'send-pet-reminders-every-minute',
--     '1-59/2 * * * *',
--     $job$
--     select net.http_post(
--       url := 'https://<project-ref>.supabase.co/functions/v1/send-pet-reminders',
--       headers := jsonb_build_object('Content-Type', 'application/json'),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 10000
--     );
--     $job$
--   );

-- ---------------------------------------------------------------------------
-- Log retention
-- ---------------------------------------------------------------------------

-- pg_cron writes one cron.job_run_details row per job per run and never
-- prunes it. Keep two days for debugging.
select cron.schedule(
  'purge-cron-history',
  '15 3 * * *',
  $job$
  delete from cron.job_run_details
  where end_time < now() - interval '2 days';
  $job$
);

-- Trim pg_net's response log, and recover the worker if it is wedged on a
-- long-running transaction. The `if exists` guard means a healthy worker is
-- never disturbed.
select cron.schedule(
  'db-maintenance',
  '*/15 * * * *',
  $job$
  do $b$
  begin
    delete from net._http_response
    where created < now() - interval '1 hour';

    if exists (
      select 1
      from pg_stat_activity
      where backend_type like 'pg_net%'
        and xact_start < now() - interval '5 minutes'
    ) then
      perform net.worker_restart();
    end if;
  end
  $b$;
  $job$
);

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--
--   select jobid, jobname, schedule, active from cron.job order by jobid;
--
--   select jobid, status, count(*)
--   from cron.job_run_details
--   where start_time > now() - interval '15 minutes'
--   group by 1, 2;
--
-- Expect zero rows with status = 'failed'. Runs should complete in
-- milliseconds; multi-second runs mean the HTTP call is blocking.
--
--   select pg_size_pretty(pg_database_size(current_database()));
--
-- This should sit in the low tens of MB. Hundreds of MB means the retention
-- jobs above are not running.
