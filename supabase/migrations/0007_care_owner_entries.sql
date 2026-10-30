-- 0007_care_owner_entries.sql
--
-- MedRecords Care: the owner can choose to show caregivers the entries she
-- logs herself. Off by default, per person.
--
--   * care_people.share_owner_entries  the switch (default false).
--   * care_entries.owner_local_id      set on copies of the owner's own
--                                      entries (her local Care Log id); null
--                                      on everything caregivers log.
--
-- The owner's phone keeps the last two days of her entries in step (add,
-- edit, delete) and removes every copy when she turns the switch off. The
-- care-share function also hides them whenever the switch is off.
--
-- Owners may write only their own copies (member_id null, owner_local_id
-- set, on a person they own). Caregiver entries stay function-only.

alter table public.care_people
  add column if not exists share_owner_entries boolean not null default false;

alter table public.care_entries
  add column if not exists owner_local_id integer;

-- One server copy per owner entry. Caregiver rows have null here and never collide.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'care_entries_owner_local_uniq') then
    alter table public.care_entries
      add constraint care_entries_owner_local_uniq unique (person_id, owner_local_id);
  end if;
end$$;

drop policy if exists care_entries_owner_insert on public.care_entries;
create policy care_entries_owner_insert on public.care_entries
  for insert with check (
    owner_user = auth.uid()
    and member_id is null
    and owner_local_id is not null
    and exists (select 1 from public.care_people p where p.id = person_id and p.owner_user = auth.uid())
  );

drop policy if exists care_entries_owner_update on public.care_entries;
create policy care_entries_owner_update on public.care_entries
  for update
  using (owner_user = auth.uid() and owner_local_id is not null)
  with check (
    owner_user = auth.uid()
    and member_id is null
    and owner_local_id is not null
    and exists (select 1 from public.care_people p where p.id = person_id and p.owner_user = auth.uid())
  );

drop policy if exists care_entries_owner_delete on public.care_entries;
create policy care_entries_owner_delete on public.care_entries
  for delete using (owner_user = auth.uid() and owner_local_id is not null);
