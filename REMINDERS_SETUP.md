# Phone Reminders — Manual Setup

This app is an offline-first PWA. Medical records always stay in your
browser. Reminder *metadata* (title, due time, patient first name) is the
only thing that crosses the network, and only when you opt in to phone
reminders.

The one exception is the optional **daily "Log today's meds?" nudge**
(see below). It is a fixed, generic string — it sends **no patient name,
no medication name, and no medical detail of any kind**, only a device id
and the local time you chose.

When configured, the app will deliver a Web Push notification to every
registered phone/browser when a reminder is due — even if the app is
closed and the screen is locked.

The pieces below run **outside the repo** and have to be set up once per
deployment.

---

## 1. Generate a VAPID key pair

```bash
npx web-push generate-vapid-keys
```

This prints a public and private key. The public key is used by the
browser when subscribing to push and must also live in your client
build. The private key is only ever read by the Edge Function.

## 2. Create a Supabase project

1. https://supabase.com → New project.
2. In **Authentication → Providers**, enable **Anonymous sign-ins**.
   The client signs in anonymously so each install gets a stable user id
   without asking for an email/password.
3. In **SQL Editor**, paste and run:

   ```
   supabase/migrations/0001_phone_reminders.sql
   ```

   This creates two tables — `devices` (push subscriptions) and
   `reminders` (rendered occurrences) — with row-level security keyed on
   `auth.uid()`.

4. Then run:

   ```
   supabase/migrations/0002_daily_meds_nudge.sql
   ```

   This adds `daily_nudges` (the per-device daily rule: `enabled` and
   `local_time`, RLS keyed on `auth.uid()` the same way), allows
   `'daily_meds'` as a `reminders.source`, and adds a unique partial
   index on `(device_id, source_id)` for `source = 'daily_meds'` — that
   index is what guarantees at most one nudge per device per local day.

## 3. Wire up the client

Copy `.env.example` → `.env` and fill in:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from project settings>
VITE_VAPID_PUBLIC_KEY=<public key from step 1>
```

Rebuild the client (`npm run build`). If any of the three values is
missing, the dashboard will show a "not configured" message and no
network calls happen — the app continues to work locally.

## 4. Deploy the delivery Edge Function

The Edge Function in `supabase/functions/send-reminders/` looks for due
reminders, sends the push, and stamps `delivered_at`.

```bash
# install the CLI: https://supabase.com/docs/guides/cli
supabase login
supabase link --project-ref <your-ref>

# secrets
supabase secrets set \
  VAPID_PUBLIC_KEY=<public key> \
  VAPID_PRIVATE_KEY=<private key> \
  VAPID_SUBJECT=mailto:you@example.com

supabase functions deploy send-reminders --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are populated
automatically for deployed functions.

## 5. Schedule the function (every 2 minutes)

Enable the **pg_cron** and **pg_net** extensions under **Database →
Extensions**, then run:

```
supabase/migrations/0003_reminder_cron_and_maintenance.sql
```

That file schedules the delivery job and the log-retention jobs together,
and explains the reasoning inline. The delivery job is:

```sql
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
```

Three things matter here:

- **Granularity.** Reminders fire on `fire_at <= now()`, so a 2-minute tick
  delays delivery slightly but never drops a reminder. It halves the write
  volume compared to every minute.
- **`timeout_milliseconds` is not optional.** pg_net holds an open
  transaction while a request is in flight, and an open transaction stops
  autovacuum from reclaiming dead rows *anywhere* in the database. Without a
  timeout, one hung call can bloat the project into a Disk IO budget
  warning. See step 7.
- **Even minutes.** If the same project also runs Pawfolio's
  `send-pet-reminders`, put that one on `1-59/2 * * * *`. Small compute
  instances have only a handful of background worker slots, and two jobs
  firing on the same minute can fail with `job startup timeout` — a silently
  missed notification.

## 6. Try it

1. Open the deployed app on your phone.
2. Add it to your home screen (Android: install prompt; iOS: Share →
   Add to Home Screen — required for iOS push, see Limitations below).
3. Open the app from the home screen icon.
4. On the Dashboard, tap **Enable phone reminders** and accept the
   permission prompt.
5. Set a reminder a couple of minutes in the future on an appointment.
   Background the app or lock the phone.
6. The push should arrive within ~2 minutes of the fire time.

