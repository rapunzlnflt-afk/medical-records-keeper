-- 0004_dose_schedules.sql
--
-- Actual-time dose scheduling (solo / single-device. Sharing arrives in a
-- later migration and deliberately changes nothing here).
--
-- The problem this solves
-- ---------------------------------------------------------------------------
-- Today a medication reminder is a fixed clock time. That is correct for a
-- once-daily or twice-daily medication, and wrong for anything taken "every N
-- hours", where the next dose depends on when the last one was actually given.
--
-- Design notes
-- ---------------------------------------------------------------------------
--   * Recurrence lives SERVER-SIDE, same as `daily_nudges`. `dose_schedules`
--     stores a rule; `dose_events` holds occurrences. The schedule can never
--     silently run out because the user stopped opening the app.
--   * A schedule has AT MOST ONE open (pending) event, enforced by a partial
--     unique index. That single invariant is what makes relative scheduling
--     safe: a phone that is off for two days cannot accumulate a backlog of
--     stale doses to fire all at once.
--   * Logging a dose and scheduling the next one happen in ONE transaction,
--     inside `public.log_dose()`. The update is conditional on the event still
--     being pending, so two callers can never both log the same dose. Solo
--     users rarely hit that; it is the foundation the shared version needs.
--   * Unlike `daily_nudges`, a schedule carries its own `timezone`. A nudge is
--     a per-device rule and cascades away with the device row; a dose schedule
--     belongs to a medication and must outlive any single phone, so it cannot
--     depend on `devices.timezone` still existing.
--   * No clinical detail is added to the push path beyond what the user opts
--     into per schedule: a label, an optional first name, and dose times.

