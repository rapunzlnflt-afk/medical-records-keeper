-- CleartrackApps license keys: replaces the Lemon Squeezy License API for all
-- six paid apps (Lemon Squeezy shuts down 2027-03-31).
--
-- Only the `licenses` Edge Function (service role) touches these tables. RLS is
-- on with no policies, and anon/authenticated have no grants, so the public
-- anon key can't read or write a single key.
--
-- Products keep their Lemon Squeezy store/product ids so the apps' existing
-- "is this key for this app?" check keeps working with no app-side change.

create table public.ct_products (
  slug          text primary key,
  name          text not null,
  ls_store_id   integer not null default 478073,
  ls_product_id integer not null unique,
  max_devices   integer not null check (max_devices between 1 and 50),
  kind          text not null check (kind in ('one_time', 'subscription'))
);

insert into public.ct_products (slug, name, ls_product_id, max_devices, kind) values
  ('budget-tracker',           'Budget Tracker',           1525436, 3, 'one_time'),
  ('bootstraps',               'Bootstraps',               1499017, 3, 'one_time'),
  ('puzzle-pig',               'Puzzle Pig',               1525656, 5, 'one_time'),
  ('cosmetic-surgery-planner', 'Cosmetic Surgery Planner', 1525661, 3, 'one_time'),
  ('pawfolio-complete',        'Pawfolio Complete',        1405596, 3, 'subscription'),
  ('medrecords-max',           'MedRecords Max',           1438215, 3, 'subscription');

