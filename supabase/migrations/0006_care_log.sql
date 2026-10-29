-- 0006_care_log.sql
--
-- MedRecords Care: caregivers log care (meals, therapy, how the person is
-- doing, awareness, personal care) from the same caregiver link used for
-- doses (dose_groups / dose_members from 0005).
--
-- What it adds:
--   * care_people   one row per family member the owner shares the care log
--                   for: first name, condition labels (empty when the owner
--                   keeps conditions private) and an on/off switch.
--   * care_entries  each entry a caregiver logs, with who logged it.
--
-- Access, same model as doses:
--   * The owner reads and writes care_people and reads care_entries under RLS.
--   * Caregivers get no table access. Every caregiver call goes through the
--     care-share Edge Function, which checks the link token and the member.
--   * Every caregiver on the link sees every caregiver's entries for the
--     people shared with them (a shift handoff), never anything else.
--
-- Nothing existing is changed.

-- =====================================================================
-- 1. People whose care log is shared
-- =====================================================================
create table if not exists public.care_people (
  id          uuid primary key default gen_random_uuid(),
  owner_user  uuid not null references auth.users(id) on delete cascade,
  -- The person's id in the owner's local app (Dexie patients.id).
  local_id    integer not null,
  name        text not null check (char_length(name) between 1 and 40),
  conditions  text[] not null default '{}',
  shared      boolean not null default false,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (owner_user, local_id),
  check (coalesce(array_length(conditions, 1), 0) <= 20)
);

create or replace function public.care_people_set_owner() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.owner_user is null then
    new.owner_user := auth.uid();
  end if;
  return new;
end$$;

drop trigger if exists care_people_set_owner on public.care_people;
create trigger care_people_set_owner
  before insert on public.care_people
  for each row execute function public.care_people_set_owner();

alter table public.care_people enable row level security;

drop policy if exists care_people_owner_select on public.care_people;
create policy care_people_owner_select on public.care_people
  for select using (owner_user = auth.uid());
drop policy if exists care_people_owner_insert on public.care_people;
create policy care_people_owner_insert on public.care_people
  for insert with check (owner_user is null or owner_user = auth.uid());
drop policy if exists care_people_owner_update on public.care_people;
create policy care_people_owner_update on public.care_people
  for update using (owner_user = auth.uid()) with check (owner_user = auth.uid());
drop policy if exists care_people_owner_delete on public.care_people;
create policy care_people_owner_delete on public.care_people
  for delete using (owner_user = auth.uid());

-- =====================================================================
-- 2. Care entries logged by caregivers
-- =====================================================================
create table if not exists public.care_entries (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.care_people(id) on delete cascade,
  owner_user   uuid not null references auth.users(id) on delete cascade,
  member_id    uuid references public.dose_members(id) on delete set null,
  actor_label  text check (actor_label is null or char_length(actor_label) <= 40),
  at           timestamptz not null,
  kind         text not null check (kind in ('meal', 'therapy', 'mood', 'awareness', 'personal')),
  status       text not null default 'done' check (status in ('done', 'partial', 'declined')),
  meal         text check (meal is null or meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  amount       text check (amount is null or amount in ('all', 'most', 'some', 'little')),
  therapy      text check (therapy is null or therapy in ('PT', 'OT')),
  minutes      integer check (minutes is null or minutes between 1 and 600),
  task         text check (task is null or task in ('bathing', 'dressing', 'toileting', 'grooming')),
  help         text check (help is null or help in ('none', 'some', 'full')),
  score        integer check (score is null or score between 1 and 10),
  level        text check (level is null or level in ('alert', 'quiet', 'confused-sometimes', 'very-confused', 'drowsy', 'unable')),
  reason       text check (reason is null or reason in ('tired', 'pain', 'asleep', 'refused', 'sick', 'not-hungry')),
  details      text check (details is null or char_length(details) <= 300),
  note         text check (note is null or char_length(note) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- A caregiver can remove their own entry for 30 minutes; it is kept as a
  -- tombstone so the owner's phone never copies it.
  deleted_at   timestamptz
);

create index if not exists care_entries_person_at_idx
  on public.care_entries (person_id, at desc) where deleted_at is null;
create index if not exists care_entries_owner_created_idx
  on public.care_entries (owner_user, created_at desc);

alter table public.care_entries enable row level security;

-- The owner reads entries (to show and copy them). Writes come only from the
-- care-share Edge Function, which uses the service role.
drop policy if exists care_entries_owner_select on public.care_entries;
create policy care_entries_owner_select on public.care_entries
  for select using (owner_user = auth.uid());

comment on table public.care_people is
  'MedRecords Care: family members whose care log the owner shares through the caregiver link.';
comment on table public.care_entries is
  'MedRecords Care: entries caregivers log. Written only by the care-share Edge Function.';
