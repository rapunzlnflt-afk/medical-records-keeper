-- Read-only verification: every write happens inside this transaction and is
-- discarded by the ROLLBACK at the end. Prints computed values so the results
-- can be inspected rather than inferred from a silent pass.
begin;

create temp table dose_check(seq serial, name text, got text, expected text, ok boolean);

do $$
declare
  v_user uuid; v_s public.dose_schedules; v_id uuid; v_ev uuid;
  v_got timestamptz; v_exp timestamptz; v_r jsonb; v_n int;
begin
  select id into v_user from auth.users order by created_at limit 1;

  insert into public.dose_schedules (user_id, source_id, label, interval_min, anchor, timezone)
  values (v_user, 990001, 'Verify 4h', 240, 'from_last_dose', 'America/Chicago')
  returning * into v_s;
  v_id := v_s.id;

  -- relative interval
  v_got := public.dose_next_due(v_s, '2026-06-10 14:14:00-05');
  v_exp := '2026-06-10 18:14:00-05';
  insert into dose_check(name,got,expected,ok) values
    ('relative: taken 2:14pm + 4h', v_got::text, v_exp::text, v_got = v_exp);

  -- daily window
  update public.dose_schedules set window_start='08:00', window_end='22:00' where id=v_id returning * into v_s;
  v_got := public.dose_next_due(v_s, '2026-06-10 21:00:00-05');
  v_exp := ('2026-06-11'::date + '08:00'::time) at time zone 'America/Chicago';
  insert into dose_check(name,got,expected,ok) values
    ('window: 9pm dose would be 1am -> next 8am', v_got::text, v_exp::text, v_got = v_exp);

  v_got := public.dose_next_due(v_s, '2026-06-10 02:00:00-05');
  v_exp := ('2026-06-10'::date + '08:00'::time) at time zone 'America/Chicago';
  insert into dose_check(name,got,expected,ok) values
    ('window: 2am dose waits for 8am open', v_got::text, v_exp::text, v_got = v_exp);

  v_got := public.dose_next_due(v_s, '2026-06-10 10:00:00-05');
  v_exp := '2026-06-10 14:00:00-05';
  insert into dose_check(name,got,expected,ok) values
    ('window: in-window dose untouched', v_got::text, v_exp::text, v_got = v_exp);

  -- per-day cap
  update public.dose_schedules set max_per_day=2 where id=v_id returning * into v_s;
  insert into public.dose_events (schedule_id, due_at, taken_at, status) values
    (v_id,'2026-06-10 09:00:00-05','2026-06-10 09:05:00-05','taken'),
    (v_id,'2026-06-10 13:00:00-05','2026-06-10 13:02:00-05','taken');
  v_got := public.dose_next_due(v_s, '2026-06-10 13:02:00-05');
  v_exp := ('2026-06-11'::date + '08:00'::time) at time zone 'America/Chicago';
  insert into dose_check(name,got,expected,ok) values
    ('cap: 2 of 2 taken -> tomorrow 8am', v_got::text, v_exp::text, v_got = v_exp);
  delete from public.dose_events where schedule_id=v_id;
  update public.dose_schedules set max_per_day=null where id=v_id returning * into v_s;

  -- end date
  update public.dose_schedules set ends_on='2026-06-10' where id=v_id returning * into v_s;
  v_got := public.dose_next_due(v_s, '2026-06-10 21:00:00-05');
  insert into dose_check(name,got,expected,ok) values
    ('ends_on: course finished', coalesce(v_got::text,'NULL'), 'NULL', v_got is null);
  update public.dose_schedules set ends_on=null where id=v_id returning * into v_s;

  -- fixed anchor
  update public.dose_schedules set anchor='fixed', fixed_times=array['08:00','20:00'],
    window_start=null, window_end=null where id=v_id returning * into v_s;
  v_got := public.dose_next_due(v_s, '2026-06-10 09:00:00-05');
  v_exp := ('2026-06-10'::date + '20:00'::time) at time zone 'America/Chicago';
  insert into dose_check(name,got,expected,ok) values
    ('fixed: 9am -> 8pm same day', v_got::text, v_exp::text, v_got = v_exp);

  v_got := public.dose_next_due(v_s, '2026-06-10 21:00:00-05');
  v_exp := ('2026-06-11'::date + '08:00'::time) at time zone 'America/Chicago';
  insert into dose_check(name,got,expected,ok) values
    ('fixed: 9pm -> 8am tomorrow', v_got::text, v_exp::text, v_got = v_exp);

  -- DST spring forward, 2026-03-08
  v_got := public.dose_next_due(v_s, '2026-03-07 21:00:00-06');
  insert into dose_check(name,got,expected,ok) values
    ('DST: local clock time after spring forward',
     (v_got at time zone 'America/Chicago')::time::text, '08:00:00',
     (v_got at time zone 'America/Chicago')::time = '08:00'::time);

  -- log_dose
  update public.dose_schedules set anchor='from_last_dose', fixed_times=null where id=v_id;
  insert into public.dose_events (schedule_id, due_at) values (v_id, now() - interval '5 minutes')
  returning id into v_ev;

  v_r := public.log_dose(v_ev, true);
  insert into dose_check(name,got,expected,ok) values
    ('log_dose: outcome', v_r->>'outcome', 'logged', v_r->>'outcome'='logged'),
    ('log_dose: next dose minutes from now',
      round(extract(epoch from ((v_r->>'next_due_at')::timestamptz - now()))/60)::text, '240',
      (v_r->>'next_due_at')::timestamptz between now()+interval '236 min' and now()+interval '244 min');

  select count(*) into v_n from public.dose_events where schedule_id=v_id and status='pending';
  insert into dose_check(name,got,expected,ok) values
    ('one-open invariant: pending count', v_n::text, '1', v_n=1);

  v_r := public.log_dose(v_ev, true);
  insert into dose_check(name,got,expected,ok) values
    ('re-log same dose', v_r->>'outcome', 'already_logged', v_r->>'outcome'='already_logged');

  select id into v_ev from public.dose_events where schedule_id=v_id and status='pending';
  v_r := public.log_dose(v_ev, true);
  insert into dose_check(name,got,expected,ok) values
    ('double-dose guard', v_r->>'outcome', 'too_soon', v_r->>'outcome'='too_soon');

  v_r := public.log_dose(v_ev, true, null, 'Test', null, true);
  insert into dose_check(name,got,expected,ok) values
    ('p_force override', v_r->>'outcome', 'logged', v_r->>'outcome'='logged');

  -- skip anchors to due_at, not now
  delete from public.dose_events where schedule_id=v_id;
  insert into public.dose_events (schedule_id, due_at) values (v_id, now() - interval '60 minutes')
  returning id into v_ev;
  v_r := public.log_dose(v_ev, false);
  insert into dose_check(name,got,expected,ok) values
    ('skip: minutes from now (due_at+240, not now+240)',
      round(extract(epoch from ((v_r->>'next_due_at')::timestamptz - now()))/60)::text, '180',
      (v_r->>'next_due_at')::timestamptz between now()+interval '176 min' and now()+interval '184 min');

  -- sweep
  delete from public.dose_events where schedule_id=v_id;
  update public.dose_schedules set grace_min=30 where id=v_id;
  insert into public.dose_events (schedule_id, due_at) values (v_id, now() - interval '3 hours')
  returning id into v_ev;
  perform public.dose_sweep(500);
  insert into dose_check(name,got,expected,ok)
  select 'sweep: overdue dose status', status, 'missed', status='missed'
  from public.dose_events where id=v_ev;

  select count(*) into v_n from public.dose_events where schedule_id=v_id and status='pending';
  insert into dose_check(name,got,expected,ok) values
    ('sweep: schedule topped up', v_n::text, '1', v_n=1);

  select due_at into v_got from public.dose_events where schedule_id=v_id and status='pending';
  insert into dose_check(name,got,expected,ok) values
    ('sweep: replacement dose is in the future', (v_got > now())::text, 'true', v_got > now());

  -- the index itself
  begin
    insert into public.dose_events (schedule_id, due_at) values (v_id, now() + interval '1 hour');
    insert into dose_check(name,got,expected,ok) values
      ('index blocks a 2nd open dose', 'insert succeeded', 'unique_violation', false);
  exception when unique_violation then
    insert into dose_check(name,got,expected,ok) values
      ('index blocks a 2nd open dose', 'unique_violation', 'unique_violation', true);
  end;
end$$;

select seq, name, got, expected, ok from dose_check order by seq;

rollback;
