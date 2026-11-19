-- CleartrackApps key delivery: Stripe purchase -> license key -> email (Resend).
-- Private tables only (RLS on, no policies, no anon/authenticated access).

-- Settings the key-delivery function reads with the service role
-- (e.g. stripe_webhook_secret). Secrets that the owner pastes herself live in
-- Supabase function secrets instead (RESEND_API_KEY, STRIPE_SECRET_KEY).
create table if not exists public.ct_settings (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.ct_settings enable row level security;
revoke all on public.ct_settings from public, anon, authenticated;

-- Which Stripe price unlocks which app (filled in once the Stripe products exist).
-- A Checkout Session / Payment Link can instead carry metadata
-- ct_product (+ ct_variant_id, ct_variant_name), which wins over this table.
create table if not exists public.ct_stripe_prices (
  stripe_price  text primary key,
  product       text not null references public.ct_products(slug),
  variant_name  text,
  variant_id    integer,
  note          text
);
alter table public.ct_stripe_prices enable row level security;
revoke all on public.ct_stripe_prices from public, anon, authenticated;

-- Every Stripe event handled once (Stripe retries; this makes retries harmless).
create table if not exists public.ct_stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now(),
  outcome     text
);
alter table public.ct_stripe_events enable row level security;
revoke all on public.ct_stripe_events from public, anon, authenticated;

-- Delivery log on the key itself.
alter table public.ct_license_keys
  add column if not exists emailed_at   timestamptz,
  add column if not exists email_id     text,
  add column if not exists email_error  text;

grant select, insert, update, delete on public.ct_settings, public.ct_stripe_prices, public.ct_stripe_events to service_role;

alter table public.ct_license_keys
  add column if not exists stripe_payment_intent text;
create index if not exists ct_license_keys_stripe_sub on public.ct_license_keys (stripe_subscription);
create index if not exists ct_license_keys_stripe_pi  on public.ct_license_keys (stripe_payment_intent);