## 7. Keep the cron logs trimmed

Both pg_cron and pg_net keep append-only logs that nothing prunes by
default: `cron.job_run_details` gets a row per job per run, and
`net._http_response` gets a row per HTTP call. A reminder job running around
the clock generates hundreds of thousands of rows per week. Once those
tables grow past the instance's `shared_buffers`, ordinary maintenance
starts hitting disk and the project trips a **Disk IO Budget** warning even
though the app itself stores barely any data.

Migration `0003` schedules two jobs that handle this: `purge-cron-history`
(daily, keeps 2 days) and `db-maintenance` (every 15 minutes, trims pg_net
responses to the last hour and restarts the pg_net worker if it is stuck on
a transaction older than 5 minutes).

To check the current state:

```sql
select pg_size_pretty(pg_database_size(current_database()));

select jobid, status, count(*)
from cron.job_run_details
where start_time > now() - interval '15 minutes'
group by 1, 2;
```

Low tens of MB and no `failed` rows is healthy. Hundreds of MB means the
retention jobs are not running. Multi-second job durations mean the HTTP
call is blocking and the timeout is missing.

## What gets stored where

| Data                                 | Where                |
| ------------------------------------ | -------------------- |
| Patients, physicians, medical records, vitals, medication logs | **Local only** (IndexedDB / Dexie) |
| Reminder fire time, title, body, patient first name            | Supabase `reminders` |
| Browser push endpoint + keys                                   | Supabase `devices`   |
| Daily nudge on/off + chosen local time (no names)              | Supabase `daily_nudges` |
| Dose schedule rule (label, interval, window) + dose times       | Supabase `dose_schedules` / `dose_events` |

The Edge Function never touches medical records — it only knows the
short string used in the notification.

## Daily "Log today's meds?" nudge

Optional, **off by default**, and enabled per device from the phone
reminders card on the dashboard. When on, it sends exactly one push per
day at the local time you pick (default **8:00 PM**), and tapping it
opens the medications page.

Privacy: the notification is always the literal text **"MedRecords" /
"Log today's meds?"**. No patient name, no medication name, no dose, no
count — nothing that would reveal a health detail on a lock screen. The
row it writes to `reminders` has `patient_name` set to `null`.

How it works:

- The **recurrence lives server-side**. `daily_nudges` stores only the
  rule (`enabled`, `local_time`); the client never pre-generates future
  occurrences.
- The timezone comes from the existing `devices.timezone` column, which
  is refreshed whenever you save the setting — so the nudge follows you
  when you travel. There is no second source of truth for timezone.
- On each run the Edge Function computes *today* in the device's own
  timezone and materializes one `reminders` row whose `source_id` is that
  local date as `YYYYMMDD`. The unique partial index makes a second
  insert for the same (device, local date) fail harmlessly, so a
  frequently-firing cron still produces exactly one notification per day.
- It is delivered only to the device that opted in, not to every device
  on the account.
- It is **not** suppressed when doses are already logged. iOS requires a
  visible notification for every push, so it always shows.
- Catch-up window: if the function is down at your chosen time, it will
  still send up to 2 hours late; past that the day's row is retired
  rather than firing at an unexpected hour.
- Turning it off sets `enabled = false`, which stops materialization
  **server-side** — it is not merely hidden in the UI.

## Dose schedules (every-N-hours medications)

Migration: `supabase/migrations/0004_dose_schedules.sql`.

A dose schedule reschedules from the **actual** time a dose was given.
Record a dose at 2:14 PM on a 4-hour medication and the next one is due
at 6:14 PM, not at whatever fixed time the original plan said.

Two tables:

- **`dose_schedules`** — the rule. One row per medication that opts in:
  label, optional first name, `interval_min`, `anchor`, daily window,
  `max_per_day`, `grace_min`, `ends_on`, `timezone`.
- **`dose_events`** — the occurrences: `due_at`, `taken_at`, `status`
  (`pending` / `taken` / `skipped` / `missed`).

### The two anchor modes

| `anchor` | Next dose is | Use for |
| --- | --- | --- |
| `fixed` | the next entry in `fixed_times` | once- and twice-daily meds, where the clock time should never drift |
| `from_last_dose` | actual `taken_at` + `interval_min` | "every N hours" meds |

`fixed` is the default. Existing refill reminders are untouched by this
migration.

### Why there is only ever one pending dose

