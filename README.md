# On Mic Jam

Prepaid seats — and prepaid mocktails — for the On Mic Community jam sessions in
Kanpur.

Built to `handoff/onmic-jam-spec.md` (**spec v1.1**). Read that first — it explains
*why* the app is shaped this way, and every rule number (`R6`, `E13`, `S10` …) in the
code comments points back into it.

**The three things to understand:**

1. **Payment happens before the event.** Money used to be collected after people
   were served, which is why it went missing. This app never chases anyone for money
   after the fact.
2. **There is no door checkpoint.** The drink claim is the only gate. People arrive
   over two hours; stationing a volunteer at the entrance is exactly the manual
   labour this system exists to remove.
3. **The cafe is paid a flat committed headcount.** That is deliberate: it makes an
   over-served mocktail *the cafe's* cost, not the community's, which is what gives
   them a reason to check the green screen. See §3.4.

Running cost is ₹0 — no payment gateway, no printing, no paid tier.

---

## Stack

| Layer | Choice | Cost |
|---|---|---|
| Framework | Next.js 15 App Router, React 19 | free |
| Hosting | Vercel Hobby | free |
| Database | Supabase Postgres | free |
| DB client | `@supabase/supabase-js` (service role, server only) | free |
| Styling | Tailwind CSS 4 | free |
| QR | `qrcode`, server-rendered to a data URI | free |
| Email | `resend` (entirely optional) | free tier |
| Auth | HMAC-signed HTTP-only cookie, hand-rolled | free |

No ORM, no component library, no state manager, no payment gateway, no cron, no queue.

---

## Getting it running

### 1. Database

Run both files in Supabase → SQL Editor, in this order.

```
handoff/supabase/schema.sql   # tables, indexes, the five state-transition functions
supabase/app.sql              # the application-layer functions (see "Architecture")
```

> ⚠️ **`handoff/supabase/schema.sql` begins with `drop table … cascade`.** That is how
> the handoff bundle ships and it is left verbatim, because it is the artefact the
> §16 harness is verified against. Applying it to a live event **deletes every
> attendee**. After the first apply, only ever re-run `supabase/app.sql`, which is
> additive and safe to re-run as often as you like.

Then run the §16 database harness and confirm every line reads PASS, before writing
or trusting any application code:

```
psql "$DATABASE_URL" -f handoff/supabase/tests.sql
```

Insert the first event, or create it from `/admin/event` once the app is up:

```sql
insert into events (name, event_date, start_time, venue, price, door_price,
                    cafe_share, fund_share, capacity, claim_seconds,
                    upi_vpa, upi_name, closes_at)
values ('On Mic Jam', '2026-09-06', '5:00 PM', '[venue]', 300, 350,
        250, 50, 50, 90,
        'onmic@ybl', 'On Mic Community',
        '2026-09-05 21:00:00+05:30');
```

### 2. Environment

Copy `.env.example` to `.env.local` and fill it in. The server asserts at boot that
`ADMIN_PASSCODE` and `AUTH_SECRET` exist and that `AUTH_SECRET` is at least 32
characters, plus either the Supabase pair or `DATABASE_URL`. A missing secret fails
at deploy, never at 6 PM on a Sunday.

```bash
AUTH_SECRET=$(openssl rand -hex 32)
```

Prices and the UPI VPA are **not** environment variables — they live on the `events`
row so they can change per event without a redeploy.

### 3. Run

```bash
npm install
npm run dev
```

---

## Local development against Postgres

Production talks to Supabase over HTTP. For local work and the test harness, set
`DATABASE_URL` and the data layer switches to a direct Postgres connection instead.
Same SQL either way — only the transport differs — so the tests exercise the
production code paths.

```bash
brew install postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

initdb -D /tmp/pgdata -U postgres --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 55432" -l /tmp/pgdata/server.log start
createdb -h 127.0.0.1 -p 55432 -U postgres onmic
createdb -h 127.0.0.1 -p 55432 -U postgres onmic_test
createdb -h 127.0.0.1 -p 55432 -U postgres onmic_e2e

export DATABASE_URL=postgresql://postgres@127.0.0.1:55432/onmic
node scripts/db-reset.mjs --schema      # apply schema + seed one open event
node scripts/demo-seed.mjs              # or: a realistic mid-week state + a
                                        # paste-ready sample-statement.txt
```