create table public.ct_license_keys (
  id                  uuid primary key default gen_random_uuid(),
  key                 text not null unique default upper(gen_random_uuid()::text),
  product             text not null references public.ct_products(slug),
  -- Shown by the apps as the plan name. MedRecords reads variant_id to tell
  -- Care (2245604 / 2315392) from Max.
  variant_name        text,
  variant_id          integer,
  status              text not null default 'active' check (status in ('active', 'disabled')),
  -- null = never expires (one-time and free keys). Subscriptions get the end
  -- of the paid period; past it the key reports "expired".
  expires_at          timestamptz,
  max_devices         integer check (max_devices between 1 and 50), -- null = product default
  holder_name         text,
  holder_email        text,
  note                text,
  source              text not null default 'manual' check (source in ('manual', 'free', 'stripe', 'lemonsqueezy')),
  stripe_customer     text,
  stripe_subscription text,
  stripe_session      text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index ct_license_keys_product_idx on public.ct_license_keys (product);
create index ct_license_keys_sub_idx on public.ct_license_keys (stripe_subscription) where stripe_subscription is not null;

create table public.ct_license_activations (
  id          uuid primary key default gen_random_uuid(),
  key_id      uuid not null references public.ct_license_keys(id) on delete cascade,
  device_name text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index ct_license_activations_key_idx on public.ct_license_activations (key_id);

-- Failed lookups per connection (hashed IP), for rate limiting key guessing.
create table public.ct_license_misses (
  ip_hash text not null,
  at      timestamptz not null default now()
);
create index ct_license_misses_idx on public.ct_license_misses (ip_hash, at);

alter table public.ct_products            enable row level security;
alter table public.ct_license_keys        enable row level security;
alter table public.ct_license_activations enable row level security;
alter table public.ct_license_misses      enable row level security;
revoke all on public.ct_products, public.ct_license_keys, public.ct_license_activations, public.ct_license_misses
  from anon, authenticated;

-- ---------- reply shape (mirrors Lemon Squeezy's License API) ----------

create or replace function public.ct_license_reply(k public.ct_license_keys, inst public.ct_license_activations)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'license_key', jsonb_build_object(
      'key', k.key,
      'status', case when k.status = 'disabled' then 'disabled'
                     when k.expires_at is not null and k.expires_at < now() then 'expired'
                     else 'active' end,
      'expires_at', k.expires_at,
      'activation_limit', coalesce(k.max_devices, p.max_devices),
      'activation_usage', (select count(*) from public.ct_license_activations a where a.key_id = k.id)),
    'instance', case when inst.id is null then null
                     else jsonb_build_object('id', inst.id, 'name', inst.device_name, 'created_at', inst.created_at) end,
    'meta', jsonb_build_object(
      'store_id', p.ls_store_id, 'product_id', p.ls_product_id, 'product_name', p.name,
      'variant_id', k.variant_id, 'variant_name', k.variant_name))
  from public.ct_products p where p.slug = k.product
$$;

-- ---------- activate / validate / deactivate ----------

create or replace function public.ct_license_activate(p_key text, p_device text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.ct_license_keys; inst public.ct_license_activations; lim int; used int; r jsonb;
begin
  select * into k from public.ct_license_keys where key = upper(trim(p_key)) for update;
  if not found then return jsonb_build_object('activated', false, 'error', 'license_key not found', 'license_key', null); end if;
  r := public.ct_license_reply(k, null);
  if r->'license_key'->>'status' <> 'active' then
    return r || jsonb_build_object('activated', false, 'error', 'This license key is ' || (r->'license_key'->>'status') || '.');
  end if;
  select coalesce(k.max_devices, p.max_devices) into lim from public.ct_products p where p.slug = k.product;
  select count(*) into used from public.ct_license_activations where key_id = k.id;
  if used >= lim then
    return r || jsonb_build_object('activated', false, 'error', 'This license key has reached the activation limit.');
  end if;
  insert into public.ct_license_activations (key_id, device_name) values (k.id, left(p_device, 120)) returning * into inst;
  return public.ct_license_reply(k, inst) || jsonb_build_object('activated', true, 'error', null);
end $$;

create or replace function public.ct_license_validate(p_key text, p_instance text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.ct_license_keys; inst public.ct_license_activations; r jsonb;
begin
  select * into k from public.ct_license_keys where key = upper(trim(p_key));
  if not found then return jsonb_build_object('valid', false, 'error', 'license_key not found', 'license_key', null); end if;
  if p_instance is not null and p_instance <> '' then
    select * into inst from public.ct_license_activations
      where key_id = k.id and id::text = p_instance;
    if not found then
      return public.ct_license_reply(k, null) || jsonb_build_object('valid', false, 'error', 'license_key instance not found');
    end if;
    update public.ct_license_activations set last_seen = now() where id = inst.id;
  end if;
  r := public.ct_license_reply(k, inst);
  return r || jsonb_build_object('valid', r->'license_key'->>'status' = 'active', 'error', null);
end $$;

create or replace function public.ct_license_deactivate(p_key text, p_instance text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.ct_license_keys; n int;
begin
  select * into k from public.ct_license_keys where key = upper(trim(p_key));
  if not found then return jsonb_build_object('deactivated', false, 'error', 'license_key not found', 'license_key', null); end if;
  delete from public.ct_license_activations where key_id = k.id and id::text = coalesce(p_instance, '');
  get diagnostics n = row_count;
  return public.ct_license_reply(k, null) || jsonb_build_object('deactivated', n > 0,
    'error', case when n > 0 then null else 'license_key instance not found' end);
end $$;

-- ---------- issuing keys (owner / Stripe webhook only) ----------

create or replace function public.ct_issue_key(
  p_product text, p_holder_name text default null, p_holder_email text default null,
  p_source text default 'manual', p_note text default null,
  p_variant_name text default null, p_variant_id integer default null,
  p_expires_at timestamptz default null, p_max_devices integer default null)
returns public.ct_license_keys language sql security definer set search_path = public as $$
  insert into public.ct_license_keys (product, holder_name, holder_email, source, note, variant_name, variant_id, expires_at, max_devices)
  values (p_product, p_holder_name, lower(p_holder_email), p_source, p_note, p_variant_name, p_variant_id, p_expires_at, p_max_devices)
  returning *
$$;

create or replace function public.ct_touch_updated() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger ct_license_keys_touch before update on public.ct_license_keys
  for each row execute function public.ct_touch_updated();

revoke all on function public.ct_license_reply(public.ct_license_keys, public.ct_license_activations),
  public.ct_license_activate(text, text), public.ct_license_validate(text, text),
  public.ct_license_deactivate(text, text),
  public.ct_issue_key(text, text, text, text, text, text, integer, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.ct_license_activate(text, text), public.ct_license_validate(text, text),
  public.ct_license_deactivate(text, text),
  public.ct_issue_key(text, text, text, text, text, text, integer, timestamptz, integer)
  to service_role;
