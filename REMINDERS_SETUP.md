# Phone Reminders — Manual Setup

This app is an offline-first PWA. Medical records always stay in your
browser. Reminder *metadata* (title, due time, patient first name) is the
only thing that crosses the network, and only when you opt in to phone
reminders.

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

## 5. Schedule the function (every minute)

In the Supabase dashboard, **Database → Cron / Scheduled Triggers**, add
a job that POSTs to the function every minute. Equivalent SQL:

```sql
select cron.schedule(
  'send-reminders-every-minute',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://<project>.functions.supabase.co/send-reminders',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer <anon or service-role key>'
       )
     ) $$
);
```

Granularity: every minute is fine; reminders fire on `fire_at <= now()`.

## 6. Try it

1. Open the deployed app on your phone.
2. Add it to your home screen (Android: install prompt; iOS: Share →
   Add to Home Screen — required for iOS push, see Limitations below).
3. Open the app from the home screen icon.
4. On the Dashboard, tap **Enable phone reminders** and accept the
   permission prompt.
5. Set a reminder a couple of minutes in the future on an appointment.
   Background the app or lock the phone.
6. The push should arrive within ~1 minute of the fire time.

## What gets stored where

| Data                                 | Where                |
| ------------------------------------ | -------------------- |
| Patients, physicians, medical records, vitals, medication logs | **Local only** (IndexedDB / Dexie) |
| Reminder fire time, title, body, patient first name            | Supabase `reminders` |
| Browser push endpoint + keys                                   | Supabase `devices`   |

The Edge Function never touches medical records — it only knows the
short string used in the notification.

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
- **Recurring medications**: Only refill-date reminders sync to
  Supabase. Time-of-day dosing reminders remain in-app only because
  expanding them server-side would replicate too much patient context.

## Turning it off

Use the **Turn off on this device** button on the dashboard. That
unsubscribes from push and deletes the device's row + pending reminders
from Supabase. Other family members on other devices are unaffected.