-- =====================================================================
-- 1. dose_schedules — the rule.
-- =====================================================================
create table if not exists public.dose_schedules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,

  -- The originating local medication record id (same meaning as
  -- reminders.source_id). Not a foreign key: the medication itself lives in
  -- the browser, not here.
  source_id      integer not null,

  -- Shown in the notification. The user chooses this, so it can be as vague
  -- as "Morning pill" or as specific as a drug name.
  label          text not null,
  subject_name   text,

  interval_min   integer not null check (interval_min between 15 and 10080),

  -- 'fixed'          : next dose at the next entry in fixed_times (today's
  --                    behaviour; clock-anchored, never drifts).
  -- 'from_last_dose' : next dose at actual taken time + interval_min.
  anchor         text not null default 'fixed'
                 check (anchor in ('fixed', 'from_last_dose')),

  -- anchor='fixed': local wall-clock times, 'HH:MM', ascending.
  fixed_times    text[],

  -- anchor='from_last_dose': the daily window doses are allowed to fall in.
  -- Without this a 4-hour medication taken slightly late every time walks
  -- steadily later and eventually schedules a dose at 2am.
  window_start   text,
  window_end     text,

  -- Hard ceiling on doses per local day. Second line of defence against
  -- drift, and a genuine safety limit.
  max_per_day    integer check (max_per_day is null or max_per_day between 1 and 24),

  -- A pending dose older than due_at + grace_min is recorded as missed, and
  -- the following dose is scheduled from the RULE rather than from the stale
  -- due time.
  grace_min      integer not null default 90 check (grace_min between 5 and 1440),

  ends_on        date,
  enabled        boolean not null default true,

  -- IANA zone, captured from the device when the schedule is created.
  timezone       text not null default 'UTC',

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (user_id, source_id),

  constraint dose_schedules_time_format check (
    (window_start is null or window_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and
    (window_end   is null or window_end   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  ),

  -- Both or neither.
  constraint dose_schedules_window_pair check (
    (window_start is null) = (window_end is null)
  ),

  -- v1 does not support a window that crosses midnight. Allowing it doubles
  -- the number of cases in dose_next_due() for no known use: an every-N-hours
  -- medication with an overnight-only window is not a real prescription.
  constraint dose_schedules_window_order check (
    window_start is null or window_start < window_end
  ),

  -- anchor='fixed' is meaningless without times to anchor to.
  constraint dose_schedules_fixed_needs_times check (
    anchor <> 'fixed' or (fixed_times is not null and array_length(fixed_times, 1) >= 1)
  )
);

create index if not exists dose_schedules_user_idx
  on public.dose_schedules (user_id);
create index if not exists dose_schedules_enabled_idx
  on public.dose_schedules (enabled) where enabled = true;

drop trigger if exists dose_schedules_set_updated_at on public.dose_schedules;
create trigger dose_schedules_set_updated_at
  before update on public.dose_schedules
  for each row execute function public.set_updated_at();

create or replace function public.dose_schedules_set_user_id() returns trigger
language plpgsql as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end$$;

drop trigger if exists dose_schedules_set_user_id on public.dose_schedules;
create trigger dose_schedules_set_user_id
  before insert on public.dose_schedules
  for each row execute function public.dose_schedules_set_user_id();

alter table public.dose_schedules enable row level security;

drop policy if exists dose_schedules_owner_select on public.dose_schedules;
create policy dose_schedules_owner_select on public.dose_schedules
  for select using (user_id = auth.uid());
drop policy if exists dose_schedules_owner_insert on public.dose_schedules;
create policy dose_schedules_owner_insert on public.dose_schedules
  for insert with check (user_id is null or user_id = auth.uid());
drop policy if exists dose_schedules_owner_update on public.dose_schedules;
create policy dose_schedules_owner_update on public.dose_schedules
  for update using (user_id = auth.uid());
drop policy if exists dose_schedules_owner_delete on public.dose_schedules;
create policy dose_schedules_owner_delete on public.dose_schedules
  for delete using (user_id = auth.uid());

-- =====================================================================
-- 2. dose_events — the occurrences.
-- =====================================================================
create table if not exists public.dose_events (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references public.dose_schedules(id) on delete cascade,

  due_at       timestamptz not null,
  taken_at     timestamptz,

  -- pending : queued, not yet logged
  -- taken   : the user recorded the dose
  -- skipped : the user explicitly skipped it
  -- missed   : nobody logged it inside grace_min (system-recorded, and kept
  --            visually distinct from a deliberate skip in the UI)
  status       text not null default 'pending'
               check (status in ('pending', 'taken', 'skipped', 'missed')),

  -- Free-text attribution, unused while solo; the shared version fills it in.
  actor_label  text,
  note         text,

  -- When this event was turned into a `reminders` row (i.e. queued for push),
  -- not when the push was delivered. `reminders.delivered_at` remains the
  -- record of actual delivery.
  notified_at  timestamptz,

  created_at   timestamptz not null default now(),

  constraint dose_events_taken_at_requires_status check (
    (status = 'taken') = (taken_at is not null)
  )
);

-- THE invariant: at most one open dose per schedule.
create unique index if not exists dose_events_one_open
  on public.dose_events (schedule_id) where status = 'pending';

create index if not exists dose_events_due_idx
  on public.dose_events (due_at)
  where status = 'pending' and notified_at is null;

create index if not exists dose_events_schedule_idx
  on public.dose_events (schedule_id, due_at desc);

alter table public.dose_events enable row level security;

-- dose_events has no user_id of its own; ownership is inherited from the
-- parent schedule. Keeping one owner column avoids the two rows ever
-- disagreeing about who owns the dose.
drop policy if exists dose_events_owner_select on public.dose_events;
create policy dose_events_owner_select on public.dose_events
  for select using (
    exists (
      select 1 from public.dose_schedules s
      where s.id = dose_events.schedule_id and s.user_id = auth.uid()
    )
  );
drop policy if exists dose_events_owner_insert on public.dose_events;
create policy dose_events_owner_insert on public.dose_events
  for insert with check (
    exists (
      select 1 from public.dose_schedules s
      where s.id = dose_events.schedule_id and s.user_id = auth.uid()
    )
  );
drop policy if exists dose_events_owner_update on public.dose_events;
create policy dose_events_owner_update on public.dose_events
  for update using (
    exists (
      select 1 from public.dose_schedules s
      where s.id = dose_events.schedule_id and s.user_id = auth.uid()
    )
  );
drop policy if exists dose_events_owner_delete on public.dose_events;
create policy dose_events_owner_delete on public.dose_events
  for delete using (
    exists (
      select 1 from public.dose_schedules s
      where s.id = dose_events.schedule_id and s.user_id = auth.uid()
    )
  );

-- =====================================================================
-- 3. reminders gains a 'dose' source.
--
-- Dose pushes reuse the existing delivery worker rather than adding a second
-- one. A third pg_cron job would reintroduce the worker-slot contention that
-- made pushes silently vanish (see 0003).
-- =====================================================================
alter table public.reminders
  drop constraint if exists reminders_source_check;

alter table public.reminders
  add constraint reminders_source_check
  check (source in ('appointment', 'medication', 'daily_meds', 'dose'));

-- `reminders.source_id` is an integer and holds the medication record id, so
-- it cannot identify a dose event (uuid). This column does, and its unique
-- index makes queueing idempotent: the worker inserts blindly every tick and
-- relies on the conflict, exactly as the daily nudge does.
alter table public.reminders
  add column if not exists dose_event_id uuid
  references public.dose_events(id) on delete cascade;

create unique index if not exists reminders_dose_event_once
  on public.reminders (dose_event_id)
  where source = 'dose';

-- =====================================================================
-- 4. dose_next_due() — the scheduling rule, including guardrails.
--
-- Returns the next due instant, or NULL when the schedule has run out
-- (past ends_on). Pure: reads dose_events only to apply max_per_day.
-- =====================================================================
create or replace function public.dose_next_due(
  p_schedule public.dose_schedules,
  p_from     timestamptz
) returns timestamptz
language plpgsql
stable
as $$
declare
  v_tz         text := coalesce(nullif(p_schedule.timezone, ''), 'UTC');
  v_candidate  timestamptz;
  v_local_date date;
  v_local_time time;
  v_time       text;
  v_day_offset int;
  v_try        timestamptz;
  v_reset_time time;
  v_taken      int;
begin
  if p_schedule.anchor = 'from_last_dose' then
    v_candidate := p_from + make_interval(mins => p_schedule.interval_min);
  else
    -- 'fixed': the next configured wall-clock time strictly after p_from.
    -- Looks at today and tomorrow in local terms, so it is correct across a
    -- DST boundary (each candidate is converted individually).
    v_local_date := (p_from at time zone v_tz)::date;
    for v_day_offset in 0..1 loop
      foreach v_time in array p_schedule.fixed_times loop
        v_try := ((v_local_date + v_day_offset) + v_time::time) at time zone v_tz;
        if v_try > p_from and (v_candidate is null or v_try < v_candidate) then
          v_candidate := v_try;
        end if;
      end loop;
      exit when v_candidate is not null;
    end loop;
    if v_candidate is null then
      return null;
    end if;
  end if;

  -- ---------------------------------------------------------------
  -- Guardrail 1: daily window.
  -- ---------------------------------------------------------------
  if p_schedule.window_start is not null then
    v_local_date := (v_candidate at time zone v_tz)::date;
    v_local_time := (v_candidate at time zone v_tz)::time;

    if v_local_time < p_schedule.window_start::time then
      -- Too early in the day: wait for the window to open.
      v_candidate := (v_local_date + p_schedule.window_start::time) at time zone v_tz;
    elsif v_local_time > p_schedule.window_end::time then
      -- Past the end of the day's window: first dose of tomorrow instead.
      -- This is the reset that stops drift accumulating.
      v_candidate := ((v_local_date + 1) + p_schedule.window_start::time) at time zone v_tz;
    end if;
  end if;

  -- ---------------------------------------------------------------
  -- Guardrail 2: max doses per local day.
  -- ---------------------------------------------------------------
  if p_schedule.max_per_day is not null then
    v_local_date := (v_candidate at time zone v_tz)::date;

    select count(*) into v_taken
    from public.dose_events e
    where e.schedule_id = p_schedule.id
      and e.status in ('taken', 'skipped')
      and (coalesce(e.taken_at, e.due_at) at time zone v_tz)::date = v_local_date;

    if v_taken >= p_schedule.max_per_day then
      -- The day is full. Resume at the start of the next day's window, or at
      -- the same clock time if this schedule has no window.
      v_reset_time := coalesce(
        p_schedule.window_start::time,
        (p_schedule.fixed_times)[1]::time,
        (v_candidate at time zone v_tz)::time
      );
      v_candidate := ((v_local_date + 1) + v_reset_time) at time zone v_tz;
    end if;
  end if;

  -- ---------------------------------------------------------------
  -- Guardrail 3: end date.
  -- ---------------------------------------------------------------
  if p_schedule.ends_on is not null
     and (v_candidate at time zone v_tz)::date > p_schedule.ends_on then
    return null;
  end if;

  return v_candidate;
end$$;

comment on function public.dose_next_due(public.dose_schedules, timestamptz) is
  'Next due instant for a dose schedule, applying window, per-day cap and end date. NULL when the schedule has finished.';

-- =====================================================================
-- 5. log_dose() — record a dose and schedule the next one, atomically.
--
-- Returns jsonb with an `outcome`:
--   'logged'        — recorded; `next_due_at` may be null if the course ended
--   'already_logged'— someone (or another tab) got there first; includes who
--                     and when, so the caller can show it rather than error
--   'too_soon'      — a dose was logged very recently; re-call with
--                     p_force => true to override
--
-- security invoker: RLS decides what the caller may touch, so this function
-- grants no access of its own.
-- =====================================================================
create or replace function public.log_dose(
  p_event_id    uuid,
  p_taken       boolean,
  p_at          timestamptz default null,
  p_actor_label text default null,
  p_note        text default null,
  p_force       boolean default false
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_event    public.dose_events;
  v_schedule public.dose_schedules;
  v_at       timestamptz := coalesce(p_at, now());
  v_last     timestamptz;
  v_next     timestamptz;
  v_next_id  uuid;
begin
  -- Row lock so a double-tap cannot interleave between the read and the write.
  select * into v_event
  from public.dose_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'dose event % not found', p_event_id
      using errcode = 'no_data_found';
  end if;

  select * into v_schedule
  from public.dose_schedules
  where id = v_event.schedule_id;

  if not found then
    raise exception 'dose schedule for event % not found', p_event_id
      using errcode = 'no_data_found';
  end if;

  -- Already resolved. Not an error: the caller shows "already given at ...".
  if v_event.status <> 'pending' then
    return jsonb_build_object(
      'outcome',     'already_logged',
      'event_id',    v_event.id,
      'status',      v_event.status,
      'taken_at',    v_event.taken_at,
      'actor_label', v_event.actor_label
    );
  end if;

  -- A manual time may be corrected backwards but not invented. Small future
  -- slack absorbs clock skew between phone and server.
  if v_at > now() + interval '2 minutes' then
    raise exception 'dose time cannot be in the future'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_at < now() - interval '12 hours' then
    raise exception 'dose time is more than 12 hours ago'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Double-dose guard: only for an actual dose, and overridable after the
  -- caller has shown the user when the previous one was given.
  if p_taken and not p_force then
    select max(taken_at) into v_last
    from public.dose_events
    where schedule_id = v_event.schedule_id and status = 'taken';

    if v_last is not null
       and v_at - v_last < make_interval(mins => greatest(v_schedule.interval_min / 2, 1)) then
      return jsonb_build_object(
        'outcome',        'too_soon',
        'event_id',       v_event.id,
        'last_taken_at',  v_last,
        'minutes_ago',    floor(extract(epoch from (v_at - v_last)) / 60)::int
      );
    end if;
  end if;

  update public.dose_events
  set status      = case when p_taken then 'taken' else 'skipped' end,
      taken_at    = case when p_taken then v_at else null end,
      actor_label = coalesce(p_actor_label, actor_label),
      note        = coalesce(p_note, note)
  where id = v_event.id and status = 'pending'
  returning * into v_event;

  if not found then
    -- Lost the race despite the lock (another transaction committed first).
    select * into v_event from public.dose_events where id = p_event_id;
    return jsonb_build_object(
      'outcome',     'already_logged',
      'event_id',    v_event.id,
      'status',      v_event.status,
      'taken_at',    v_event.taken_at,
      'actor_label', v_event.actor_label
    );
  end if;

  -- Schedule the next dose. A taken dose anchors the next one to the ACTUAL
  -- time; a skip anchors to the original due time, so skipping does not
  -- stretch the day's spacing.
  if v_schedule.enabled then
    v_next := public.dose_next_due(
      v_schedule,
      case when p_taken then v_at else v_event.due_at end
    );

    if v_next is not null then
      insert into public.dose_events (schedule_id, due_at)
      values (v_schedule.id, v_next)
      on conflict (schedule_id) where status = 'pending'
      do nothing
      returning id into v_next_id;
    end if;
  end if;

  return jsonb_build_object(
    'outcome',       'logged',
    'event_id',      v_event.id,
    'status',        v_event.status,
    'taken_at',      v_event.taken_at,
    'next_event_id', v_next_id,
    'next_due_at',   v_next
  );
end$$;

comment on function public.log_dose(uuid, boolean, timestamptz, text, text, boolean) is
  'Record a dose as taken or skipped and queue the next one in the same transaction.';

-- =====================================================================
-- 6. dose_sweep() — retire overdue doses and keep schedules moving.
--
-- Called by the delivery worker each tick. Two jobs:
--   a. mark pending events past due_at + grace_min as 'missed'
--   b. queue the next dose for any enabled schedule that has no pending
--      event (after a miss, or after a schedule is first enabled)
--
-- security definer because the worker runs as service_role and there is no
-- auth.uid() in that context. Execute is revoked from client roles: this
-- function walks every user's rows and must never be callable from the app.
-- =====================================================================
create or replace function public.dose_sweep(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_missed   int := 0;
  v_queued   int := 0;
  v_finished int := 0;
  v_schedule public.dose_schedules;
  v_next     timestamptz;
begin
  with overdue as (
    select e.id
    from public.dose_events e
    join public.dose_schedules s on s.id = e.schedule_id
    where e.status = 'pending'
      and now() > e.due_at + make_interval(mins => s.grace_min)
    limit p_limit
  )
  update public.dose_events e
  set status = 'missed'
  from overdue o
  where e.id = o.id;
  get diagnostics v_missed = row_count;

  -- Every enabled, unfinished schedule should have exactly one pending dose.
  for v_schedule in
    select s.*
    from public.dose_schedules s
    where s.enabled
      and (s.ends_on is null or s.ends_on >= (now() at time zone coalesce(nullif(s.timezone, ''), 'UTC'))::date)
      and not exists (
        select 1 from public.dose_events e
        where e.schedule_id = s.id and e.status = 'pending'
      )
    limit p_limit
  loop
    v_next := public.dose_next_due(v_schedule, now());

    if v_next is null then
      update public.dose_schedules set enabled = false where id = v_schedule.id;
      v_finished := v_finished + 1;
      continue;
    end if;

    insert into public.dose_events (schedule_id, due_at)
    values (v_schedule.id, v_next)
    on conflict (schedule_id) where status = 'pending'
    do nothing;

    v_queued := v_queued + 1;
  end loop;

  return jsonb_build_object('missed', v_missed, 'queued', v_queued, 'finished', v_finished);
end$$;

revoke all on function public.dose_sweep(integer) from public;
revoke all on function public.dose_sweep(integer) from anon, authenticated;

comment on function public.dose_sweep(integer) is
  'Worker-only: retire overdue doses and ensure every enabled schedule has one pending dose.';