A partial unique index (`dose_events_one_open`) allows at most one
`pending` event per schedule. This is the invariant that makes relative
scheduling safe: a phone that was off for two days cannot come back to a
queue of stale doses all firing at once.

### Drift guardrails

An every-4-hours medication anchored to real times walks later every
day — forty minutes late, three times, and a dose lands at 2 AM. Three
limits are applied in order by `dose_next_due()`:

1. **Daily window** (`window_start` / `window_end`) — a dose computed
   past the end of the window moves to the start of the next day's
   window. This is the daily reset that stops drift accumulating.
2. **`max_per_day`** — a hard ceiling per local day.
3. **`ends_on`** — past the end date, nothing more is scheduled and the
   schedule disables itself.

A window crossing midnight is rejected by a check constraint; v1 does
not support it.

### Recording a dose

Call the `log_dose` function — never update `dose_events` directly:

```sql
select public.log_dose(
  p_event_id => '<uuid>',
  p_taken    => true
);
```

It records the dose and queues the next one in **one transaction**, and
returns an `outcome`:

| `outcome` | Meaning |
| --- | --- |
| `logged` | recorded; `next_due_at` is the next dose (null if the course ended) |
| `already_logged` | another tab or device got there first; includes `taken_at` and `actor_label` so the caller can say so instead of erroring |
| `too_soon` | a dose was logged less than half an interval ago — re-call with `p_force => true` after showing the user when |

The update is conditional on the event still being `pending`, so two
callers can never both log the same dose. Solo users rarely hit that;
it is the foundation the shared version needs.

A **skip** schedules the next dose from the original `due_at`, not from
now, so skipping a dose does not stretch the day's spacing.

### What the worker does each tick

The same `send-reminders` function, on the same 2-minute cron. **No new
cron job** — a third `pg_cron` entry would compete for the same few
background worker slots that step 7 above exists to protect.

1. `dose_sweep()` marks pending doses past `due_at + grace_min` as
   `missed`, and makes sure every enabled schedule has one pending dose.
   After a miss the next dose comes from the **rule**, not from the stale
   due time.
2. Due doses are materialized into `reminders` rows with `source='dose'`
   and `dose_event_id` set. The unique index on that column makes the
   insert safe to attempt every tick, exactly like the daily nudge.
3. Before sending, a queued dose push is re-checked against its event. If
   the dose was logged or missed in between, the reminder is retired as
   `superseded` rather than telling you to take something you already
   took.

`dose_sweep()` is `security definer` and walks every user's rows, so
execute is revoked from `anon` and `authenticated`. It is worker-only.

### Privacy

A dose notification does name the medication label you chose and,
optionally, a first name — more than the deliberately blank daily nudge.
That is why a dose schedule is **opt-in per medication**. The label is
your own text, so "Morning pill" works just as well as a drug name, and
`subject_name` can be left empty. No records, dosages, or diagnoses are
ever stored server-side.

## Limitations

- **iOS**: Push notifications work only when the PWA has been "Added to
  Home Screen" and opened from there at least once. iOS 16.4+ is
  required. Subscriptions on regular Safari tabs won't survive.
- **Background timing**: Web Push is best-effort. Android typically
  delivers within seconds. iOS may delay delivery up to a few minutes
  during low-power mode.
- **Sound**: Custom alert sounds (`soft-chime`, `clear-bell`,
  `urgent-tone`) play only while the app is open. The OS plays the
  default notification sound for closed-app pushes.
- **Recurring medications**: Refill-date reminders and opted-in dose
  schedules sync to Supabase (see **Dose schedules** above). Any
  medication without a dose schedule stays in-app only.
- **Not an alarm**: nothing here can guarantee a dose notification at an
  exact minute. Web Push is best-effort and is subject to Do Not Disturb
  and Focus modes. The in-app next-due time is always the source of
  truth, so a missed push is recoverable. This is a reminder tool, not a
  medical device.

## Turning it off

Use the **Turn off on this device** button on the dashboard. That
unsubscribes from push and deletes the device's row + pending reminders
from Supabase. Other family members on other devices are unaffected.

To stop only the daily meds nudge and keep appointment reminders, switch
off **Daily reminder to log meds** on the same card. That flips
`daily_nudges.enabled` to `false`, so the server stops generating it.
Turning off the device entirely also deletes its `daily_nudges` row.
