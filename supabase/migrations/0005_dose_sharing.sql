-- 0005_dose_sharing.sql
--
-- Sharing doses with a caregiver (MedRecords Max). A straight port of
-- Pawfolio's sitter sharing (pet-care-planner migrations 0004-0008, and the
-- two fixes Pawfolio's 0003 made to the shared dose functions), applied to
-- MedRecords' dose_schedules / dose_events from 0004_dose_schedules.sql.
--
-- What it adds:
--   * dose_schedules.starts_on, .shared, .missed_rule, .missed_note
--   * dose_events.actor_member, .logged_at, .followup_sent_at, .recorded_late
--   * dose_groups (one caregiver link per owner) and dose_members (each
--     caregiver phone). Caregivers get no table access; every caregiver call
--     goes through the dose-share Edge Function, which checks the link token.
--   * undo_dose (5 min), set_dose_time (30 min), record_missed_dose (24 h),
--     and *_as_member versions callable only by the service role.
--
-- What changes for existing schedules:
--   * dose_next_due respects starts_on (null for every existing row, so no
--     change) and applies the daily window only to "every N hours" schedules.
--   * log_dose: a fixed-time dose taken a little early counts the next dose
--     from the later of the due time and the actual time, so the same clock
--     time is never queued twice.
-- Nothing else about existing rows changes; shared defaults to false.

alter table public.dose_schedules
  add column if not exists starts_on date;

