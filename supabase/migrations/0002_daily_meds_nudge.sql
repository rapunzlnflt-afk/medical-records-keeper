-- Daily "Log today's meds?" nudge.
--
-- One optional, opt-in, general daily reminder per device. It carries no
-- medication names, no patient name, and no clinical detail — only the fixed
-- strings "MedRecords" / "Log today's meds?".
--
-- Design notes:
--   * Recurrence lives SERVER-SIDE. This table stores a daily *rule*
--     (enabled + local time-of-day), never pregenerated occurrences. The
--     Edge Function materialises one `reminders` row per local day, so the
--     schedule can never silently run out when the user stops opening the app.
--   * Timezone is NOT duplicated here. `devices.timezone` is the single source
--     of truth and is refreshed by the client whenever settings are saved.
--   * Idempotency per (device, local date) is enforced by a unique index on
--     `reminders`, using `source_id` as the local date in YYYYMMDD form.
--
-- Deliberately does NOT touch `user_reminder_settings` / `user_reminders`,
-- which are an abandoned earlier design.

-- =====================================================================
-- 1. Allow the new reminder source.
-- =====================================================================
alter table public.reminders
  drop constraint if exists reminders_source_check;

alter table public.reminders
  add constraint reminders_source_check
  check (source in ('appointment', 'medication', 'daily_meds'));

-- Exactly one daily nudge per device per local calendar day. `source_id`
-- holds the local date as an integer (e.g. 2026-08-14 -> 20260814), so a
-- cron running every minute can insert blindly and rely on the conflict.
create unique index if not exists reminders_daily_meds_once_per_day
  on public.reminders (device_id, source_id)
  where source = 'daily_meds';

-- =====================================================================
-- 2. daily_nudges: the per-device daily rule.
-- =====================================================================
create table if not exists public.daily_nudges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_id   text not null,
  enabled     boolean not null default false,
  -- Local wall-clock time in 24h HH:MM. Default 8:00 PM local.
  local_time  text not null default '20:00',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, device_id),
  constraint daily_nudges_local_time_format
    check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Turning off phone reminders deletes the device row; the rule must go with
  -- it so delivery stops server-side rather than only being hidden in the UI.
  constraint daily_nudges_device_fk
    foreign key (user_id, device_id)
    references public.devices (user_id, device_id)
    on delete cascade
);

create index if not exists daily_nudges_enabled_idx
  on public.daily_nudges (enabled)
  where enabled = true;

drop trigger if exists daily_nudges_set_updated_at on public.daily_nudges;
create trigger daily_nudges_set_updated_at
  before update on public.daily_nudges
  for each row execute function public.set_updated_at();

create or replace function public.daily_nudges_set_user_id() returns trigger
language plpgsql as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end$$;

drop trigger if exists daily_nudges_set_user_id on public.daily_nudges;
create trigger daily_nudges_set_user_id
  before insert on public.daily_nudges
  for each row execute function public.daily_nudges_set_user_id();

alter table public.daily_nudges enable row level security;

drop policy if exists daily_nudges_owner_select on public.daily_nudges;
create policy daily_nudges_owner_select on public.daily_nudges
  for select using (user_id = auth.uid());
drop policy if exists daily_nudges_owner_insert on public.daily_nudges;
create policy daily_nudges_owner_insert on public.daily_nudges
  for insert with check (user_id is null or user_id = auth.uid());
drop policy if exists daily_nudges_owner_update on public.daily_nudges;
create policy daily_nudges_owner_update on public.daily_nudges
  for update using (user_id = auth.uid());
drop policy if exists daily_nudges_owner_delete on public.daily_nudges;
create policy daily_nudges_owner_delete on public.daily_nudges
  for delete using (user_id = auth.uid());

-- The Edge Function uses the service-role key and bypasses RLS.