Never set `DATABASE_URL` on Vercel: serverless functions and a direct Postgres pool
do not mix well on a free tier, which is exactly why production uses the HTTP client.

---

## Tests

```bash
npm test            # build + db + unit + api + e2e
npm run test:db     # handoff/supabase/tests.sql — the §16 database harness
npm run test:unit   # pure functions: phone, UTR, the total check, UPI link, errors
npm run test:api    # §16 data integrity, reconciliation, the claim, failure modes
npm run test:e2e    # §16 UI tests 20–24, plus the floor, in a real browser
```

`test:api` starts two production servers — one with a (mocked) email provider and
one with none — against a real Postgres. `test:e2e` drives Chromium through the
confirm sheet, the green window, its expiry, and a dead API at the venue.

Requires the three local databases above. Playwright browsers: `npx playwright install chromium`.

Where the §16 numbered tests live:

| §16 | Where |
|---|---|
| 1–5 data integrity | `tests/api/acceptance.test.mjs` |
| 6–9 reconciliation | `tests/api/acceptance.test.mjs` |
| 10–19 the claim | `tests/api/acceptance.test.mjs` + `handoff/supabase/tests.sql` |
| 20–23 the ticket UI | `tests/e2e/ticket.spec.mjs` |
| 24 the ₹250/₹50 split | `tests/e2e/ticket.spec.mjs` (page) + `tests/api/acceptance.test.mjs` (email) |
| 25–28 failure modes | `tests/api/acceptance.test.mjs` |

---

## Architecture

### All data access is one function call