-- Shared dose functions, as Pawfolio runs them today.
CREATE OR REPLACE FUNCTION public.dose_next_due(p_schedule dose_schedules, p_from timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_start      timestamptz;
begin
  -- Course not started yet: schedule from the start of its first day.
  if p_schedule.starts_on is not null then
    v_start := (p_schedule.starts_on::timestamp) at time zone v_tz;
    if p_from < v_start then
      p_from := v_start - interval '1 second';
    end if;
  end if;

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
  -- 'from_last_dose' only. A fixed time is a clock time the user chose and
  -- must be left alone, even if a window is saved on the schedule.
  if p_schedule.anchor = 'from_last_dose' and p_schedule.window_start is not null then
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
end$function$
;

CREATE OR REPLACE FUNCTION public.log_dose(p_event_id uuid, p_taken boolean, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_actor_label text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      -- Fixed times count from whichever is later, the due time or the
      -- actual time: a 6:00 dose given at 5:50 must not queue 6:00 again.
      case
        when p_taken and v_schedule.anchor = 'from_last_dose' then v_at
        when p_taken then greatest(v_at, v_event.due_at)
        else v_event.due_at
      end
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
end$function$
;


-- ===================== from Pawfolio 0004_pawfolio_dose_sharing.sql =====================
-- 0004_dose_sharing.sql
--
-- Sharing doses with a caregiver (MedRecords Max). Builds on 0004_dose_schedules.sql and changes
-- none of its rules or policies.
--
-- Design (shared dose scheduling spec, section 4):
--   * The caregiver never gets table access. Every caregiver call goes through the
--     dose-share Edge Function, which checks a share token and does a
--     short list of things: join, read state, log a dose, leave.
--   * The share secret lives only in the link's #fragment. Only its sha256 is
--     stored, so a leaked row does not grant access.
--   * Sharing is per medication (dose_schedules.shared). A caregiver
--     sees only shared medications: label, the person's name, dose times and dose
--     history. No records, vets, notes or other app data.
--   * One active group per owner: one caregiver link covers every shared
--     medication. Stopping sharing revokes it; a new link is a new group.

-- =====================================================================
-- 1. Groups (one caregiver link) and members (each caregiver phone).
-- =====================================================================
create table if not exists public.dose_groups (
  id          uuid primary key default gen_random_uuid(),
  owner_user  uuid not null references auth.users(id) on delete cascade,
  -- Shown to the caregiver, e.g. "Shauna". Optional.
  owner_label text,
  token_hash  text not null unique,
  -- Slides forward 30 days whenever the link is used.
  expires_at  timestamptz not null default (now() + interval '30 days'),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists dose_groups_one_active
  on public.dose_groups (owner_user) where revoked_at is null;

create or replace function public.dose_groups_set_owner() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.owner_user is null then
    new.owner_user := auth.uid();
  end if;
  return new;
end$$;

drop trigger if exists dose_groups_set_owner on public.dose_groups;
create trigger dose_groups_set_owner
  before insert on public.dose_groups
  for each row execute function public.dose_groups_set_owner();

alter table public.dose_groups enable row level security;

drop policy if exists dose_groups_owner_select on public.dose_groups;
create policy dose_groups_owner_select on public.dose_groups
  for select using (owner_user = auth.uid());
drop policy if exists dose_groups_owner_insert on public.dose_groups;
create policy dose_groups_owner_insert on public.dose_groups
  for insert with check (owner_user is null or owner_user = auth.uid());
drop policy if exists dose_groups_owner_update on public.dose_groups;
create policy dose_groups_owner_update on public.dose_groups
  for update using (owner_user = auth.uid());
drop policy if exists dose_groups_owner_delete on public.dose_groups;
create policy dose_groups_owner_delete on public.dose_groups
  for delete using (owner_user = auth.uid());

create table if not exists public.dose_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.dose_groups(id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 40),
  role        text not null default 'helper' check (role in ('helper')),
  device_id   text not null,
  endpoint    text,
  p256dh      text,
  auth        text,
  timezone    text,
  joined_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  removed_at  timestamptz,
  unique (group_id, device_id)
);

create index if not exists dose_members_group_idx
  on public.dose_members (group_id) where removed_at is null;

alter table public.dose_members enable row level security;

-- The owner can see and remove caregivers. Caregivers themselves have no table
-- access at all; they go through the Edge Function.
drop policy if exists dose_members_owner_select on public.dose_members;
create policy dose_members_owner_select on public.dose_members
  for select using (
    exists (select 1 from public.dose_groups g
            where g.id = dose_members.group_id and g.owner_user = auth.uid())
  );
drop policy if exists dose_members_owner_update on public.dose_members;
create policy dose_members_owner_update on public.dose_members
  for update using (
    exists (select 1 from public.dose_groups g
            where g.id = dose_members.group_id and g.owner_user = auth.uid())
  );

-- =====================================================================
-- 2. Per-medication opt-in, and who logged each dose.
-- =====================================================================
alter table public.dose_schedules
  add column if not exists shared boolean not null default false;

alter table public.dose_events
  add column if not exists actor_member uuid
    references public.dose_members(id) on delete set null;

-- When a dose was given or skipped. Drives the "Given by Dana" follow-up.
alter table public.dose_events
  add column if not exists logged_at timestamptz;

-- When the follow-up push went out (null = not yet, or not shared).
alter table public.dose_events
  add column if not exists followup_sent_at timestamptz;

create index if not exists dose_events_followup_idx
  on public.dose_events (logged_at)
  where followup_sent_at is null and logged_at is not null;

create or replace function public.dose_events_stamp_logged() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'pending' and new.status in ('taken', 'skipped') and new.logged_at is null then
    new.logged_at := now();
  end if;
  return new;
end$$;

drop trigger if exists dose_events_stamp_logged on public.dose_events;
create trigger dose_events_stamp_logged
  before update on public.dose_events
  for each row execute function public.dose_events_stamp_logged();

-- =====================================================================
-- 3. Logging on a caregiver's behalf (Edge Function only).
--
-- Wraps log_dose() so the dose, its attribution and the next dose
-- are recorded in one transaction. Checks that the dose belongs to a SHARED
-- medication of the group's owner, so a caregiver can never log anything else.
-- =====================================================================
create or replace function public.log_dose_as_member(
  p_member_id uuid,
  p_event_id  uuid,
  p_taken     boolean,
  p_force     boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.dose_members;
  v_group  public.dose_groups;
  v_ok     boolean;
  v_res    jsonb;
begin
  select * into v_member from public.dose_members where id = p_member_id;
  if not found or v_member.removed_at is not null then
    raise exception 'not a member' using errcode = 'insufficient_privilege';
  end if;

  select * into v_group from public.dose_groups where id = v_member.group_id;
  if not found or v_group.revoked_at is not null or v_group.expires_at < now() then
    raise exception 'link no longer active' using errcode = 'insufficient_privilege';
  end if;

  select exists (
    select 1 from public.dose_events e
    join public.dose_schedules s on s.id = e.schedule_id
    where e.id = p_event_id and s.user_id = v_group.owner_user and s.shared
  ) into v_ok;
  if not v_ok then
    raise exception 'dose not shared' using errcode = 'insufficient_privilege';
  end if;

  v_res := public.log_dose(p_event_id, p_taken, null, v_member.label, null, p_force);

  if v_res->>'outcome' = 'logged' then
    update public.dose_events set actor_member = v_member.id where id = p_event_id;
  end if;

  return v_res;
end$$;

revoke all on function public.log_dose_as_member(uuid, uuid, boolean, boolean) from public;
revoke all on function public.log_dose_as_member(uuid, uuid, boolean, boolean) from anon, authenticated;
grant execute on function public.log_dose_as_member(uuid, uuid, boolean, boolean) to service_role;

comment on function public.log_dose_as_member(uuid, uuid, boolean, boolean) is
  'Edge Function only: a caregiver records a dose of a shared medication.';

-- ===================== from Pawfolio 0005_pawfolio_dose_undo.sql =====================
-- =====================================================================
-- 0005 — Undo a dose for a few minutes after Given or Skip.
--
-- undo_dose(event)            owner, through RLS (security invoker)
-- undo_dose_as_member(m, e)   caregiver, server only; own doses only
--
-- Undo puts the dose back to pending and removes the next dose that logging
-- queued, so the schedule is exactly as it was before the tap. Allowed for
-- 5 minutes after the dose was recorded (logged_at, stamped in 0004).
-- The worker holds "Given by" follow-ups until that window has passed, so
-- an undone tap never reaches anyone else's phone.
-- =====================================================================

create or replace function public.undo_dose(p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_event public.dose_events;
begin
  select * into v_event
  from public.dose_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'dose event % not found', p_event_id
      using errcode = 'no_data_found';
  end if;

  if v_event.status not in ('taken', 'skipped') then
    return jsonb_build_object('outcome', 'not_undoable', 'event_id', v_event.id, 'status', v_event.status);
  end if;

  if v_event.logged_at is null or v_event.logged_at < now() - interval '5 minutes' then
    return jsonb_build_object('outcome', 'too_late', 'event_id', v_event.id);
  end if;

  -- The next dose queued by this log. Only one pending dose exists per
  -- schedule, so this is it; its reminder rows go with it (on delete cascade).
  delete from public.dose_events
  where schedule_id = v_event.schedule_id
    and status = 'pending'
    and id <> v_event.id;

  update public.dose_events
  set status           = 'pending',
      taken_at         = null,
      actor_label      = null,
      actor_member     = null,
      logged_at        = null,
      followup_sent_at = null
  where id = v_event.id
  returning * into v_event;

  return jsonb_build_object('outcome', 'undone', 'event_id', v_event.id, 'due_at', v_event.due_at);
end$$;

comment on function public.undo_dose(uuid) is
  'Within 5 minutes of Given/Skip, return the dose to pending and drop the next dose it queued.';

create or replace function public.undo_dose_as_member(p_member_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.dose_members;
  v_group  public.dose_groups;
  v_ok     boolean;
begin
  select * into v_member from public.dose_members where id = p_member_id;
  if not found or v_member.removed_at is not null then
    raise exception 'not a member' using errcode = 'insufficient_privilege';
  end if;

  select * into v_group from public.dose_groups where id = v_member.group_id;
  if not found or v_group.revoked_at is not null or v_group.expires_at < now() then
    raise exception 'link no longer active' using errcode = 'insufficient_privilege';
  end if;

  -- A caregiver can undo only a dose they recorded, on a medication still shared.
  select exists (
    select 1 from public.dose_events e
    join public.dose_schedules s on s.id = e.schedule_id
    where e.id = p_event_id and s.user_id = v_group.owner_user and s.shared
      and e.actor_member = v_member.id
  ) into v_ok;
  if not v_ok then
    raise exception 'not your dose' using errcode = 'insufficient_privilege';
  end if;

  return public.undo_dose(p_event_id);
end$$;

revoke all on function public.undo_dose_as_member(uuid, uuid) from public;
revoke all on function public.undo_dose_as_member(uuid, uuid) from anon, authenticated;
grant execute on function public.undo_dose_as_member(uuid, uuid) to service_role;

comment on function public.undo_dose_as_member(uuid, uuid) is
  'Caregiver undo through the dose-share function. Own doses only. Not callable by clients.';

-- ===================== from Pawfolio 0006_pawfolio_dose_missed_rule.sql =====================
-- =====================================================================
-- 0006 — The owner's missed-dose instruction, stored with the schedule so
-- the caregiver page can show it. Text only: nothing here changes amounts or
-- timing. (Rolling "every N hours from the last dose" timing already exists
-- as anchor = 'from_last_dose' in 0003.)
-- =====================================================================

alter table public.dose_schedules
  add column if not exists missed_rule text,
  add column if not exists missed_note text;

alter table public.dose_schedules
  drop constraint if exists dose_schedules_missed_rule;
alter table public.dose_schedules
  add constraint dose_schedules_missed_rule check (
    (missed_rule is null or missed_rule in ('asap', 'skip', 'double', 'note')) and
    (missed_note is null or char_length(missed_note) <= 300)
  );

comment on column public.dose_schedules.missed_rule is
  'Owner instruction if a dose is missed: asap | skip | double | note (see missed_note). Display only.';

-- ===================== from Pawfolio 0007_pawfolio_dose_change_time.sql =====================
-- =====================================================================
-- 0007 — Change the time a dose was given.
--
-- set_dose_time(event, at)            owner, through RLS (security invoker)
-- set_dose_time_as_member(m, e, at)   caregiver, server only; own doses only
--
-- For someone who taps Given late. Allowed only on the latest given dose of a
-- medication, for 30 minutes after it was recorded (logged_at). The new time
-- cannot be in the future, more than 12 hours ago, or at/before the previous
-- given dose. The next dose is worked out again from the corrected time the
-- same way logging does it: rolling ("every N hours") schedules move; set
-- times usually stay put.
-- =====================================================================

create or replace function public.set_dose_time(p_event_id uuid, p_taken_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_event    public.dose_events;
  v_schedule public.dose_schedules;
  v_prev     timestamptz;
  v_pending  public.dose_events;
  v_next     timestamptz;
  v_next_id  uuid;
begin
  select * into v_event
  from public.dose_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'dose event % not found', p_event_id using errcode = 'no_data_found';
  end if;

  if v_event.status <> 'taken' then
    return jsonb_build_object('outcome', 'not_given', 'event_id', v_event.id, 'status', v_event.status);
  end if;

  if v_event.logged_at is null or v_event.logged_at < now() - interval '30 minutes' then
    return jsonb_build_object('outcome', 'too_late', 'event_id', v_event.id);
  end if;

  -- Only the latest recorded dose: once a later one is given or skipped, the
  -- schedule has moved on from this one.
  if exists (
    select 1 from public.dose_events
    where schedule_id = v_event.schedule_id and id <> v_event.id
      and status in ('taken', 'skipped') and due_at > v_event.due_at
  ) then
    return jsonb_build_object('outcome', 'not_latest', 'event_id', v_event.id);
  end if;

  if p_taken_at is null or p_taken_at > now() + interval '2 minutes' then
    return jsonb_build_object('outcome', 'bad_time', 'reason', 'future', 'event_id', v_event.id);
  end if;
  if p_taken_at < now() - interval '12 hours' then
    return jsonb_build_object('outcome', 'bad_time', 'reason', 'too_old', 'event_id', v_event.id);
  end if;

  select max(taken_at) into v_prev
  from public.dose_events
  where schedule_id = v_event.schedule_id and status = 'taken' and id <> v_event.id;
  if v_prev is not null and p_taken_at <= v_prev then
    return jsonb_build_object('outcome', 'bad_time', 'reason', 'before_previous',
                              'previous_taken_at', v_prev, 'event_id', v_event.id);
  end if;

  update public.dose_events
  set taken_at = p_taken_at
  where id = v_event.id
  returning * into v_event;

  -- Work out the next dose again, exactly as log_dose() would have.
  select * into v_schedule from public.dose_schedules where id = v_event.schedule_id;
  select * into v_pending from public.dose_events
  where schedule_id = v_event.schedule_id and status = 'pending'
  for update;

  if v_schedule.enabled then
    v_next := public.dose_next_due(
      v_schedule,
      case when v_schedule.anchor = 'from_last_dose' then p_taken_at
           else greatest(p_taken_at, v_event.due_at) end
    );
  end if;

  if v_pending.id is not null and v_next is not null and v_pending.due_at <> v_next then
    -- Replace rather than move it, so reminders queued for the old time go
    -- with it (on delete cascade) and new ones are made for the new time.
    delete from public.dose_events where id = v_pending.id;
    insert into public.dose_events (schedule_id, due_at)
    values (v_schedule.id, v_next)
    on conflict (schedule_id) where status = 'pending' do nothing
    returning id into v_next_id;
  else
    v_next_id := v_pending.id;
    v_next := coalesce(v_pending.due_at, v_next);
  end if;

  return jsonb_build_object(
    'outcome', 'changed', 'event_id', v_event.id, 'taken_at', v_event.taken_at,
    'next_event_id', v_next_id, 'next_due_at', v_next
  );
end$$;

comment on function public.set_dose_time(uuid, timestamptz) is
  'Within 30 minutes of recording, correct when the latest given dose was given, and re-plan the next dose.';

create or replace function public.set_dose_time_as_member(p_member_id uuid, p_event_id uuid, p_taken_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.dose_members;
  v_group  public.dose_groups;
  v_ok     boolean;
begin
  select * into v_member from public.dose_members where id = p_member_id;
  if not found or v_member.removed_at is not null then
    raise exception 'not a member' using errcode = 'insufficient_privilege';
  end if;

  select * into v_group from public.dose_groups where id = v_member.group_id;
  if not found or v_group.revoked_at is not null or v_group.expires_at < now() then
    raise exception 'link no longer active' using errcode = 'insufficient_privilege';
  end if;

  -- A caregiver can change only a dose they recorded, on a medication still shared.
  select exists (
    select 1 from public.dose_events e
    join public.dose_schedules s on s.id = e.schedule_id
    where e.id = p_event_id and s.user_id = v_group.owner_user and s.shared
      and e.actor_member = v_member.id
  ) into v_ok;
  if not v_ok then
    raise exception 'not your dose' using errcode = 'insufficient_privilege';
  end if;

  return public.set_dose_time(p_event_id, p_taken_at);
end$$;

revoke all on function public.set_dose_time_as_member(uuid, uuid, timestamptz) from public;
revoke all on function public.set_dose_time_as_member(uuid, uuid, timestamptz) from anon, authenticated;
grant execute on function public.set_dose_time_as_member(uuid, uuid, timestamptz) to service_role;

comment on function public.set_dose_time_as_member(uuid, uuid, timestamptz) is
  'Caregiver time correction through the dose-share function. Own doses only. Not callable by clients.';

-- ===================== from Pawfolio 0008_pawfolio_dose_record_missed.sql =====================
-- =====================================================================
-- 0008 — Record a missed dose as given, after the fact.
--
-- record_missed_dose(event, at, label, force)        owner, RLS (security invoker)
-- record_missed_dose_as_member(m, e, at, force)      caregiver, server only
--
-- For someone who gave a dose but forgot to tap Given before the 90-minute
-- grace time ran out, so the dose was marked missed ("wasn't recorded").
-- Allowed only on the latest recorded dose of a medication (nothing given or
-- skipped after it), for 24 hours after it was due. The time given cannot be
-- in the future, more than 24 hours ago, at/before the previous given dose,
-- or more than 90 minutes before the dose was due (the earliest Given opens).
--
-- Once recorded it behaves like any other given dose: Undo for 5 minutes
-- (back to missed, see the new undo below), Change time for 30 minutes, the
-- double-dose check, and a "Given by" notice for shared medications.
-- Rolling ("every N hours") schedules move the next dose to match when the
-- new time still lies ahead; set times stay put.
-- =====================================================================

alter table public.dose_events
  add column if not exists recorded_late boolean not null default false;

comment on column public.dose_events.recorded_late is
  'True when a missed dose was later recorded as given; Undo returns it to missed.';

create or replace function public.record_missed_dose(
  p_event_id    uuid,
  p_taken_at    timestamptz,
  p_actor_label text default null,
  p_force       boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_event    public.dose_events;
  v_schedule public.dose_schedules;
  v_prev     timestamptz;
  v_pending  public.dose_events;
  v_next     timestamptz;
  v_next_id  uuid;
begin
  select * into v_event
  from public.dose_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'dose event % not found', p_event_id using errcode = 'no_data_found';
  end if;

  if v_event.status <> 'missed' then
    return jsonb_build_object('outcome', 'not_missed', 'event_id', v_event.id,
                              'status', v_event.status, 'taken_at', v_event.taken_at);
  end if;

  if v_event.due_at < now() - interval '24 hours' then
    return jsonb_build_object('outcome', 'too_late', 'event_id', v_event.id);
  end if;

  -- Only the latest recorded dose: once a later one is given or skipped, the
  -- schedule has moved on from this one.
  if exists (
    select 1 from public.dose_events
    where schedule_id = v_event.schedule_id and id <> v_event.id
      and status in ('taken', 'skipped', 'missed') and due_at > v_event.due_at
  ) then
    return jsonb_build_object('outcome', 'not_latest', 'event_id', v_event.id);
  end if;

  if p_taken_at is null or p_taken_at > now() + interval '2 minutes' then
    return jsonb_build_object('outcome', 'bad_time', 'reason', 'future', 'event_id', v_event.id);
  end if;
  if p_taken_at < now() - interval '24 hours' then
    return jsonb_build_object('outcome', 'bad_time', 'reason', 'too_old', 'event_id', v_event.id);
  end if;
  if p_taken_at < v_event.due_at - interval '90 minutes' then
    return jsonb_build_object('outcome', 'bad_time', 'reason', 'before_due', 'due_at', v_event.due_at, 'event_id', v_event.id);
  end if;

  select * into v_schedule from public.dose_schedules where id = v_event.schedule_id;

  select max(taken_at) into v_prev
  from public.dose_events
  where schedule_id = v_event.schedule_id and status = 'taken' and id <> v_event.id;
  if v_prev is not null and p_taken_at <= v_prev then
    return jsonb_build_object('outcome', 'bad_time', 'reason', 'before_previous',
                              'previous_taken_at', v_prev, 'event_id', v_event.id);
  end if;
  -- Same double-dose check as logging, overridable once the user has seen it.
  if not p_force and v_prev is not null
     and p_taken_at - v_prev < make_interval(mins => greatest(v_schedule.interval_min / 2, 1)) then
    return jsonb_build_object('outcome', 'too_soon', 'event_id', v_event.id, 'last_taken_at', v_prev,
                              'minutes_ago', floor(extract(epoch from (p_taken_at - v_prev)) / 60)::int);
  end if;

  update public.dose_events
  set status           = 'taken',
      taken_at         = p_taken_at,
      logged_at        = now(),
      recorded_late    = true,
      actor_label      = coalesce(p_actor_label, actor_label),
      followup_sent_at = null
  where id = v_event.id and status = 'missed'
  returning * into v_event;

  if not found then
    select * into v_event from public.dose_events where id = p_event_id;
    return jsonb_build_object('outcome', 'not_missed', 'event_id', v_event.id,
                              'status', v_event.status, 'taken_at', v_event.taken_at);
  end if;

  -- Rolling schedules count the next dose from the real time it was given,
  -- as long as that is still ahead. Set times are left alone.
  select * into v_pending from public.dose_events
  where schedule_id = v_event.schedule_id and status = 'pending'
  for update;

  if v_schedule.enabled and v_schedule.anchor = 'from_last_dose' then
    v_next := public.dose_next_due(v_schedule, p_taken_at);
  end if;

  if v_pending.id is not null and v_next is not null and v_next > now() and v_pending.due_at <> v_next then
    delete from public.dose_events where id = v_pending.id;
    insert into public.dose_events (schedule_id, due_at)
    values (v_schedule.id, v_next)
    on conflict (schedule_id) where status = 'pending' do nothing
    returning id into v_next_id;
  else
    v_next_id := v_pending.id;
    v_next := v_pending.due_at;
  end if;

  return jsonb_build_object(
    'outcome', 'recorded', 'event_id', v_event.id, 'status', v_event.status, 'taken_at', v_event.taken_at,
    'next_event_id', v_next_id, 'next_due_at', v_next
  );
end$$;

comment on function public.record_missed_dose(uuid, timestamptz, text, boolean) is
  'Within 24 hours, record the latest missed dose as given at the time it was actually given.';

create or replace function public.record_missed_dose_as_member(
  p_member_id uuid,
  p_event_id  uuid,
  p_taken_at  timestamptz,
  p_force     boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.dose_members;
  v_group  public.dose_groups;
  v_ok     boolean;
  v_res    jsonb;
begin
  select * into v_member from public.dose_members where id = p_member_id;
  if not found or v_member.removed_at is not null then
    raise exception 'not a member' using errcode = 'insufficient_privilege';
  end if;

  select * into v_group from public.dose_groups where id = v_member.group_id;
  if not found or v_group.revoked_at is not null or v_group.expires_at < now() then
    raise exception 'link no longer active' using errcode = 'insufficient_privilege';
  end if;

  -- A missed dose belongs to nobody yet, so any caregiver on a shared medication may record it.
  select exists (
    select 1 from public.dose_events e
    join public.dose_schedules s on s.id = e.schedule_id
    where e.id = p_event_id and s.user_id = v_group.owner_user and s.shared
  ) into v_ok;
  if not v_ok then
    raise exception 'dose not shared' using errcode = 'insufficient_privilege';
  end if;

  v_res := public.record_missed_dose(p_event_id, p_taken_at, v_member.label, p_force);

  if v_res->>'outcome' = 'recorded' then
    update public.dose_events set actor_member = v_member.id where id = p_event_id;
  end if;

  return v_res;
end$$;

revoke all on function public.record_missed_dose_as_member(uuid, uuid, timestamptz, boolean) from public;
revoke all on function public.record_missed_dose_as_member(uuid, uuid, timestamptz, boolean) from anon, authenticated;
grant execute on function public.record_missed_dose_as_member(uuid, uuid, timestamptz, boolean) to service_role;

comment on function public.record_missed_dose_as_member(uuid, uuid, timestamptz, boolean) is
  'Caregiver late recording through the dose-share function. Not callable by clients.';

-- ---------------------------------------------------------------------
-- Undo: a late-recorded dose goes back to missed (not pending, which the
-- sweep would only mark missed again), and the next dose stays queued.
-- Otherwise unchanged from 0005.
-- ---------------------------------------------------------------------
create or replace function public.undo_dose(p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_event public.dose_events;
begin
  select * into v_event
  from public.dose_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'dose event % not found', p_event_id
      using errcode = 'no_data_found';
  end if;

  if v_event.status not in ('taken', 'skipped') then
    return jsonb_build_object('outcome', 'not_undoable', 'event_id', v_event.id, 'status', v_event.status);
  end if;

  if v_event.logged_at is null or v_event.logged_at < now() - interval '5 minutes' then
    return jsonb_build_object('outcome', 'too_late', 'event_id', v_event.id);
  end if;

  if v_event.recorded_late then
    update public.dose_events
    set status           = 'missed',
        taken_at         = null,
        actor_label      = null,
        actor_member     = null,
        logged_at        = null,
        followup_sent_at = null,
        recorded_late    = false
    where id = v_event.id
    returning * into v_event;
    return jsonb_build_object('outcome', 'undone', 'event_id', v_event.id, 'due_at', v_event.due_at);
  end if;

  -- The next dose queued by this log. Only one pending dose exists per
  -- schedule, so this is it; its reminder rows go with it (on delete cascade).
  delete from public.dose_events
  where schedule_id = v_event.schedule_id
    and status = 'pending'
    and id <> v_event.id;

  update public.dose_events
  set status           = 'pending',
      taken_at         = null,
      actor_label      = null,
      actor_member     = null,
      logged_at        = null,
      followup_sent_at = null
  where id = v_event.id
  returning * into v_event;

  return jsonb_build_object('outcome', 'undone', 'event_id', v_event.id, 'due_at', v_event.due_at);
end$$;

comment on function public.undo_dose(uuid) is
  'Within 5 minutes of Given/Skip, return the dose to pending (or to missed, if it was recorded late) and drop the next dose it queued.';
