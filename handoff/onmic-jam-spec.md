# On Mic Jam — Build Specification v1.1

**Client:** On Mic Community, Kanpur
**Contacts:** Vaibhav Tiwari, Aditya Prakash Gupta
**Revised:** 2 September 2026
**Supersedes:** v1.0 (12 Aug 2026)

**What changed from v1.0 and why:** the cafe deal is now ₹250 per head for *entry plus one mocktail* — a single discrete item, not a food combo. That one fact makes the door checkpoint unnecessary and replaces it with something better: **the drink is the checkpoint.** No volunteer stands at the entrance, and the cafe needs no system, no device, and no training beyond one sentence. Sections 2, 4, 8.4, 11.3 and 15 are substantially rewritten. §3.5 on disclosure is new and is the most important page in this document.

---

## Table of contents

1. [The problem](#1-the-problem)
2. [The system in one page](#2-the-system-in-one-page)
3. [Business rules — normative](#3-business-rules--normative)
4. [The attendee state machine](#4-the-attendee-state-machine)
5. [Tech stack](#5-tech-stack)
6. [Environment variables](#6-environment-variables)
7. [Database schema](#7-database-schema)
8. [Database functions](#8-database-functions)
9. [Route map](#9-route-map)
10. [API contracts](#10-api-contracts)
11. [Screen specifications](#11-screen-specifications)
12. [The three hard parts](#12-the-three-hard-parts)
13. [Email](#13-email)
14. [Security model](#14-security-model)
15. [Edge cases — required behaviour](#15-edge-cases--required-behaviour)
16. [Acceptance tests](#16-acceptance-tests)
17. [Deployment runbook](#17-deployment-runbook)
18. [Explicitly out of scope](#18-explicitly-out-of-scope)
19. [Appendix A — copy deck](#appendix-a--copy-deck)
20. [Appendix B — the cafe agreement](#appendix-b--the-cafe-agreement)

---

## 1. The problem

On Mic Community runs live music jam sessions at cafes in Kanpur. Sunday's event has ~50 people. The cafe charges **₹250 per head for entry plus one mocktail**. The community charges **₹300**, keeping **₹50** per head as a community fund.

Three distinct problems, which need three distinct solutions:

**P1 — Money is collected after consumption.** People are served first and asked to pay later. Once someone has been served, the only remaining leverage is social pressure, which does not work in a 50-person room of near-strangers. Every event, some people leave without paying and the organisers absorb it. *Fixed by sequencing: payment moves before the event.*

**P2 — Extra people.** Attendees bring uninvited friends. The friend drinks, the cafe bills for them, the organisers pay. *Fixed by an entitlement gate on the drink itself, plus a door price that converts an extra body from a cost into revenue.*

**P3 — The cafe cannot verify anyone.** They have no system, no device, and no reason to learn one. *Fixed by giving them a one-sentence rule and aligning their financial incentive with enforcing it — see §3.4.*

**Hard constraints from the client:**

- Running cost must be **₹0**. No payment gateway percentage, no paid hosting, no paid service tier.
- **No physical items.** No printed coupons, no cards, no wristbands, no stamps.
- **Nothing to install or learn on the cafe's side.**
- Organisers must be able to enjoy the jam. Any design requiring a volunteer stationed somewhere for two hours has failed.

---

## 2. The system in one page

```
   ATTENDEE                       ADMIN                      CAFE
   ────────                       ─────                      ────

1. Registers, pays ₹300 by
   UPI direct to merchant QR
   (0% fee), pastes the
   12-digit UTR back
        │
        └────────────────►  2. Sat 9 PM: pastes the UPI
                               transaction export into one
                               textarea. App matches UTRs,
                               confirms everyone, assigns
                               coupon numbers 1..N
        ◄──────────────────────────┘
3. Gets an email:
   receipt + coupon number
        │                    4. Commits the headcount ──────► Preps 50 mocktails.
        │                       "50 flat, ₹12,500,             Bills a FLAT 50
        │                       paid on the night"             regardless.
        ▼
5. Arrives whenever. Sits.
   No queue, no door check.
        │
        ▼
6. Waiter comes to the table.
   Taps CLAIM in front of them.
   Screen → FULL GREEN,
   coupon 41, 90s countdown  ───────────────────────────────► 7. Sees green.
        │                                                        Serves one
        ▼                                                        mocktail.
8. Screen greys out.
   "Claimed 6:42 PM."
   Cannot ever be claimed again.

   NO GREEN SCREEN → no mocktail. Extra friend either pays
   ₹350 on the spot (admin registers them in 30 seconds) or
   doesn't drink. Either way it costs the organisers nothing.
```

**There is no door checkpoint.** People arrive over two hours; stationing a volunteer at the entrance for that whole window is precisely the manual labour this system exists to remove. The check happens at the only moment it needs to — when a drink is handed over — performed by the person already standing there.

**The coupon number is inert until claimed.** It is in the email as a receipt, but the ticket page is grey until the attendee taps CLAIM. A forwarded email or a screenshot is a grey screen. Staff learn exactly one rule: *green means serve.*

---

## 3. Business rules — normative

**R1.** Registration does not reserve a seat. Only a confirmed payment reserves a seat.

**R2.** An event has a `capacity`. Confirmations stop at capacity; registrations do not — an unpaid registration costs nothing and blocks nobody.

**R3.** An event has a `closes_at`. Past it, registration and UTR submission are rejected. No human has to do anything at 9 PM on Saturday.

**R4.** A UTR may be claimed by at most one attendee per event, enforced by a database unique index, not application code.

**R5.** Coupon numbers are assigned at confirmation, sequentially from 1, and are never reused, reassigned, or released — not on refund, not on rejection. Gaps are correct and expected.

**R6.** **One drink claim per pass, ever.** A claim opens a short green window (default 90s). Re-opening the page inside that window shows the *same* claim with its live countdown, never a second one. After the window expires the pass is spent.

**R7.** The coupon number renders at serving size (≥ 96px) on a full-green background **only** while a claim window is open. In every other state the page is grey and the number is small and labelled inactive.

**R8.** A claim may be made by the attendee (`self`) or by an admin on their behalf (`admin`). The admin path exists because an attendee's phone may be dead or offline, and there must always be a way through that does not involve arguing with a waiter.

**R9.** Email must never block or fail a confirmation. If the provider errors, the attendee is still confirmed, `emailed_at` stays null, and an admin action retries.

**R10.** The cafe is paid on the **committed headcount**, agreed in advance — not on claims. See §3.4 for why this matters more than it looks.

**R11.** Refunds are performed by a human over UPI. The app records that a refund happened and voids the pass. The app never moves money.

**R12.** Walk-ins are not refused; they are priced. An admin registers them on the spot at `door_price` and they are confirmed immediately.

**R13.** No feature may introduce a per-transaction fee, a printing requirement, a paid tier, or anything the cafe has to install or operate.

### 3.4 Why the cafe polices this for you

The instinct is to build enforcement so the organisers can catch freeloaders. Don't. Change who is exposed instead.

**Agree a flat committed headcount with the cafe: 50 heads, ₹12,500, payable on the night regardless of who shows up.** Once that is the deal, an extra mocktail served to someone who did not pay comes out of *the cafe's* margin, not yours. The cafe now has the incentive to check the green screen, and you are not asking them for a favour — you are handing them a one-second tool to protect their own revenue.

This is the whole answer to P3. The green screen is not enforcement you impose on the cafe; it is the easiest possible way for them to do something they already want to do. A briefing that begins *"so you don't serve free drinks"* lands very differently from one that begins *"so we can catch people."*

Corollary: **claims are not the invoice.** Claims are a leak detector. If the cafe reports 54 mocktails against 50 claims, four drinks went to people without a green screen, and that is a conversation with the cafe, not a charge to the community.

### 3.5 Disclosure of the ₹50 — required, not optional

The client flagged that nobody knows about the ₹50 margin. Resolve this by disclosing it, before Sunday, in the announcement. This is a requirement of the system, not a style preference.

**It will come out anyway.** Fifty people are walking into a cafe that has a public menu and staff who can be asked "what do you charge for the jam entry?" The gap between ₹300 and ₹250 is discoverable by any attendee who is mildly curious, and it will be discovered eventually. Discovered margin reads as skimming. Declared margin reads as organising.

**The precedent is already set.** Aditya's own poll for the 16 August jam said, in the community channel: *"Per head ~Rs.230 (200-Fooding+Beverage, 30- Community Development Fund)."* The community has already been shown this exact structure and did not object — eleven people voted In. Going opaque now would be the change in behaviour, not the disclosure.

**Disclosure raises collection, it does not lower it.** "₹50 to the community fund" is a reason to pay. An unexplained ₹300 against a ₹250 menu price is a reason to ask questions in the group chat on Saturday night, which is the worst possible time.

**The test to apply:** if you cannot name what the fund pays for in one line, the problem is the fund, not the disclosure. Name it — sound equipment, cables, mics, the venue advance, the next event's booking — and it becomes trivially defensible. The copy in Appendix A does this.

Implementation: the price breakdown renders on the registration page and in the email, not only in the WhatsApp announcement. `price`, `cafe_share` and `fund_share` are separate columns in `events` precisely so this can be rendered from data rather than remembered.

---

## 4. The attendee state machine

`state` is a single `text` column with a `CHECK` constraint. Do not use a set of booleans.

```
                        ┌──────────────┐
      registers ───────►│  registered  │
                        └──────┬───────┘
                               │ submits UTR
                               ▼
                        ┌──────────────┐
                        │  submitted   │
                        └──────┬───────┘
                               │ verify: UTR match, or admin manual
                               │ ── coupon_no assigned here, once ──
                               ▼
                        ┌──────────────┐
                        │  confirmed   │◄─── admin confirms a WALK-IN
                        └──────┬───────┘     directly, at door_price
                               │
                               │ taps CLAIM in front of the waiter
                               ▼
                        ┌──────────────┐
                        │   claimed    │   ← terminal. Green for 90s,
                        └──────────────┘     then spent forever.

   registered / submitted / confirmed / claimed  ──►  refunded | rejected
```

| From | To | Trigger | Guard |
|---|---|---|---|
| — | `registered` | `POST /api/register` | event open, before `closes_at`, phone not already used |
| `registered` | `submitted` | `POST /api/utr` | before `closes_at`, 12 digits, UTR unused |
| `submitted` | `submitted` | `POST /api/utr` again | allowed — corrects a typo |
| `submitted` | `confirmed` | bulk verify | confirmed count < capacity |
| `registered` \| `submitted` | `confirmed` | admin manual confirm | confirmed count < capacity |
| `confirmed` | `claimed` | `POST /api/claim` | — |
| `claimed` | `confirmed` | admin `reset_claim` | accidental tap only, logged |
| any of the above | `refunded` \| `rejected` | admin | reason required |

Transitions not in this table are rejected by the database function, not merely hidden in the UI.

---

## 5. Tech stack

| Layer | Choice | Cost |
|---|---|---|
| Framework | Next.js 15 App Router | free |
| Runtime | React 19, Node 22 | free |
| Hosting | Vercel Hobby | free |
| Database | Supabase Postgres free tier | free (500 MB; this uses ~2 MB/year) |
| DB client | `@supabase/supabase-js` 2.x, service-role key, server only | free |
| Styling | Tailwind 4 (`@import "tailwindcss"`, no JS config) | free |
| QR | `qrcode` 1.5.x, server-rendered to a data URI | free |
| Email | `resend` 4.x — 3,000/month free, ~200 needed | free |
| Auth | HMAC-signed HTTP-only cookie, hand-rolled | free |

**Do not add:** an ORM, a component library, a state manager, a payment gateway SDK, a cron service, or a queue. Two tables and eleven routes do not justify any of them.

---

## 6. Environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...   # service_role. NEVER prefix NEXT_PUBLIC_.

ADMIN_PASSCODE=...
AUTH_SECRET=...                          # openssl rand -hex 32

RESEND_API_KEY=re_...                    # optional
EMAIL_FROM="On Mic Community <tickets@yourdomain.com>"

NEXT_PUBLIC_SITE_URL=https://onmic.vercel.app
```

On boot, assert the first four exist and `AUTH_SECRET` is ≥ 32 chars; throw otherwise. A missing secret must fail at deploy, never at 6 PM on a Sunday.

Prices and the UPI VPA live on the `events` row, not in env — they change per event and must not need a redeploy.

---

## 7. Database schema

Run in Supabase → SQL Editor.

```sql
create extension if not exists pgcrypto;

create table events (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  event_date    date        not null,
  venue         text,
  price         int         not null default 300,  -- attendee pays
  door_price    int         not null default 350,  -- walk-in price       [R12]
  cafe_share    int         not null default 250,  -- per head to the cafe
  fund_share    int         not null default 50,   -- per head to the fund
  capacity      int         not null default 50,
  claim_seconds int         not null default 90,   -- green window        [R6]
  upi_vpa       text        not null,
  upi_name      text        not null,
  closes_at     timestamptz not null,              --                     [R3]
  status        text        not null default 'open'
                            check (status in ('open','closed','done')),
  created_at    timestamptz not null default now()
);

-- Exactly one event open at a time: public pages never need an id in the URL.
create unique index events_one_open_idx
  on events ((status = 'open')) where status = 'open';

create table attendees (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,

  pass_code     text not null,        -- OM0709-K3F7 : URL segment + UPI note
  coupon_no     int,                  -- 1..N, assigned at confirmation   [R5]

  name          text not null,
  phone         text not null,        -- exactly 10 bare digits
  email         text,
  instagram     text,

  utr           text,                 -- 12-digit UPI reference
  utr_at        timestamptz,
  amount_paid   int,                  -- price, or door_price for walk-ins
  is_walkin     boolean not null default false,

  state         text not null default 'registered'
                check (state in ('registered','submitted','confirmed',
                                 'claimed','refunded','rejected')),

  confirmed_at  timestamptz,
  verify_method text check (verify_method in ('auto','manual')),

  claimed_at    timestamptz,          -- when the drink was claimed
  claim_until   timestamptz,          -- green window closes at           [R6]
  claim_by      text check (claim_by in ('self','admin')),               -- [R8]

  emailed_at    timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);

create unique index attendees_event_phone_idx  on attendees (event_id, phone);

-- [R4] The single line that stops someone forwarding a friend's payment
-- screenshot and re-using the reference number.
create unique index attendees_event_utr_idx    on attendees (event_id, utr)
  where utr is not null;

create unique index attendees_event_pass_idx   on attendees (event_id, pass_code);
create unique index attendees_event_coupon_idx on attendees (event_id, coupon_no)
  where coupon_no is not null;
create index        attendees_event_state_idx  on attendees (event_id, state);

-- Append-only. Never updated, never deleted. When ₹15,000 of other people's
-- money is involved, "who marked this person paid, and when" is not optional.
create table audit_log (
  id          bigserial primary key,
  event_id    uuid,
  attendee_id uuid,
  action      text not null,   -- register | utr | verify_bulk | confirm |
                               -- claim | reset_claim | refund | reject | email
  detail      jsonb,
  actor       text,            -- 'attendee' | 'admin'
  created_at  timestamptz not null default now()
);

-- [S1] All server access uses the service-role key, which bypasses RLS.
-- RLS on with zero policies means a leaked anon key reads nothing.
alter table events    enable row level security;
alter table attendees enable row level security;
alter table audit_log enable row level security;
```

### Field notes

- **`phone`** — store bare 10 digits. Strip `+91`, spaces, hyphens, and a leading `0`. The unique index is worthless if `9876543210` and `+919876543210` can both exist.
- **`pass_code`** — `OM` + `DDMM` + `-` + 4 chars from `ACDEFGHJKLMNPQRTUVWXY34679`. No `0/O`, `1/I/L`, `5/S`, `2/Z`, `8/B` — it gets read aloud in a noisy room. ~457k combinations; retry on collision.
- **`coupon_no`** — small on purpose. "Forty-one", not "OM0709-K3F7".
- **`claim_seconds`** — 90 by default. Long enough for a distracted waiter, short enough that you cannot claim and hand your phone over later.

---

## 8. Database functions

Every transition touching `state` or `coupon_no` goes through these. **The API layer must never `UPDATE attendees SET state = ...` directly.** Concurrency correctness lives in one place or it lives nowhere.

### 8.1 `confirm_attendee`

```sql
create or replace function confirm_attendee(p_attendee uuid, p_method text,
                                            p_amount int default null)
returns table (out_coupon int, out_status text)
language plpgsql
as $$
declare
  v_event uuid; v_state text; v_coupon int; v_cap int; v_taken int; v_price int;
begin
  select event_id, state, coupon_no into v_event, v_state, v_coupon
    from attendees where id = p_attendee;

  if v_event is null then
    return query select null::int, 'not_found'; return;
  end if;

  -- [R5] idempotent: re-confirming never mints a second coupon
  if v_state in ('confirmed','claimed') then
    return query select v_coupon, 'already'; return;
  end if;

  if v_state in ('refunded','rejected') then
    return query select null::int, 'blocked'; return;
  end if;

  -- Serialise coupon minting. Two admins hitting Verify simultaneously must
  -- not be able to mint the same number.
  perform 1 from events where id = v_event for update;

  select capacity, price into v_cap, v_price from events where id = v_event;
  select count(*) into v_taken from attendees
    where event_id = v_event and state in ('confirmed','claimed');

  if v_taken >= v_cap then                                        -- [R2]
    return query select null::int, 'over_capacity'; return;
  end if;

  select coalesce(max(coupon_no),0)+1 into v_coupon
    from attendees where event_id = v_event;

  update attendees
     set state='confirmed', coupon_no=v_coupon, confirmed_at=now(),
         verify_method=p_method,
         amount_paid = coalesce(p_amount, amount_paid, v_price)   -- [R12]
   where id = p_attendee;

  return query select v_coupon, 'confirmed';
end; $$;
```

### 8.2 `verify_by_utrs` — the whole reconciliation, one call

```sql
create or replace function verify_by_utrs(p_event uuid, p_utrs text[])
returns table (out_id uuid, out_name text, out_email text, out_phone text,
               out_pass text, out_coupon int, out_status text)
language plpgsql
as $$
declare r record; res record;
begin
  for r in
    select a.id from attendees a
     where a.event_id = p_event and a.state='submitted' and a.utr = any(p_utrs)
     order by a.utr_at nulls last, a.created_at   -- first to pay, first served
  loop
    select * into res from confirm_attendee(r.id,'auto',null);
    return query select a.id,a.name,a.email,a.phone,a.pass_code,a.coupon_no,res.out_status
      from attendees a where a.id = r.id;
  end loop;
end; $$;
```

The `order by utr_at` matters. If 53 people pay for 50 seats, the earliest payers get the seats and the last three are flagged for refund. Any other ordering is one you will have to defend to a real person.

### 8.3 `claim_drink` — the only gate between a person and a mocktail

```sql
create or replace function claim_drink(p_event uuid, p_pass text, p_by text)
returns table (out_ok boolean, out_reason text, out_name text, out_coupon int,
               out_until timestamptz, out_claimed_at timestamptz)
language plpgsql
as $$
declare a attendees%rowtype; v_secs int;
begin
  select * into a from attendees
   where event_id = p_event and pass_code = p_pass
   for update;                      -- serialises a double-tap

  if a.id is null then
    return query select false,'not_found',null::text,null::int,
                        null::timestamptz,null::timestamptz; return;
  end if;

  if a.state in ('refunded','rejected') then
    return query select false,'void',a.name,null::int,
                        null::timestamptz,null::timestamptz; return;
  end if;

  if a.state in ('registered','submitted') then
    return query select false,'not_paid',a.name,null::int,
                        null::timestamptz,null::timestamptz; return;
  end if;

  if a.state = 'claimed' then
    if now() < a.claim_until then
      -- [R6] still inside the window: the SAME claim, not a second one.
      -- This is what makes closing and re-opening the page safe.
      return query select true,'active',a.name,a.coupon_no,
                          a.claim_until,a.claimed_at; return;
    else
      return query select false,'already',a.name,a.coupon_no,
                          null::timestamptz,a.claimed_at; return;
    end if;
  end if;

  select claim_seconds into v_secs from events where id = p_event;

  update attendees
     set state='claimed', claimed_at=now(),
         claim_until = now() + (v_secs || ' seconds')::interval,
         claim_by = p_by                                          -- [R8]
   where id = a.id
   returning claimed_at, claim_until into a.claimed_at, a.claim_until;

  return query select true,'ok',a.name,a.coupon_no,a.claim_until,a.claimed_at;
end; $$;
```

The `FOR UPDATE` on the attendee row is what makes a panicked double-tap safe: the first call mints the claim, the rest fall into the `active` branch and see the same countdown. Verified under five concurrent calls — see §16.

### 8.4 `reset_claim` and `set_attendee_void`

```sql
create or replace function reset_claim(p_attendee uuid)
returns text
language plpgsql
as $$
begin
  update attendees
     set state='confirmed', claimed_at=null, claim_until=null, claim_by=null
   where id = p_attendee and state='claimed';
  if not found then return 'noop'; end if;
  return 'reset';
end; $$;

create or replace function set_attendee_void(p_attendee uuid, p_state text)
returns text
language plpgsql
as $$
begin
  if p_state not in ('refunded','rejected') then
    raise exception 'bad state %', p_state;
  end if;
  -- [R5] coupon_no deliberately NOT cleared. Numbers are never recycled;
  -- a gap in the sequence is correct and readable in the audit trail.
  update attendees set state = p_state where id = p_attendee
    and state in ('registered','submitted','confirmed','claimed');
  return p_state;
end; $$;
```

`reset_claim` exists for exactly one situation: someone taps CLAIM by accident before the waiter arrives. Without it, that person loses their drink and you have an argument at the table. It must be reachable in two taps from `/admin/people` and it must write to the audit log.

### 8.5 Calling these from the API layer

```ts
const { data, error } = await supabase.rpc("claim_drink", {
  p_event: eventId, p_pass: passCode, p_by: "self",
});
const result = data?.[0];        // RETURNS TABLE always yields an array
```

Two conventions that cost an hour each if nobody says them out loud:

- **`.rpc()` on a `RETURNS TABLE` function returns an array**, even for a single row. Read `data[0]`. Reading `data.out_reason` yields `undefined` with no error.
- **A set-returning function cannot be called inside `CASE`, `COALESCE`, or any scalar expression** in raw SQL — Postgres rejects it with *"argument of CASE/WHEN must not return a set"*. Wrap it: `select ... from (select (claim_drink(...)).out_reason r) x`. Relevant when you write ad-hoc debugging SQL, which you will.
- Output columns are prefixed `out_` because plpgsql `RETURNS TABLE` parameters are in scope in the body and **silently shadow same-named table columns**. Drop the prefix and `select a.name` starts resolving to the output parameter, returning nulls with no error. Keep the prefix.

### 8.6 Verification status

The schema in §7 and all five functions in §8 have been executed against **PostgreSQL 16**, and every database-level test in §16 passes. `supabase/tests.sql` in the handoff bundle is the runnable harness — run it immediately after applying the schema, before writing any application code, so a later failure is unambiguously in the app layer.

Confirmed passing: single-open-event constraint; duplicate-UTR rejection; sequential coupon assignment with no gaps or duplicates; idempotent re-confirmation; capacity enforcement with earliest-payer-wins ordering (50 confirmed, 3 flagged from 53 payers); first claim opens the window; re-entry inside the window returns the same claim; expired window is spent; unpaid, unknown and refunded passes all blocked at the drink; five concurrent claims produce exactly one claim with one immutable timestamp; admin reset then re-claim; walk-in confirmed at ₹350; and the settlement figures — `collected ₹15,000, cafe ₹12,500, fund ₹2,500` on 50 confirmed with 47 drinks claimed.

---

## 9. Route map

### Public

| Route | Purpose |
|---|---|
| `/` | Register for the open event |
| `/pass/[code]` | Pay, submit UTR, and the live ticket + CLAIM button |
| `/find` | Recover a pass link by phone number |
| `/closed` | No open event, or past `closes_at` |

### Admin — behind the passcode cookie

| Route | Purpose |
|---|---|
| `/admin/login` | Passcode entry |
| `/admin` | Live counts and event controls |
| `/admin/verify` | Paste the UPI statement, run the match |
| `/admin/floor` | Search anyone, claim on their behalf, register a walk-in |
| `/admin/money` | Settlement |
| `/admin/people` | Full table, manual actions |
| `/admin/event` | Create / edit the event |

### API

| Method | Path | Auth |
|---|---|---|
| POST | `/api/register` | public |
| POST | `/api/utr` | public |
| POST | `/api/claim` | public |
| GET | `/api/pass/[code]` | public |
| POST | `/api/find` | public, rate limited |
| POST | `/api/admin/login` | public, rate limited |
| POST | `/api/admin/verify` | admin |
| GET | `/api/admin/roster` | admin |
| POST | `/api/admin/walkin` | admin |
| POST | `/api/admin/attendee/[id]/confirm` \| `/claim` \| `/reset-claim` \| `/refund` \| `/reject` | admin |
| PATCH | `/api/admin/attendee/[id]` | admin |
| POST | `/api/admin/email/retry` | admin |

---

## 10. API contracts

All JSON. Errors are always `{ "error": "<code>", "message": "<human sentence>" }`; the client renders `message` verbatim and never composes its own error text.

### 10.1 `POST /api/register`

```jsonc
{ "name": "Vaibhav Tiwari", "phone": "9876543210",
  "email": "v@example.com", "instagram": "@vaibhav" }
// 200 → { "pass_code": "OM0709-K3F7", "url": "/pass/OM0709-K3F7" }
```

Validation, in order:

1. `name` trimmed, 2–60 chars → `bad_name`
2. `phone` — strip non-digits; drop a leading `91` if that leaves 12, a leading `0` if that leaves 11; must be exactly 10 digits starting 6–9 → `bad_phone`
3. `email` if present must contain `@` and a later dot → `bad_email`
4. An event with `status='open'` must exist → `404 no_event`
5. `now() < closes_at` → `409 closed`
6. Insert. **On unique violation of the phone index, return the existing row's `pass_code` with `200`** — a repeat registration is someone who lost their link, and sending them to their pass is the correct outcome. Never a duplicate, never an error.

### 10.2 `POST /api/utr`

```jsonc
{ "pass_code": "OM0709-K3F7", "utr": "412345678901" }   // 200 → { "state": "submitted" }
```

1. Strip non-digits; must be exactly 12 → `400 bad_utr`: *"A UPI reference number is 12 digits. Check the number on your payment success screen and try again."*
2. Attendee exists → else `404 not_found`
3. State must be `registered` or `submitted`. `confirmed`/`claimed` → `409 already_confirmed`. `refunded`/`rejected` → `409 void`.
4. `now() < closes_at` → `409 closed`
5. Set `utr`, `utr_at=now()`, `state='submitted'`
6. Unique violation → `409 utr_taken`: *"That reference number is already registered against another person. If you think this is a mistake, message the organisers."*

Re-submitting from `submitted` is allowed and overwrites. People mistype; do not lock them out of fixing it.

### 10.3 `POST /api/claim` — the important one

```jsonc
{ "pass_code": "OM0709-K3F7" }        // by: "self"

// 200 — every outcome is a 200. The table is not the place for an HTTP error.
{ "ok": true,  "reason": "ok",       "name": "...", "coupon": 41,
  "until": "2026-09-06T13:03:41Z", "claimed_at": "2026-09-06T13:02:11Z" }
{ "ok": true,  "reason": "active",   ... }   // same claim, window still open
{ "ok": false, "reason": "already",  "name": "...", "coupon": 41,
  "claimed_at": "2026-09-06T12:44:02Z" }
{ "ok": false, "reason": "not_paid", "name": "..." }
{ "ok": false, "reason": "not_found" }
{ "ok": false, "reason": "void",     "name": "..." }
```

Thin wrapper over `claim_drink`. **Put no business logic in this handler** — no "has it been claimed" check in JS, no timestamp arithmetic. All of it is in the function, under a row lock, where concurrency is actually handled. Write one `audit_log` row per call with the reason.

### 10.4 `GET /api/pass/[code]`

Returns the current ticket state so the page can render and poll:

```jsonc
{ "state": "confirmed", "name": "...", "coupon": 41,
  "claim_until": null, "claimed_at": null,
  "event": { "name": "...", "date": "2026-09-06", "venue": "...",
             "price": 300, "cafe_share": 250, "fund_share": 50 } }
```

`cafe_share` and `fund_share` are returned so the ticket can render the price breakdown — **§3.5**.

### 10.5 `GET /api/admin/roster`

Everyone in `confirmed` or `claimed`, for the floor screen.

```jsonc
{ "people": [ { "id":"...", "pass":"OM0709-K3F7", "coupon":41,
                "name":"...", "phone4":"3210",
                "state":"confirmed", "claimed_at":null } ] }
```

**Returns `phone4` — the last four digits — never the full number.** The roster is cached on a volunteer's personal phone; four digits disambiguates two people with the same name perfectly well, and 50 complete phone numbers have no business being there.

### 10.6 `POST /api/admin/walkin`

```jsonc
{ "name": "Friend Of Guest", "phone": "9800000001", "email": null }
// 200 → { "pass_code": "...", "coupon": 51, "amount": 350, "url": "/pass/..." }
```

Creates the attendee with `is_walkin=true`, then calls `confirm_attendee(id,'manual',door_price)` in the same request. Must complete in one screen and under 30 seconds of typing — **R12** only works if using it is faster than arguing.

### 10.7 `POST /api/admin/login`

Body `{ "passcode": "..." }`. Compare with `crypto.timingSafeEqual` over SHA-256 digests of both sides — equalises length and removes the timing leak of `===`. Rate limit 10 per IP per 10 minutes.

Cookie `onmic_admin`, value `<expiry_ms>.<hex hmac-sha256(expiry_ms, AUTH_SECRET)>`, `httpOnly`, `secure`, `sameSite=lax`, `path=/`, 30 days. Verify in `middleware.ts` with matcher `/admin/:path*` and `/api/admin/:path*`, so a new admin route cannot ship unprotected by accident.

---

## 11. Screen specifications

Dark, high contrast, one warm accent. Amber `#F59E0B` brand, green `#22C55E` valid, red `#EF4444` blocked, grey `#3F3F46` inactive. Every target ≥ 48px — these are used one-handed, standing, in low light.

### 11.1 `/` — Register

```
┌──────────────────────────────────────┐
│  ON MIC                              │
│  Jam Session · Sun 6 Sep · 5:00 PM   │
│                                      │
│  ₹300                                │
│  ₹250  entry + 1 mocktail (cafe)     │   ← §3.5. Rendered from
│  ₹50   community fund — mics,        │      events.cafe_share /
│        cables, next venue booking    │      events.fund_share
│                                      │
│  [ Your name              ]          │
│  [ Phone (10 digits)      ]          │
│  [ Email (for your ticket)]          │
│  [ Instagram (optional)   ]          │
│                                      │
│  [       Continue to pay        ]    │
│                                      │
│  Already registered? Find my pass →  │
│                                      │
│  ── 41 of 50 seats taken ──          │
│  Closes Sat 9:00 PM                  │
└──────────────────────────────────────┘
```

- The split is rendered from data, never hardcoded. It is a product requirement, not decoration.
- `inputMode="numeric"` on phone, `type="email"` on email — the right mobile keyboard matters when 50 people do this on a phone.
- Seat counter shows **confirmed**, not registered. Honest scarcity, and it drives prepayment.
- Validate on blur, not on submit.
- On success `router.replace()` so Back does not resubmit.

### 11.2 `/pass/[code]` — states A and B

**A · `registered`** — pay block: a big "Pay ₹300 by UPI" button (deep link), the QR below it, the VPA as text, then the 12-digit UTR field and Submit. Include a "where do I find the reference number?" expander showing where GPay, PhonePe and Paytm each display it — this single element prevents more support messages than anything else on the site.

Keep this line above the fold:

> Cancel before Sat 9 PM for a full refund. Or pass your seat to a friend — message us.

Prepayment fails without a visible exit. People who cannot see how to get their money back simply do not pay.

**B · `submitted`** — payment block collapses to one line, amber dot: *"Reference 4123…8901 received. We confirm on Saturday night — you'll get an email and this page turns active."* Keep a small "wrong number? fix it" link.

### 11.3 `/pass/[code]` — states C and D — **the core of the system**

**C · `confirmed`, not yet claimed**

```
┌──────────────────────────────────────┐
│  ✓  CONFIRMED                        │
│  Vaibhav Tiwari · OM0709-K3F7        │
│                                      │
│         coupon 41                    │   ← ~28px, GREY, inert
│                                      │
│  ┌────────────────────────────────┐  │
│  │   CLAIM MY MOCKTAIL            │  │   ← amber, disabled until
│  │   only tap when the waiter     │  │      the confirm sheet
│  │   is standing with you         │  │
│  └────────────────────────────────┘  │
│                                      │
│  Sun 6 Sep · 5:00 PM · [venue]       │
└──────────────────────────────────────┘
```

Tapping CLAIM opens a confirmation sheet — *"Is the waiter with you right now? Your mocktail can only be claimed once."* — with **Not yet** as the visually dominant option and **Yes, claim it** secondary. This asymmetry is deliberate: the expensive mistake is claiming too early, so make the safe answer the easy one.

**D · `claimed`, window open — the screen the waiter reads**

```
┌──────────────────────────────────────┐
│██████████████████████████████████████│
│█                                    █│
│█            MOCKTAIL                █│
│█                                    █│
│█               41                   █│  ← ≥96px, white on green
│█                                    █│
│█        Vaibhav Tiwari              █│
│█                                    █│
│█            ⏱ 0:47                  █│  ← counts down, live
│██████████████████████████████████████│
└──────────────────────────────────────┘
```

- Full-bleed green. Request `navigator.wakeLock` so it survives the walk to the counter; degrade silently where unsupported.
- The countdown is the anti-screenshot measure. A screenshot freezes; the live page does not. Staff are not asked to check it — their rule is only *green means serve* — but it makes a forwarded screenshot trivially identifiable if it ever matters.
- Compute remaining time from the server's `until`, not from a client timer started at tap. Phone clocks are wrong more often than you would like.
- When it expires, transition **on the page, without a reload**, to the spent state: grey, *"Claimed at 6:42 PM"*, no large number anywhere in the DOM.

**Void states** (`refunded` / `rejected`): plain grey card, *"This pass is no longer valid."* No coupon number in the DOM at all.

### 11.4 `/admin/floor`

One screen the organisers keep open during the jam. Three jobs:

```
┌──────────────────────────────────────┐
│ FLOOR                    ● 47/50     │
│ [ 🔍 search name / coupon / ····4 ]  │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Vaibhav Tiwari      coupon 41    │ │
│ │ ✓ claimed 6:42 PM                │ │
│ ├──────────────────────────────────┤ │
│ │ Ananya Sharma       coupon 42    │ │
│ │        [ CLAIM FOR THEM ]        │ │  ← [R8] phone dead / no signal
│ └──────────────────────────────────┘ │
│                                      │
│ [ + WALK-IN · ₹350 ]                 │  ← [R12] name, phone, done
└──────────────────────────────────────┘
```

1. **Claim on someone's behalf** when their phone is dead or has no signal. Same one-time server action; records `claim_by='admin'`.
2. **Register a walk-in at ₹350** in under 30 seconds — name, phone, show them the QR, confirm. An extra person becomes revenue instead of an argument.
3. **Reset an accidental claim**, two taps, from the search result.

Search runs against a locally cached roster, never a round-trip per keystroke. Cache to `localStorage` on load; if the fetch fails but a cache exists, use it and show its age.

### 11.5 `/admin/money`

```
CONFIRMED + CLAIMED   50   collected           ₹15,000
COMMITTED TO CAFE     50 × ₹250                ₹12,500   ← [R10] flat, agreed
COMMUNITY FUND                                  ₹2,500
   of which walk-ins   1 × ₹100 extra            ₹100

DRINKS CLAIMED        47
NOT CLAIMED            3   (paid, didn't drink)

⚠ Cafe reports 54 mocktails → 7 served without a green screen.
   Raise it with the cafe. Not a charge to the community.

                        [ Copy cafe summary ]
```

**R10 is the line to get right, and it is counter-intuitive:** the cafe is paid the committed headcount, not the claim count. Claims are a leak detector. Display the discrepancy row prominently, with an input for the cafe's own count, because that number is the entire point of tracking claims.

"Copy cafe summary" puts plain text on the clipboard for WhatsApp:

```
On Mic Jam — Sun 6 Sep
Committed headcount: 50
Rate: ₹250 per head (entry + 1 mocktail)
Total: ₹12,500 — paying by UPI now.

Our records: 47 mocktails claimed.
Please confirm your count matches.
```

### 11.6 `/admin/verify`

One textarea, one button, four buckets: **confirmed** (with coupon range and emails sent), **submitted but no match** (chase), **registered, never paid** (drop), **over capacity** (refund).

Above the buckets, the **total check** from §12.2, always visible:

```
Expected   50 × ₹300  =  ₹15,000
In paste                 ₹14,750
                         ─────────
⚠ Short by ₹250 — someone edited the amount in their UPI app.
```

Green tick when it balances, amber warning when it does not. Do not block confirmation on a mismatch; a short payment is a person to talk to, not a system error.

Re-running the same paste must be safe and produce zero confirmations the second time. Say so in the UI — *"Safe to paste again; already-confirmed people are skipped."* An admin unsure whether the first click worked will click again, and the app has to be right about that.

---

## 12. The three hard parts

### 12.1 UPI deep link — why there is no gateway

Zero cost is only achievable by not using one. RBI mandates 0% MDR on bank-to-bank UPI; the ~2% a gateway charges is its *platform* fee, not a UPI cost. Instamojo's Lite plan (5% + ₹3 + 18% GST ≈ ₹18 on ₹300) would take about **₹900 of a ₹2,500 fund** — 36% of the community's money, to solve a problem worth less than that. We pay nothing and reconcile ourselves in §12.2.

```ts
export function upiLink(o: { vpa:string; payeeName:string; amount:number; note:string }) {
  const p = new URLSearchParams({
    pa: o.vpa, pn: o.payeeName, am: o.amount.toFixed(2),
    cu: "INR", tn: o.note, tr: o.note,
  });
  return `upi://pay?${p.toString()}`;
}
```

- **`tn` (the note) is best-effort and must never be used for matching.** Some apps let the user edit it, some strip it, some truncate it. Matching is by UTR, only and always. Reconciling on the transaction note is the single most likely way to get this app wrong.
- `am` must be a bare decimal — `300.00`. No symbol, no separator.
- `pn` short and alphanumeric; some apps mishandle punctuation.
- **Always render the QR as well, on every device.** `upi://` does not resolve in every mobile browser context — in-app browsers inside Instagram and WhatsApp are especially unreliable, and that is exactly where these users come from. The QR is a co-equal path, not a desktop fallback.
- **`am` is a suggestion, not a lock.** Some UPI apps show the pre-filled amount as read-only; others let the payer edit it before confirming. This varies by the *payer's app*, not by your VPA, so a merchant handle does not fix it. Test with real GPay, PhonePe and Paytm before going live, and regardless of the result, implement the total check in §12.2 — a payer who edits ₹300 to ₹250 produces a valid UTR that matches cleanly.

Use a **PhonePe / Paytm for Business merchant QR, not a personal UPI ID.** Personal accounts have inbound limits, banks flag ~50 incoming transfers from strangers several times a month, and decisively: merchant accounts give you an exportable transaction history with UTRs, which is the input to §12.2. Without that export there is no reconciliation.

### 12.2 UTR matching — the gateway replacement

```ts
const refs = [...new Set(raw.match(/\b\d{12}\b/g) ?? [])];
```

That is the whole algorithm, and its dumbness is the feature.

- **Do not parse the statement as CSV, and do not map columns.** Export formats change without notice and a column-aware parser breaks silently on a Saturday night. Regex over raw text survives format changes, screen copy-paste, PDF dumps, and a WhatsApp forward.
- 12 digits is the UPI RRN standard; `\b` prevents matching a fragment of a longer account number.
- Cap the paste at 200 KB.
- **Do not parse per-transaction amounts** in v1 — but **do check the total.** The `am` parameter in a UPI deep link is *not* reliably locked: some UPI apps present it read-only, others let the payer edit it before confirming, and the behaviour is a property of the payer's app, not of your VPA. A payer can therefore edit ₹300 down to ₹250, get a perfectly valid UTR, and match cleanly.

  The cheap defence is a single sum, shown on the verify screen: `confirmed × price` against the sum of every amount appearing next to a matched UTR in the paste. If they differ, show the gap in rupees and stop short of auto-confirming — a human then finds the short payer in thirty seconds. This catches the whole class of underpayment without a per-transaction amount parser, which would reintroduce the CSV-format fragility this section exists to avoid.
- Idempotency comes from `confirm_attendee` returning early on `confirmed`/`claimed`. Pasting the same statement five times must produce identical state. Test it.

### 12.3 The claim, under real conditions

The claim happens in a noisy cafe with a waiter waiting. Three failure modes, all handled:

**Network.** The attendee's phone may have no signal. Do **not** build an offline queue for claims — a claim must be authoritative at the moment it is granted, and an optimistic local claim that later fails on the server hands out a drink you cannot account for. Instead: the request is small and fast, show a spinner with a 6-second timeout, and on failure show *"Ask an organiser to claim it for you"* — which routes to `/admin/floor` and **R8**. One reliable path plus one human fallback beats two unreliable paths.

**Accidental early tap.** Handled by the confirm sheet in §11.3 and by `reset_claim`.

**Double-tap.** Handled server-side by `FOR UPDATE`. Verified: five concurrent calls yield one `ok` and four `active`, one claim, one immutable timestamp.

Deliberately *not* built: any dependency on cafe wifi, any device for the cafe, any offline claim path.

---

## 13. Email

Resend free tier — 3,000/month, 100/day, against ~200/month here. Sent on entry to `confirmed`.

**R9 is absolute:** wrap the send in try/catch, set `emailed_at` only on success, never let a failure propagate into the confirmation. A dead email provider must not stop 50 people being confirmed. `POST /api/admin/email/retry` re-sends to everyone `confirmed` with `emailed_at IS NULL`. Send in a loop with a small delay, not 50 parallel requests — a burst is the one thing that trips a free tier.

Subject: `Your On Mic pass — Sun 6 Sep — coupon #41`

```
Confirmed. See you Sunday.

    COUPON  41

Vaibhav Tiwari · OM0709-K3F7
Sunday 6 September · 5:00 PM · [venue]

₹300 paid  =  ₹250 entry + 1 mocktail (cafe)
              ₹50 community fund — mics, cables,
              and booking the next venue

>> OPEN YOUR TICKET  [button → /pass/OM0709-K3F7]

How the mocktail works:

Open your ticket link when the waiter comes to your
table, and tap CLAIM. Your screen turns GREEN with
your number. That's what the staff serve on.

Only tap it when the waiter is actually with you —
it can only be claimed once.

Lost this email? Go to onmic.vercel.app/find and
enter your phone number.

— On Mic Community
```

The price breakdown in the email is **§3.5**, not decoration. Deliverability: `onboarding@resend.dev` lands in spam — verify a domain in Resend (free, three DNS records) on a domain the client already owns.

**The email is a receipt, not the ticket.** The ticket is the live page. Anything that requires the email to have arrived is a bug, which is why `/find` exists.

---

## 14. Security model

The threat is not a hacker. It is a good-natured community member finding a free drink, plus ordinary human error around ₹15,000 of other people's money. Build proportionally.

| # | Risk | Control |
|---|---|---|
| S1 | Anon key leaks into the bundle | RLS on, zero policies; service-role key server-side only |
| S2 | Guessing a pass URL | Random 4-char code from a 26-char alphabet; nothing sensitive on the page |
| S3 | Reusing a friend's UTR | DB unique index `(event_id, utr)` — **R4** |
| S4 | Forwarding a ticket screenshot | Grey until claimed — **R7**; live countdown; one claim ever — **R6** |
| S5 | Claiming twice / double-tap | `FOR UPDATE` row lock in `claim_drink` |
| S6 | Double coupon under concurrency | `FOR UPDATE` on the event row in `confirm_attendee` |
| S7 | Brute-forcing the passcode | 10/10min/IP, `timingSafeEqual`, HMAC-signed cookie |
| S8 | A new admin route ships unprotected | Cookie check in `middleware.ts` |
| S9 | Disputed manual actions | Append-only `audit_log`; mandatory reason on refund/reject/reset |
| S10 | 50 phone numbers on a volunteer's phone | Roster returns `phone4` only |
| S11 | Bank statement retained on the server | Never persist the raw paste; log counts only |

Do not build 2FA, per-admin accounts, password reset, or email verification. Two admins share one passcode; anything more is unjustified surface area.

---

## 15. Edge cases — required behaviour

Not complete until every row behaves as stated.

| # | Situation | Required behaviour |
|---|---|---|
| E1 | Same phone registers twice | Return the **existing** pass, `200`. No duplicate, no error |
| E2 | Paid but never submitted a UTR | `no_utr` bucket; admin can confirm manually from the statement |
| E3 | Submitted a UTR that never appears | `pending` bucket. Admin chooses. Never auto-rejected |
| E4 | Mistyped UTR, fixed later | Re-submit overwrites while before `closes_at` |
| E5 | Two people submit the same UTR | Second gets `409 utr_taken` with a message to contact organisers |
| E6 | Paid ₹250 instead of ₹300 (edited the amount in their UPI app) | UTR matches cleanly, so per-row detection is not attempted. The **total check** in §12.2 surfaces the gap in rupees; admin finds the short payer and confirms with a note or rejects |
| E7 | 53 pay for 50 seats | Earliest `utr_at` wins; last three flagged `over_capacity` for manual refund |
| E8 | Prepaid, did not attend | Stays `confirmed`. Cafe still paid — **R10**. Their ₹50 stays with the fund |
| E9 | **Attendee brings an extra friend** | Friend has no pass → no green screen → no mocktail. Admin registers them at ₹350 in 30s — **R12** |
| E10 | Attendee taps CLAIM by accident | Confirm sheet should prevent it; if not, admin `reset_claim`, two taps, logged |
| E11 | Attendee double-taps CLAIM | One claim. Repeats return `active` with the same countdown |
| E12 | Closes and re-opens the page mid-window | Same claim, same countdown, computed from the server's `until` |
| E13 | Window expires before the waiter arrives | Pass is spent. Admin `reset_claim` — the only correct remedy |
| E14 | Attendee's phone is dead or has no signal | Admin claims for them from `/admin/floor` — **R8** |
| E15 | Shows a screenshot of someone else's green screen | Countdown is frozen; coupon belongs to another name. Never in the DOM for a void pass |
| E16 | Cafe serves someone with no green screen | Comes out of the **cafe's** margin, not the community's — **R10**, §3.4. Surfaced in §11.5 |
| E17 | Email never arrives | `/find` by phone. Email is never on the critical path |
| E18 | Admin pastes the same statement twice | Zero re-confirmed; UI states it is safe |
| E19 | Statement from the wrong week | Only UTRs of *this* event's `submitted` attendees can match; foreign refs silently ignored |
| E20 | Seat transferred to a friend | Admin `PATCH`es name/phone/email. Pass and coupon unchanged |
| E21 | Cancels before cutoff | Refunded by hand over UPI; marked `refunded` with a reason. Coupon retired, not reused |
| E22 | No open event | Public routes → `/closed`. Admin routes still work |
| E23 | UTR submitted after `closes_at` | `409 closed`, directs them to the organisers |

---

## 16. Acceptance tests

**Data integrity**

1. Same phone registered 5× concurrently → 1 row, 5 identical `pass_code` responses.
2. Two attendees, same UTR → second `409 utr_taken`; one row in the DB.
3. 10 concurrent `confirm_attendee` → coupons 1..10, no duplicates, no gaps.
4. `capacity=50`, 53 payers → 50 confirmed, 3 `over_capacity`, ordered by `utr_at`. ✅ *verified*
5. Refund a confirmed attendee → cannot claim; coupon retained, not recycled. ✅ *verified*

**Reconciliation**

6. 65 seeded, 58 with UTRs; paste those 58 plus 200 unrelated 12-digit numbers → exactly 58 confirmed, coupons 1..58. ✅ *verified*
7. Paste the identical statement again → 0 confirmed, no duplicate emails. ✅ *verified*
8. UTRs formatted `UPI/412345678901/ONMIC` → all matched. ✅ *verified*
9. 300 KB paste → rejected with a clear message.

**The claim**

10. First claim → `ok`, window open, coupon returned. ✅ *verified*
11. Claim again inside the window → `active`, same `claimed_at`, still one claimed row. ✅ *verified*
12. Claim after the window expires → `already`, original timestamp preserved. ✅ *verified*
13. Unpaid attendee claims → `not_paid`. ✅ *verified*
14. Unknown pass code claims → `not_found`. ✅ *verified*
15. Refunded attendee claims → `void`. ✅ *verified*
16. **5 concurrent claims on one pass → exactly one claim, one immutable timestamp.** ✅ *verified*
17. `reset_claim` then claim again → succeeds; `claim_by` recorded. ✅ *verified*
18. Walk-in confirmed at `door_price` → `amount_paid = 350`, can claim. ✅ *verified*
19. 50 confirmed, 47 claimed → collected ₹15,000, cafe ₹12,500, fund ₹2,500. ✅ *verified*

**UI**

20. `confirmed` ticket → coupon < 40px, grey, labelled inactive.
21. Tap CLAIM → full green, coupon ≥ 96px, countdown ticking from the server's `until`.
22. Window expires → transitions to grey **without a reload**; no large number left in the DOM.
23. `refunded` ticket → no coupon number in the rendered HTML at all. Check the HTML, not just the pixels.
24. Registration page and email both render the ₹250 / ₹50 split from `events` — **§3.5**.

**Failure modes**

25. Unset `RESEND_API_KEY`, verify 50 → all confirmed, all `emailed_at` null, no 500s.
26. Break the key, verify, fix it, hit `/api/admin/email/retry` → all 50 receive email.
27. Every `/api/admin/*` with no cookie → `401`, nothing leaked.
28. `/api/admin/login` 20× wrong → rate limited after 10.

Tests marked ✅ are implemented in `supabase/tests.sql` and pass against PostgreSQL 16.

---

## 17. Deployment runbook

1. **Supabase** → new project, free tier, Mumbai or Singapore. Copy the URL and `service_role` key.
2. SQL Editor → run §7 then §8. Then run `supabase/tests.sql` and confirm every line reads PASS.
3. Insert the event:

```sql
insert into events (name, event_date, venue, price, door_price,
                    cafe_share, fund_share, capacity, claim_seconds,
                    upi_vpa, upi_name, closes_at)
values ('On Mic Jam', '2026-09-06', '[venue]', 300, 350,
        250, 50, 50, 90,
        'onmic@ybl', 'On Mic Community',
        '2026-09-05 21:00:00+05:30');
```

4. **Vercel** → import repo → set every variable from §6 → deploy.
5. **Resend** (optional) → verify a domain → 3 DNS records → set the two vars.
6. **Smoke test on a real phone, on mobile data, not office wifi:**
   - register → the UPI button opens a real UPI app
   - **pay ₹1 to the real VPA** and confirm the amount is pre-filled and not editable
   - submit the real UTR → paste the real statement → confirmed, coupon assigned, email received
   - tap CLAIM → green, countdown runs, expires to grey with no reload
   - claim again → refused
   - `/admin/floor` → claim for someone else; register a walk-in; reset a claim
7. **Brief the cafe in person** using Appendix B. Not over WhatsApp — walk in and show them a green screen on your phone.
8. Post the registration URL to the community.

**Rollback:** the app is stateless; redeploy any prior Vercel build. Data is untouched by deploys.

**Timeline.** Do not ship v1 into a live event days after starting. The first run of a new payment rule should not also be the first run of new code — if both are new and something breaks, you cannot tell which broke. For the immediate Sunday, run the manual fallback in Appendix A; go live with the app once it has a full week of testing behind it.

---

## 18. Explicitly out of scope

- Any payment gateway integration — violates **R13**
- Automatic bank-feed or webhook payment detection — requires a paid gateway
- In-app refunds — humans, over UPI, **R11**
- Printing, badges, wristbands, stamps — client has ruled out spend, and the claim gate makes them unnecessary
- Offline claim queue — deliberately excluded, §12.3
- A door checkpoint — replaced by the claim
- WhatsApp notifications — the Business API is paid
- Per-admin accounts, 2FA, password reset
- Multiple simultaneous open events
- Native apps, PWA install prompts, push notifications
- Seat maps, tiered pricing, promo codes

A request for any of these is a v2 conversation with a cost attached, not a scope tweak.

---

## Appendix A — copy deck

### The announcement — post it with the split visible

> **Jam this Sunday — booking is open, and two things are changing.**
>
> **₹300 per head, prepaid.** Here's exactly where it goes:
> • **₹250** to the cafe — entry + 1 mocktail
> • **₹50** to the community fund — mics, cables, and the advance for the next venue
>
> Book here: [link]
>
> **Why prepaid:** for the last few jams some people have left without paying and the rest of us covered it. Nobody wants to be the person asking for money while a set is on.
>
> **Refunds:** cancel any time before **Saturday 9 PM** for a full ₹300 back, no questions. After that, pass your seat to a friend — just tell us the name.
>
> **Bringing someone?** They need their own booking. Walk-ins on the day are ₹350, so it's worth booking them in now.
>
> 50 seats. We confirm the number to the cafe on Saturday night, and booking closes **Saturday 9 PM**.
>
> Lost your link? [link]/find

Post the split. It is already how Aditya announced the August jam, it is what the fund is for, and a discovered margin costs far more trust than ₹2,500 is worth.

### Cafe staff briefing — the entire training

> "Everyone at the jam has prepaid for one mocktail. When they order, they'll show you a **green screen with a number on it**. Green screen, one mocktail. No green screen, please send them to us — don't serve it, because that one's on you."

That last clause is the whole of §3.4 in one sentence. Say it.

### If someone objects to prepaying

> "Totally fair. Full refund any time before Saturday 9 PM, so you're not locked in. We've just been covering no-shows out of pocket and it isn't sustainable."

### If someone asks about the ₹50

> "Cafe takes ₹250 for entry and the mocktail, ₹50 goes to the community fund — that's what pays for the mics and cables, and the advance when we book the next place. It's in the booking page too."

### Manual fallback — running this Sunday with no app

1. Google Form: name, phone, UPI reference number. Post the ₹300 / ₹250 / ₹50 split in the form description.
2. Saturday 9 PM: export the form to Sheets, export your PhonePe/Paytm Business history, sort both by reference number, and match. Anyone unmatched gets one WhatsApp message.
3. Confirmed list → a Sheet on your phone, sorted by name, with a **Drink** column.
4. During the jam: one organiser walks the room **once** with the waiter, ticks names as drinks go out. Twenty minutes of attention, not two hours.
5. Extra people: ₹350 on the spot by QR, added to the sheet.
6. Tell the cafe the committed headcount on Saturday night and pay that flat.

This recovers the money this week. The app removes the twenty minutes.

---

## Appendix B — the cafe agreement

Frame it as a favour to them, because it is one. Today they run ~50 separate transactions, deal with confusion at the counter, and have no idea how many to prep. You are offering **one confirmed headcount on Saturday night and one payment at the end.**

Agree exactly four things:

1. **A flat committed headcount**, confirmed Saturday 10 PM. You pay `headcount × ₹250` on the night regardless of who actually shows up. This is the important one — it is what makes an over-served drink their cost, not yours (§3.4).
2. **Green screen = one mocktail.** No green screen, send them to the organisers. One sentence, no device, no training.
3. **They keep their own count**, shared at the end, so the two numbers can be compared.
4. **Walk-ins allowed up to +8**, confirmed by 6:30 PM, at the same ₹250.

Give in return: a single UPI payment on the night with no chasing, and the cafe tagged in the community's Instagram posts.

**What not to do:** do not ask the cafe to track who has paid, hold a device, learn a screen, or take responsibility for verification. The last two jams went wrong partly because staff got pulled into the payment problem. Their entire involvement is reading one colour.

---

*End of specification. Questions to Vaibhav before writing code, not after.*