Every read and write goes through `rpc("<postgres function>", {...})` in
`src/lib/db.ts`. Nothing under `src/app` builds SQL or a query. §8 of the spec
requires this for state transitions ("the API layer must never `UPDATE attendees SET
state = ...` directly"); it is extended here to reads as well, for two reasons:

1. Concurrency and state guards stay in exactly one place.
2. The local Postgres driver and the production Supabase driver run *identical*
   SQL, so a passing test says something about production.

`handoff/supabase/schema.sql` is untouched. Everything added lives in
`supabase/app.sql`, which drops and recreates every `app_*` function on each run —
an orphaned overload would make `src/lib/db.ts`'s lookup-by-name a coin toss.

### Where the interesting parts are

| Concern | File |
|---|---|
| The claim, under a row lock | `handoff/supabase/schema.sql` → `claim_drink` |
| Coupon minting under concurrency | `handoff/supabase/schema.sql` → `confirm_attendee` |
| The whole reconciliation | `supabase/app.sql` → `app_admin_verify` |
| UTR extraction | `src/lib/validate.ts` → `extractUtrs` — one regex, and its dumbness is the feature |
| The §12.2 total check | `src/lib/validate.ts` → `sumAmountsForUtrs` |
| The five ticket states | `src/components/PassTicket.tsx` |
| The green screen both phones show | `src/components/GreenClaim.tsx` |
| The floor | `src/components/FloorScreen.tsx` |
| Admin gate | `src/middleware.ts` + `src/lib/cookie.ts` |
| Every user-visible error sentence | `src/lib/messages.ts` |

### Deliberate deviations from the spec

- **`events.start_time`** — §11 shows "Sun 6 Sep · 5:00 PM" but §7 has no column for
  the time. Added in `supabase/app.sql` as a nullable free-text column, so
  `handoff/supabase/schema.sql` and its test harness stay unchanged.
- **`now` on the claim and pass payloads** — §11.3 requires the countdown to be
  computed from the server's `until` because "phone clocks are wrong more often than
  you would like". A wrong clock breaks `until - Date.now()` just as badly, so the
  server also returns its own clock and the client uses the *duration* between them.
- **A reason on `reset_claim`** — S9 makes a reason mandatory, §8.4 wants the reset
  two taps away. Both hold: the UI sends `"accidental tap"` and an admin can type
  something else on `/admin/people`.
- **A walk-in whose phone is already registered** reuses that row and prices it at
  the door, rather than failing on the duplicate-phone index. R12 only works if it
  is faster than arguing.
- **A walk-in into a full room** is refused with `over_capacity` and told to raise
  the capacity. R2 puts capacity in the database and nothing bypasses it; Appendix B's
  "+8 walk-ins" is implemented by agreeing a capacity of 58, not by a back door.
- **`POST /api/admin/logout`** — not in §9, but the floor screen runs on a
  volunteer's personal phone and the session lasts 30 days.

---

## Deployment (§17)

1. **Supabase** → new project (Mumbai or Singapore). Copy the project URL and the
   `service_role` key.
2. SQL Editor → run `handoff/supabase/schema.sql`, then `supabase/app.sql`, then
   `handoff/supabase/tests.sql` and confirm every line reads PASS.
3. **Vercel** → import the repo → add every variable from `.env.example` → deploy.
   Do not set `DATABASE_URL`.
4. **Resend** (optional) → verify a domain, three DNS records, set `RESEND_API_KEY`
   and `EMAIL_FROM`. The app works fully without this; `/find` is the real recovery
   path. `onboarding@resend.dev` lands in spam.
5. Open `/admin/event` and create the jam.
6. **Smoke test on a real phone, on mobile data, not office wifi:**
   - register → the UPI button actually opens a UPI app
   - **pay ₹1 to the real VPA** and check whether the amount is pre-filled and
     editable — it varies by the payer's app, which is why §12.2's total check exists
   - submit the real UTR → paste the real statement → confirmed, coupon assigned
   - tap CLAIM → green, countdown runs, expires to grey with **no reload**
   - claim again → refused
   - `/admin/floor` → claim for someone else; register a walk-in; undo a claim
7. **Brief the cafe in person** using Appendix B. Not over WhatsApp — walk in and
   show them a green screen on your phone.
8. Post the registration URL (copy it from `/admin`) to the community.

**Use a PhonePe / Paytm for Business merchant QR, not a personal UPI ID.** Merchant
accounts give you the exportable transaction history with UTRs that `/admin/verify`
needs. Without that export there is no reconciliation.

**Rollback:** the app is stateless. Redeploy any previous Vercel build; data is
untouched by deploys.

**Timeline (§17).** Do not ship this into a live event days after starting. The first
run of a new payment rule should not also be the first run of new code. For an
immediate jam, run the manual fallback in Appendix A of the spec.

---

## Running an event

**Saturday, after 9 PM.** Open PhonePe / Paytm for Business → History → select all →
copy. Paste into `/admin/verify` → *Match payments*. Safe to click twice. Check the
**total** at the top: if it is short, someone edited the amount in their UPI app and
you have thirty seconds of work to find them. Work the `pending` bucket by hand.
Then tell the cafe the committed headcount.

**Sunday, at the jam.** Keep `/admin/floor` open. Attendees tap CLAIM on their own
phones when the waiter is at the table. You only touch the screen for the three
exceptions: a dead phone (*claim for them*), an extra friend (*walk-in ₹350*), and an
accidental tap (*undo claim*).

**Sunday, at the end.** `/admin/money` → put the cafe's own mocktail count into the
box → *Copy cafe summary* → paste into WhatsApp → pay the committed headcount by UPI.
If their count is higher than ours, those drinks went out without a green screen —
that is a conversation with the cafe, not a charge to the community.

---

## Known limits

- **Cold load with no network.** The floor survives a flaky connection once loaded
  and searches from its cached roster, but a cold load with the server unreachable
  cannot work without a service worker, and §18 puts PWA work out of scope. Claiming
  always needs signal, by design (§12.3) — a claim that is not authoritative hands
  out a drink you cannot account for.
- **The total check reads amounts heuristically.** It takes the amount nearest the
  reference on its line and reports how many it could read, so an unfamiliar export
  format degrades to "totals check skipped" rather than a false shortfall. It never
  blocks a confirmation.
- **Email delivery** is verified end to end against a mock provider. The real leg
  needs the client's Resend key and a verified domain.
- **`npm audit`** reports advisories in `postcss` and `sharp`, both transitive
  build-time dependencies of the pinned Next 15. Clearing them means Next 16, which
  §5 pins away from. Neither is reachable at runtime here.
- **Rate limiting** is per server instance and keyed on `x-forwarded-for`. Correct on
  Vercel, which sets that header itself.

---

## Explicitly not built (§18)

Payment gateway integration, bank-feed webhooks, in-app refunds, printing, an offline
claim queue, a door checkpoint, WhatsApp notifications, per-admin accounts, 2FA,
multiple simultaneous open events, native apps, seat maps, tiered pricing, promo
codes. Each is a v2 conversation with a cost attached, not a scope tweak.
