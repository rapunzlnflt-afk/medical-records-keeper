-- dose_schedules_smoke.sql
--
-- Manual verification for 0004_dose_schedules.sql. Paste into the Supabase SQL
-- editor and run the whole thing.
--
--   * It runs inside a transaction and ends with ROLLBACK, so it leaves no
--     rows behind. Nothing here touches the `reminders`, `devices` or
--     `daily_nudges` tables.
--   * It borrows an existing auth user id purely to satisfy the foreign key.
--     No auth rows are created or modified.
--   * Every check raises an exception on failure, so a clean run that prints
--     "ALL DOSE SCHEDULE CHECKS PASSED" means all of them passed.
--
-- Run this before deploying the Edge Function change, and again after any edit
-- to dose_next_due() or log_dose().
--
-- One caveat: section C calls dose_sweep(), which by design walks every user's
-- schedules. Inside this transaction that work is rolled back with everything
-- else, but on a busy project the call is not instant.

begin;

do $$
declare
  v_user     uuid;
  v_sched    public.dose_schedules;
  v_sched_id uuid;
  v_event_id uuid;
  v_next     timestamptz;
  v_expected timestamptz;
  v_result   jsonb;
  v_status   text;
  v_count    int;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then
    raise exception 'no auth user exists to attach the test schedule to; open the app once first';
  end if;

  -- ===================================================================
  -- A. dose_next_due() — the rule, tested as a pure function.
  -- ===================================================================

  -- A1. from_last_dose: next dose is actual time + interval.
  insert into public.dose_schedules
    (user_id, source_id, label, interval_min, anchor, timezone)
  values
    (v_user, 900001, 'Smoke 4h', 240, 'from_last_dose', 'America/Chicago')
  returning * into v_sched;
  v_sched_id := v_sched.id;

  v_next := public.dose_next_due(v_sched, '2026-06-10 14:14:00-05'::timestamptz);
  if v_next <> '2026-06-10 18:14:00-05'::timestamptz then
    raise exception 'A1 relative interval: expected 18:14, got %', v_next;
  end if;

  -- A2. Daily window: a dose computed past the window end resets to the start
  -- of the next day's window. This is the guardrail that stops an every-4-hours
  -- medication drifting into the middle of the night.
  update public.dose_schedules
  set window_start = '08:00', window_end = '22:00'
  where id = v_sched_id
  returning * into v_sched;

  v_next := public.dose_next_due(v_sched, '2026-06-10 21:00:00-05'::timestamptz);
  v_expected := ('2026-06-11'::date + '08:00'::time) at time zone 'America/Chicago';
  if v_next <> v_expected then
    raise exception 'A2 window reset: expected % got %', v_expected, v_next;
  end if;

  -- A3. Same window, but the computed dose lands before the window opens.
  v_next := public.dose_next_due(v_sched, '2026-06-10 02:00:00-05'::timestamptz);
  v_expected := ('2026-06-10'::date + '08:00'::time) at time zone 'America/Chicago';
  if v_next <> v_expected then
    raise exception 'A3 window open: expected % got %', v_expected, v_next;
  end if;

  -- A4. Inside the window, nothing is adjusted.
  v_next := public.dose_next_due(v_sched, '2026-06-10 10:00:00-05'::timestamptz);
  if v_next <> '2026-06-10 14:00:00-05'::timestamptz then
    raise exception 'A4 in-window passthrough: got %', v_next;
  end if;

  -- A5. max_per_day: with the cap already met for that local day, the next
  -- dose moves to the start of the following day's window.
  update public.dose_schedules set max_per_day = 2 where id = v_sched_id
  returning * into v_sched;

  insert into public.dose_events (schedule_id, due_at, taken_at, status) values
    (v_sched_id, '2026-06-10 09:00:00-05', '2026-06-10 09:05:00-05', 'taken'),
    (v_sched_id, '2026-06-10 13:00:00-05', '2026-06-10 13:02:00-05', 'taken');

  v_next := public.dose_next_due(v_sched, '2026-06-10 13:02:00-05'::timestamptz);
  v_expected := ('2026-06-11'::date + '08:00'::time) at time zone 'America/Chicago';
  if v_next <> v_expected then
    raise exception 'A5 daily cap: expected % got %', v_expected, v_next;
  end if;

  delete from public.dose_events where schedule_id = v_sched_id;
  update public.dose_schedules set max_per_day = null where id = v_sched_id
  returning * into v_sched;

  -- A6. ends_on: past the end date the schedule is finished, not merely late.
  update public.dose_schedules set ends_on = '2026-06-10' where id = v_sched_id
  returning * into v_sched;

  v_next := public.dose_next_due(v_sched, '2026-06-10 21:00:00-05'::timestamptz);
  if v_next is not null then
    raise exception 'A6 ends_on: expected null, got %', v_next;
  end if;

  update public.dose_schedules set ends_on = null where id = v_sched_id
  returning * into v_sched;

  -- A7. fixed anchor: the next configured wall-clock time, and it must not
  -- drift. 09:00 local -> the 20:00 dose the same day.
  update public.dose_schedules
  set anchor = 'fixed', fixed_times = array['08:00','20:00'],
      window_start = null, window_end = null
  where id = v_sched_id
  returning * into v_sched;

  v_next := public.dose_next_due(v_sched, '2026-06-10 09:00:00-05'::timestamptz);
  v_expected := ('2026-06-10'::date + '20:00'::time) at time zone 'America/Chicago';
  if v_next <> v_expected then
    raise exception 'A7 fixed same-day: expected % got %', v_expected, v_next;
  end if;

  -- A8. fixed anchor rolls to tomorrow's first time after the last one today.
  v_next := public.dose_next_due(v_sched, '2026-06-10 21:00:00-05'::timestamptz);
  v_expected := ('2026-06-11'::date + '08:00'::time) at time zone 'America/Chicago';
  if v_next <> v_expected then
    raise exception 'A8 fixed next-day: expected % got %', v_expected, v_next;
  end if;

  -- A9. DST: 2026-03-08 is the US spring-forward date. An 08:00 local dose the
  -- morning after must still be 08:00 local, not 07:00 or 09:00.
  v_next := public.dose_next_due(v_sched, '2026-03-07 21:00:00-06'::timestamptz);
  v_expected := ('2026-03-08'::date + '08:00'::time) at time zone 'America/Chicago';
  if v_next <> v_expected then
    raise exception 'A9 DST boundary: expected % got %', v_expected, v_next;
  end if;
  if (v_next at time zone 'America/Chicago')::time <> '08:00'::time then
    raise exception 'A9 DST boundary: local time drifted to %',
      (v_next at time zone 'America/Chicago')::time;
  end if;

  -- ===================================================================
  -- B. log_dose() — recording a dose and queueing the next.
  -- ===================================================================

  update public.dose_schedules
  set anchor = 'from_last_dose', fixed_times = null, interval_min = 240
  where id = v_sched_id;

  insert into public.dose_events (schedule_id, due_at)
  values (v_sched_id, now() - interval '5 minutes')
  returning id into v_event_id;

  -- B1. A logged dose is recorded and the next one is queued from the ACTUAL
  -- time, roughly 4 hours out.
  v_result := public.log_dose(v_event_id, true);
  if v_result->>'outcome' <> 'logged' then
    raise exception 'B1 log: expected outcome logged, got %', v_result;
  end if;
  if (v_result->>'next_due_at')::timestamptz
     not between now() + interval '236 minutes' and now() + interval '244 minutes' then
    raise exception 'B1 next dose not ~4h out: %', v_result->>'next_due_at';
  end if;

  -- B2. The one-open-dose invariant holds: exactly one pending event.
  select count(*) into v_count
  from public.dose_events where schedule_id = v_sched_id and status = 'pending';
  if v_count <> 1 then
    raise exception 'B2 one-open invariant: % pending events', v_count;
  end if;

  -- B3. Logging the same event again reports who already did it rather than
  -- recording a second dose.
  v_result := public.log_dose(v_event_id, true);
  if v_result->>'outcome' <> 'already_logged' then
    raise exception 'B3 double log: expected already_logged, got %', v_result;
  end if;

  -- B4. Double-dose guard: the newly queued dose cannot be logged immediately
  -- after the previous one without an explicit override.
  select id into v_event_id
  from public.dose_events where schedule_id = v_sched_id and status = 'pending';

  v_result := public.log_dose(v_event_id, true);
  if v_result->>'outcome' <> 'too_soon' then
    raise exception 'B4 double-dose guard: expected too_soon, got %', v_result;
  end if;

  select status into v_status from public.dose_events where id = v_event_id;
  if v_status <> 'pending' then
    raise exception 'B4 too_soon must not modify the event, status is %', v_status;
  end if;

  -- B5. p_force overrides it, for the "logged 20 minutes ago — log anyway?"
  -- confirmation.
  v_result := public.log_dose(v_event_id, true, null, 'Test', null, true);
  if v_result->>'outcome' <> 'logged' then
    raise exception 'B5 forced log: expected logged, got %', v_result;
  end if;

  -- B6. A future dose time is rejected.
  select id into v_event_id
  from public.dose_events where schedule_id = v_sched_id and status = 'pending';
  begin
    v_result := public.log_dose(v_event_id, true, now() + interval '1 hour', null, null, true);
    raise exception 'B6 future time should have been rejected, got %', v_result;
  exception when invalid_parameter_value then
    null; -- expected
  end;

  -- B7. A skip anchors the next dose to the original due_at, not to now, so
  -- skipping does not stretch the day's spacing.
  delete from public.dose_events where schedule_id = v_sched_id;
  insert into public.dose_events (schedule_id, due_at)
  values (v_sched_id, now() - interval '60 minutes')
  returning id into v_event_id;

  v_result := public.log_dose(v_event_id, false);
  if v_result->>'outcome' <> 'logged' or v_result->>'status' <> 'skipped' then
    raise exception 'B7 skip: unexpected result %', v_result;
  end if;
  -- due_at was 60 min ago, + 240 min interval = ~180 min from now.
  if (v_result->>'next_due_at')::timestamptz
     not between now() + interval '176 minutes' and now() + interval '184 minutes' then
    raise exception 'B7 skip anchored to now instead of due_at: %', v_result->>'next_due_at';
  end if;

  -- ===================================================================
  -- C. dose_sweep() — missed doses and schedule top-up.
  -- ===================================================================

  -- C1. A pending dose past due_at + grace_min becomes 'missed'.
  delete from public.dose_events where schedule_id = v_sched_id;
  update public.dose_schedules set grace_min = 30 where id = v_sched_id;

  insert into public.dose_events (schedule_id, due_at)
  values (v_sched_id, now() - interval '3 hours')
  returning id into v_event_id;

  perform public.dose_sweep(500);

  select status into v_status from public.dose_events where id = v_event_id;
  if v_status <> 'missed' then
    raise exception 'C1 sweep: expected missed, got %', v_status;
  end if;

  -- C2. The sweep leaves the schedule with a fresh pending dose, scheduled
  -- from the rule rather than from the stale due time.
  select count(*) into v_count
  from public.dose_events where schedule_id = v_sched_id and status = 'pending';
  if v_count <> 1 then
    raise exception 'C2 sweep top-up: % pending events, expected 1', v_count;
  end if;

  select due_at into v_next
  from public.dose_events where schedule_id = v_sched_id and status = 'pending';
  if v_next < now() then
    raise exception 'C2 replacement dose is in the past: %', v_next;
  end if;

  -- C3. The partial unique index physically prevents a second open dose.
  begin
    insert into public.dose_events (schedule_id, due_at)
    values (v_sched_id, now() + interval '1 hour');
    raise exception 'C3 one-open invariant was not enforced by the index';
  exception when unique_violation then
    null; -- expected
  end;

  raise notice 'ALL DOSE SCHEDULE CHECKS PASSED';
end$$;

rollback;
