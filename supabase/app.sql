-- ===========================================================================
-- On Mic Jam — application-layer functions.  Spec v1.1.
--
-- Run AFTER handoff/supabase/schema.sql. Safe to re-run.
--
-- Why these exist: §8 says "the API layer must never UPDATE attendees SET
-- state = ... directly". This file extends that discipline to every read and
-- write, so the API layer only ever makes rpc() calls. That keeps concurrency
-- and state-guard logic in one place, and it means the local Postgres driver
-- and the production Supabase driver run the same SQL rather than two
-- hand-written query sets that can drift apart.
--
-- Convention: every function returns json so both drivers see one scalar.
-- Errors come back as {"error":"<machine_code>"}; the human sentence lives in
-- src/lib/messages.ts because §10 says the client renders `message` verbatim.
-- ===========================================================================

-- Drop every app_* function first. §8.5 warns that a RETURNS TABLE parameter
-- silently shadows a column; an orphaned *overload* is the same class of
-- silent wrong answer — src/lib/db.ts looks a function up by name, so two
-- signatures of app_save_event would make which one runs a coin toss.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'app\_%'
  loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The §11 screens show a start time ("Sun 6 Sep · 5:00 PM") but §7 has no
-- column for it. Added here rather than by editing the handoff schema: nullable,
-- additive, and free text so the admin types "5:00 PM" without timezone maths.
alter table events add column if not exists start_time text;

-- ---------------------------------------------------------------------------
-- pass_code: OM + DDMM + '-' + 4 chars from an alphabet with no 0/O, 1/I/L,
-- 5/S, 2/Z, 8/B. It gets read aloud in a noisy cafe. 26^4 = 456,976.
create or replace function app_gen_pass(p_date date)
returns text
language sql
volatile
as $$
  select 'OM' || to_char(p_date, 'DDMM') || '-' ||
         string_agg(substr('ACDEFGHJKLMNPQRTUVWXY34679',
                           1 + floor(random() * 26)::int, 1), '')
  from generate_series(1, 4);
$$;

-- ---------------------------------------------------------------------------
-- Append-only audit trail helper. [S9]
create or replace function app_audit(
  p_event uuid, p_attendee uuid, p_action text, p_detail jsonb, p_actor text)
returns void
language sql
as $$
  insert into audit_log (event_id, attendee_id, action, detail, actor)
  values (p_event, p_attendee, p_action, p_detail, p_actor);
$$;

-- ---------------------------------------------------------------------------
-- The event the PUBLIC pages act on: status = 'open'. [E22]
create or replace function app_public_event_id()
returns uuid
language sql
stable
as $$
  select id from events where status = 'open' limit 1;
$$;

-- The event ADMIN pages act on. Registration closes on Saturday night while
-- the jam itself — and therefore every claim — happens on Sunday, so the admin
-- screens must not lose the event the moment registration shuts.
create or replace function app_current_event_id()
returns uuid
language sql
stable
as $$
  select id from events
   where status in ('open', 'closed')
   order by (status = 'open') desc, event_date desc, created_at desc
   limit 1;
$$;

-- p_public gates the venue. "Mystery is the product": the address stays hidden
-- until it drops, and that is the strongest conversion device on the page — the
-- confirmed screen has a reason to be re-opened before the jam.
--
-- The design system is explicit that this is not a CSS effect: the address is
-- never sent to the client before the unlock — not hidden with a filter, not in
-- the HTML, not in the JSON payload. So it is withheld here, at the source.
--
-- It unlocks at closes_at, which is already the "Saturday evening" the copy
-- promises: registration shuts and the address goes out in the same moment.
create or replace function app_event_json(p_event uuid, p_public boolean default false)
returns json
language sql
stable
as $$
  select json_build_object(
    'id', e.id, 'name', e.name, 'event_date', e.event_date,
    'start_time', e.start_time,
    'venue', case when coalesce(p_public, false) and now() < e.closes_at
                  then null else e.venue end,
    'venue_locked', (coalesce(p_public, false) and now() < e.closes_at
                     and e.venue is not null),
    'venue_unlocks_at', e.closes_at,
    'price', e.price, 'door_price', e.door_price,
    'cafe_share', e.cafe_share, 'fund_share', e.fund_share,
    'capacity', e.capacity, 'claim_seconds', e.claim_seconds,
    'upi_vpa', e.upi_vpa, 'upi_name', e.upi_name,
    'closes_at', e.closes_at, 'status', e.status,
    'is_open', (e.status = 'open' and now() < e.closes_at),
    'confirmed_count', (select count(*) from attendees a
                         where a.event_id = e.id
                           and a.state in ('confirmed', 'claimed'))
  )
  from events e where e.id = p_event;
$$;

-- Used by /, /pass, /find, /closed. Returns null when no event is open.
-- Public: the venue is withheld until it drops.
create or replace function app_public_event()
returns json
language sql
stable
as $$
  select app_event_json(app_public_event_id(), true);
$$;

create or replace function app_current_event()
returns json
language sql
stable
as $$
  select app_event_json(app_current_event_id());
$$;

-- ---------------------------------------------------------------------------
-- §10.1 POST /api/register
-- Format validation happens in TS; everything that has to be atomic is here.
-- [E1] A repeat phone is someone who lost their link: hand back the existing
-- pass with success. Doing this in SQL closes the race that an app-level
-- "select then insert" would leave open under concurrent submits.
create or replace function app_register(
  p_name text, p_phone text, p_email text, p_instagram text)
returns json
language plpgsql
as $$
declare
  v_event   uuid;
  v_date    date;
  v_closes  timestamptz;
  v_pass    text;
  v_id      uuid;
  v_conflict text;
  i         int;
begin
  select id, event_date, closes_at into v_event, v_date, v_closes
    from events where status = 'open' limit 1;

  if v_event is null then                                        -- [E22]
    return json_build_object('error', 'no_event');
  end if;

  if now() >= v_closes then                                      -- [R3]
    return json_build_object('error', 'closed');
  end if;

  for i in 1..12 loop
    begin
      v_pass := app_gen_pass(v_date);
      insert into attendees (event_id, pass_code, name, phone, email, instagram)
      values (v_event, v_pass, p_name, p_phone,
              nullif(p_email, ''), nullif(p_instagram, ''))
      returning id into v_id;

      perform app_audit(v_event, v_id, 'register',
                        jsonb_build_object('phone', p_phone), 'attendee');

      return json_build_object('pass_code', v_pass,
                               'url', '/pass/' || v_pass,
                               'existing', false);
    exception when unique_violation then
      get stacked diagnostics v_conflict = constraint_name;
      if v_conflict = 'attendees_event_phone_idx' then           -- [E1]
        select id, pass_code into v_id, v_pass
          from attendees where event_id = v_event and phone = p_phone;
        return json_build_object('pass_code', v_pass,
                                 'url', '/pass/' || v_pass,
                                 'existing', true);
      end if;
      -- otherwise it was a pass_code collision: loop and mint another
    end;
  end loop;

  return json_build_object('error', 'pass_collision');
end;
$$;

-- ---------------------------------------------------------------------------
-- §10.2 POST /api/utr. Checks run in the order the spec lists them.
create or replace function app_submit_utr(p_pass text, p_utr text)
returns json
language plpgsql
as $$
declare
  v_event  uuid;
  v_closes timestamptz;
  v_id     uuid;
  v_state  text;
  v_name   text;
  v_email  text;
begin
  select id, closes_at into v_event, v_closes
    from events where status = 'open' limit 1;

  if v_event is null then
    return json_build_object('error', 'no_event');
  end if;

  select id, state, name, email into v_id, v_state, v_name, v_email
    from attendees where event_id = v_event and pass_code = p_pass;

  if v_id is null then
    return json_build_object('error', 'not_found');
  end if;

  if v_state in ('confirmed', 'claimed') then
    return json_build_object('error', 'already_confirmed');
  end if;

  if v_state in ('refunded', 'rejected') then
    return json_build_object('error', 'void');
  end if;

  if now() >= v_closes then                                      -- [E23]
    return json_build_object('error', 'closed');
  end if;

  begin
    -- [E4] re-submitting from 'submitted' overwrites: people mistype
    update attendees
       set utr = p_utr, utr_at = now(), state = 'submitted'
     where id = v_id;
  exception when unique_violation then                           -- [R4] [E5]
    return json_build_object('error', 'utr_taken');
  end;

  perform app_audit(v_event, v_id, 'utr',
                    jsonb_build_object('utr', p_utr), 'attendee');

  -- Everything the API layer needs to acknowledge the payment by email without
  -- a second round trip. Attendee-facing, so the event is the public one.
  return json_build_object('state', 'submitted',
                           'name', v_name, 'email', v_email,
                           'pass', p_pass, 'utr', p_utr,
                           'event', app_event_json(v_event, true));
end;
$$;

-- ---------------------------------------------------------------------------
-- §10.4 (POST /api/find)
create or replace function app_find(p_phone text)
returns json
language plpgsql
as $$
declare v_pass text;
begin
  select a.pass_code into v_pass
    from attendees a
   where a.event_id = app_public_event_id() and a.phone = p_phone;

  if v_pass is null then
    return json_build_object('error', 'not_found');
  end if;
  return json_build_object('url', '/pass/' || v_pass, 'pass_code', v_pass);
end;
$$;

-- ---------------------------------------------------------------------------
-- The ticket page. §11.2 / §11.3 / [R7] / acceptance test 23.
--
-- coupon_no is emitted ONLY for confirmed and claimed. A refunded or rejected
-- pass must not have the number anywhere in the rendered HTML, so it is
-- withheld at the source rather than hidden with CSS.
--
-- `now` is the server clock. §11.3 requires the countdown to be computed from
-- the server's `until`; a phone whose clock is three minutes fast would
-- otherwise show a green window that has already closed, or vice versa. The
-- client takes (until - now) as the true remaining time and ticks from there.
create or replace function app_pass_view(p_pass text)
returns json
language sql
stable
as $$
  select json_build_object(
    'event', app_event_json(a.event_id, true),
    'now', now(),
    'attendee', json_build_object(
      'pass_code', a.pass_code,
      'name', a.name,
      'state', a.state,
      'coupon_no', case when a.state in ('confirmed', 'claimed')
                        then a.coupon_no else null end,
      'utr', a.utr,
      'claimed_at', a.claimed_at,
      'claim_until', a.claim_until,
      'confirmed_at', a.confirmed_at
    )
  )
  from attendees a
  where a.pass_code = p_pass
    and a.event_id in (select id from events where status in ('open','closed'))
  limit 1;
$$;

-- §10.4 GET /api/pass/[code] — the poll target. Same coupon suppression rule.
-- The ticket polls this while `confirmed` so that an admin claiming on the
-- attendee's behalf (§11.4, [R8]) still turns THEIR phone green.
create or replace function app_pass_state(p_pass text)
returns json
language sql
stable
as $$
  select json_build_object(
    'state', a.state,
    'name', a.name,
    'coupon', case when a.state in ('confirmed', 'claimed')
                   then a.coupon_no else null end,
    'claimed_at', a.claimed_at,
    'claim_until', a.claim_until,
    'now', now(),
    'event', json_build_object(
      'name', e.name, 'date', e.event_date, 'start_time', e.start_time,
      'venue', case when now() < e.closes_at then null else e.venue end,
      'venue_locked', (now() < e.closes_at and e.venue is not null),
      'venue_unlocks_at', e.closes_at,
      'price', e.price,
      'cafe_share', e.cafe_share, 'fund_share', e.fund_share)
  )
  from attendees a
  join events e on e.id = a.event_id
  where a.pass_code = p_pass and e.status in ('open','closed')
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- §10.3 POST /api/claim — the only gate between a person and a mocktail.
--
-- A thin wrapper. §10.3: "Put no business logic in this handler — no 'has it
-- been claimed' check, no timestamp arithmetic." All of it is in claim_drink,
-- under a row lock, where concurrency is actually handled. One audit row per
-- call, carrying the reason. [R6] [R8] [S5]
create or replace function app_claim(p_pass text, p_by text)
returns json
language plpgsql
as $$
declare
  v_event uuid;
  v_id    uuid;
  r       record;
begin
  v_event := app_current_event_id();
  if v_event is null then
    return json_build_object('ok', false, 'reason', 'not_found', 'now', now());
  end if;

  select * into r from claim_drink(v_event, p_pass, p_by);

  select id into v_id from attendees
   where event_id = v_event and pass_code = p_pass;

  perform app_audit(v_event, v_id, 'claim',
    jsonb_build_object('pass', p_pass, 'reason', r.out_reason, 'by', p_by),
    case when p_by = 'admin' then 'admin' else 'attendee' end);

  return json_build_object(
    'ok', r.out_ok, 'reason', r.out_reason, 'name', r.out_name,
    'coupon', r.out_coupon, 'until', r.out_until,
    'claimed_at', r.out_claimed_at, 'now', now());
end;
$$;

-- [R8] the admin path — an attendee's phone may be dead or offline, and there
-- must always be a way through that does not involve arguing with a waiter.
create or replace function app_admin_claim(p_id uuid)
returns json
language plpgsql
as $$
declare v_pass text;
begin
  select pass_code into v_pass from attendees
   where id = p_id and event_id = app_current_event_id();
  if v_pass is null then
    return json_build_object('ok', false, 'reason', 'not_found', 'now', now());
  end if;
  return app_claim(v_pass, 'admin');
end;
$$;

-- §8.4 — exists for exactly one situation: someone taps CLAIM by accident
-- before the waiter arrives. Without it that person loses their drink and you
-- have an argument at the table. Two taps from /admin/floor and /admin/people,
-- and always logged with a reason. [E10] [E13] [S9]
create or replace function app_reset_claim(p_id uuid, p_reason text)
returns json
language plpgsql
as $$
declare v_event uuid; v_result text;
begin
  select event_id into v_event from attendees where id = p_id;
  if v_event is null then
    return json_build_object('error', 'not_found');
  end if;

  v_result := reset_claim(p_id);

  perform app_audit(v_event, p_id, 'reset_claim',
                    jsonb_build_object('result', v_result, 'reason', p_reason), 'admin');

  if v_result = 'noop' then
    return json_build_object('error', 'bad_state');
  end if;
  return json_build_object('status', v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- §10.6 POST /api/admin/walkin — [R12] walk-ins are not refused, they are
-- priced. One screen, under 30 seconds of typing, because R12 only works if
-- using it is faster than arguing.
--
-- Deliberately uses app_current_event_id(): a walk-in arrives on Sunday, long
-- after Saturday's registration cutoff, so closes_at must not apply here.
create or replace function app_walkin(p_name text, p_phone text, p_email text)
returns json
language plpgsql
as $$
declare
  v_event    uuid;
  v_date     date;
  v_door     int;
  v_pass     text;
  v_id       uuid;
  v_conflict text;
  r          record;
  i          int;
begin
  v_event := app_current_event_id();
  if v_event is null then
    return json_build_object('error', 'no_event');
  end if;
  select event_date, door_price into v_date, v_door from events where id = v_event;

  <<mint>>
  for i in 1..12 loop
    begin
      v_pass := app_gen_pass(v_date);
      insert into attendees (event_id, pass_code, name, phone, email, is_walkin)
      values (v_event, v_pass, p_name, p_phone, nullif(p_email, ''), true)
      returning id into v_id;
      exit mint;
    exception when unique_violation then
      get stacked diagnostics v_conflict = constraint_name;
      if v_conflict = 'attendees_event_phone_idx' then
        -- They registered earlier and never paid, and are now standing at the
        -- table. Price them at the door on the row they already have rather
        -- than stranding the volunteer on a duplicate-phone error.
        select id, pass_code into v_id, v_pass
          from attendees where event_id = v_event and phone = p_phone;
        update attendees set is_walkin = true
         where id = v_id and state in ('registered', 'submitted');
        exit mint;
      end if;
      -- otherwise a pass_code collision: loop and mint another
    end;
  end loop;

  if v_id is null then
    return json_build_object('error', 'pass_collision');
  end if;

  select * into r from confirm_attendee(v_id, 'manual', v_door);

  perform app_audit(v_event, v_id, 'walkin',
    jsonb_build_object('status', r.out_status, 'coupon', r.out_coupon,
                       'amount', v_door), 'admin');

  -- [R2] capacity is enforced in one place, the database. The remedy is to
  -- raise the capacity (Appendix B agrees walk-ins up to +8), not to bypass it.
  if r.out_status = 'over_capacity' then
    return json_build_object('error', 'over_capacity');
  end if;
  if r.out_status = 'blocked' then
    return json_build_object('error', 'void');
  end if;

  return json_build_object(
    'id', v_id, 'pass_code', v_pass, 'url', '/pass/' || v_pass, 'name', p_name,
    'coupon', r.out_coupon, 'amount', v_door, 'status', r.out_status,
    -- attendee-facing: this event json is what the walk-in's email renders
    'event', app_event_json(v_event, true));
end;
$$;

-- ---------------------------------------------------------------------------
-- §10.5 GET /api/admin/roster — the floor screen's search index.
-- [S10] phone4 only. This lands in localStorage on a volunteer's personal
-- phone; 50 complete phone numbers have no business being there.
create or replace function app_roster()
returns json
language plpgsql
as $$
declare v_event uuid;
begin
  v_event := app_current_event_id();
  if v_event is null then
    return json_build_object('error', 'no_event');
  end if;

  return json_build_object(
    'event', app_event_json(v_event),
    'fetched_at', now(),
    'people', coalesce((
      select json_agg(json_build_object(
               'id', a.id, 'pass', a.pass_code, 'coupon', a.coupon_no,
               'name', a.name, 'phone4', right(a.phone, 4),
               'state', a.state, 'claimed_at', a.claimed_at)
             order by a.name)
        from attendees a
       where a.event_id = v_event
         and a.state in ('confirmed', 'claimed')), '[]'::json)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- §10.7 POST /api/admin/verify — the whole reconciliation.
create or replace function app_admin_verify(p_utrs text[], p_scanned int)
returns json
language plpgsql
as $$
declare
  v_event     uuid;
  v_confirmed json;
  v_over      json;
  v_pending   json;
  v_no_utr    json;
  v_matched   json;
begin
  v_event := app_current_event_id();
  if v_event is null then
    return json_build_object('error', 'no_event');
  end if;

  -- One pass over verify_by_utrs; 'already' rows are dropped, which is what
  -- makes re-pasting the same statement a no-op. [E18]
  select
    coalesce(json_agg(json_build_object(
        'id', out_id, 'name', out_name, 'email', out_email,
        'phone', out_phone, 'pass', out_pass, 'coupon', out_coupon)
      order by out_coupon) filter (where out_status = 'confirmed'), '[]'::json),
    coalesce(json_agg(json_build_object(
        'id', out_id, 'name', out_name, 'phone', out_phone, 'pass', out_pass)
      ) filter (where out_status = 'over_capacity'), '[]'::json)
  into v_confirmed, v_over
  from verify_by_utrs(v_event, p_utrs);

  -- [E3] submitted a reference we could not find — never auto-rejected
  select coalesce(json_agg(json_build_object(
           'id', a.id, 'name', a.name, 'utr', a.utr,
           'phone', a.phone, 'pass', a.pass_code) order by a.created_at), '[]'::json)
    into v_pending
    from attendees a
   where a.event_id = v_event and a.state = 'submitted';

  -- [E2] registered, never paid
  select coalesce(json_agg(json_build_object(
           'id', a.id, 'name', a.name,
           'phone', a.phone, 'pass', a.pass_code) order by a.created_at), '[]'::json)
    into v_no_utr
    from attendees a
   where a.event_id = v_event and a.state = 'registered';

  -- §12.2 the total check. Which references in the paste belong to a real
  -- attendee of THIS event — the denominator for "expected × price". [E19]
  -- foreign references simply never appear here.
  select coalesce(json_agg(a.utr), '[]'::json) into v_matched
    from attendees a
   where a.event_id = v_event and a.utr = any(p_utrs);

  -- [S11] counts only. The raw paste is a bank statement and is never stored.
  perform app_audit(v_event, null, 'verify_bulk',
    jsonb_build_object('scanned', p_scanned,
                       'confirmed_count', json_array_length(v_confirmed)),
    'admin');

  -- attendee-facing: the API layer renders confirmation emails from this event
  return json_build_object('event', app_event_json(v_event, true),
                           'confirmed', v_confirmed, 'over_capacity', v_over,
                           'pending', v_pending, 'no_utr', v_no_utr,
                           'matched', v_matched);
end;
$$;

-- ---------------------------------------------------------------------------
-- §10 admin attendee actions
create or replace function app_confirm_attendee(p_id uuid)
returns json
language plpgsql
as $$
declare
  r       record;
  v_event uuid;
  v_name  text;
  v_email text;
  v_pass  text;
begin
  select event_id, name, email, pass_code into v_event, v_name, v_email, v_pass
    from attendees where id = p_id;
  if v_event is null then
    return json_build_object('status', 'not_found');
  end if;

  select * into r from confirm_attendee(p_id, 'manual', null);

  perform app_audit(v_event, p_id, 'confirm',
    jsonb_build_object('status', r.out_status, 'coupon', r.out_coupon), 'admin');

  return json_build_object('status', r.out_status, 'coupon', r.out_coupon,
                           'name', v_name, 'email', v_email, 'pass', v_pass,
                           'id', p_id, 'event', app_event_json(v_event, true));
end;
$$;

-- refund / reject. A mandatory reason is stored in `note` and in the audit
-- log — voiding someone's paid seat without recording why is what causes an
-- argument in a WhatsApp group three weeks later. [R11] [E21] [S9]
create or replace function app_void_attendee(p_id uuid, p_state text, p_reason text)
returns json
language plpgsql
as $$
declare
  v_event uuid;
  v_state text;
begin
  select event_id, state into v_event, v_state from attendees where id = p_id;
  if v_event is null then
    return json_build_object('error', 'not_found');
  end if;
  -- §4: a claimed pass can still be voided. The drink is gone, but the seat
  -- and the money are still a real conversation.
  if v_state not in ('registered', 'submitted', 'confirmed', 'claimed') then
    return json_build_object('error', 'bad_state', 'state', v_state);
  end if;

  perform set_attendee_void(p_id, p_state);

  update attendees
     set note = trim(both E'\n' from coalesce(note || E'\n', '') ||
                     p_state || ': ' || p_reason)
   where id = p_id;

  perform app_audit(v_event, p_id, p_state,
                    jsonb_build_object('reason', p_reason), 'admin');

  return json_build_object('state', p_state);
end;
$$;

-- PATCH — this is how [E20] seat transfer works: the ticket stays, the person
-- on it changes. Pass and coupon are untouched.
create or replace function app_patch_attendee(
  p_id uuid, p_name text, p_phone text, p_email text, p_note text)
returns json
language plpgsql
as $$
declare v_event uuid;
begin
  select event_id into v_event from attendees where id = p_id;
  if v_event is null then
    return json_build_object('error', 'not_found');
  end if;

  begin
    update attendees
       set name  = coalesce(nullif(p_name, ''), name),
           phone = coalesce(nullif(p_phone, ''), phone),
           email = case when p_email is null then email else nullif(p_email, '') end,
           note  = case when p_note is null then note else nullif(p_note, '') end
     where id = p_id;
  exception when unique_violation then
    return json_build_object('error', 'phone_taken');
  end;

  perform app_audit(v_event, p_id, 'patch',
    jsonb_build_object('name', p_name, 'phone', p_phone, 'email', p_email), 'admin');

  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- §13 email bookkeeping. [R9] emailed_at is set only after a successful send.
create or replace function app_mark_emailed(p_id uuid)
returns json
language plpgsql
as $$
declare v_event uuid;
begin
  update attendees set emailed_at = now() where id = p_id
    returning event_id into v_event;
  perform app_audit(v_event, p_id, 'email', '{}'::jsonb, 'admin');
  return json_build_object('ok', true);
end;
$$;

-- Everyone still owed an email: confirmed (or already drinking) with an
-- address and emailed_at still null.
create or replace function app_pending_emails()
returns json
language sql
stable
as $$
  select json_build_object(
    'event', app_event_json(app_current_event_id(), true),
    'people', coalesce((
      select json_agg(json_build_object(
               'id', a.id, 'name', a.name, 'email', a.email,
               'pass', a.pass_code, 'coupon', a.coupon_no) order by a.coupon_no)
        from attendees a
       where a.event_id = app_current_event_id()
         and a.state in ('confirmed', 'claimed')
         and a.emailed_at is null
         and a.email is not null), '[]'::json)
  );
$$;

-- ---------------------------------------------------------------------------
-- §11.5 settlement.
--
-- [R10] is the line to get right, and it is counter-intuitive: the cafe is
-- paid the COMMITTED HEADCOUNT, not the claim count. Claims are a leak
-- detector, not an invoice. A no-show is still paid for; their ₹50 stays with
-- the fund. [E8]
create or replace function app_stats()
returns json
language plpgsql
as $$
declare
  v_event uuid;
  v_ev    json;
begin
  v_event := app_current_event_id();
  if v_event is null then
    return json_build_object('error', 'no_event');
  end if;
  v_ev := app_event_json(v_event);

  return (
    select json_build_object(
      'event', v_ev,
      'registered', count(*) filter (where state = 'registered'),
      'submitted',  count(*) filter (where state = 'submitted'),
      'headcount',  count(*) filter (where state in ('confirmed','claimed')),
      'claimed',    count(*) filter (where state = 'claimed'),
      'not_claimed', count(*) filter (where state = 'confirmed'),
      'refunded',   count(*) filter (where state = 'refunded'),
      'rejected',   count(*) filter (where state = 'rejected'),
      'seats_left', greatest(0, (v_ev->>'capacity')::int
                                - count(*) filter (where state in ('confirmed','claimed'))::int),
      -- what actually arrived, walk-ins at door_price included
      'collected',  coalesce(sum(amount_paid) filter (where state in ('confirmed','claimed')), 0),
      -- [R10] flat, agreed in advance, payable regardless of who shows up
      'cafe_due',   count(*) filter (where state in ('confirmed','claimed'))
                    * (v_ev->>'cafe_share')::int,
      'fund',       coalesce(sum(amount_paid) filter (where state in ('confirmed','claimed')), 0)
                    - count(*) filter (where state in ('confirmed','claimed'))
                      * (v_ev->>'cafe_share')::int,
      'walkins',    count(*) filter (where is_walkin and state in ('confirmed','claimed')),
      'walkin_fund', coalesce(sum(amount_paid) filter (where is_walkin and state in ('confirmed','claimed')), 0)
                     - count(*) filter (where is_walkin and state in ('confirmed','claimed'))
                       * (v_ev->>'cafe_share')::int,
      'unemailed',  count(*) filter (where state in ('confirmed','claimed')
                                       and emailed_at is null and email is not null)
    )
    from attendees where event_id = v_event
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- /admin/people — the full table with search.
create or replace function app_people(p_q text)
returns json
language sql
stable
as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]'::json)
  from (
    select a.id, a.pass_code, a.coupon_no, a.name, a.phone, a.email,
           a.instagram, a.utr, a.utr_at, a.amount_paid, a.is_walkin, a.state,
           a.confirmed_at, a.verify_method, a.claimed_at, a.claim_until,
           a.claim_by, a.emailed_at, a.note, a.created_at
      from attendees a
     where a.event_id = app_current_event_id()
       and (p_q is null or p_q = '' or
            a.name ilike '%' || p_q || '%' or
            a.phone like '%' || p_q || '%' or
            a.pass_code ilike '%' || p_q || '%' or
            coalesce(a.utr, '') like '%' || p_q || '%' or
            coalesce(a.coupon_no::text, '') = p_q)
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- /admin/event. Creating a new open event while one is already open is blocked
-- by events_one_open_idx, which surfaces here as event_open.
create or replace function app_save_event(
  p_id uuid, p_name text, p_event_date date, p_start_time text, p_venue text,
  p_price int, p_door_price int, p_cafe_share int, p_fund_share int,
  p_capacity int, p_claim_seconds int,
  p_upi_vpa text, p_upi_name text, p_closes_at timestamptz)
returns json
language plpgsql
as $$
declare v_id uuid;
begin
  if p_id is null then
    begin
      insert into events (name, event_date, start_time, venue, price, door_price,
                          cafe_share, fund_share, capacity, claim_seconds,
                          upi_vpa, upi_name, closes_at)
      values (p_name, p_event_date, nullif(p_start_time, ''), nullif(p_venue, ''),
              p_price, p_door_price, p_cafe_share, p_fund_share, p_capacity,
              p_claim_seconds, p_upi_vpa, p_upi_name, p_closes_at)
      returning id into v_id;
    exception when unique_violation then
      return json_build_object('error', 'event_open');
    end;
  else
    update events
       set name = p_name, event_date = p_event_date,
           start_time = nullif(p_start_time, ''), venue = nullif(p_venue, ''),
           price = p_price, door_price = p_door_price,
           cafe_share = p_cafe_share, fund_share = p_fund_share,
           capacity = p_capacity, claim_seconds = p_claim_seconds,
           upi_vpa = p_upi_vpa, upi_name = p_upi_name, closes_at = p_closes_at
     where id = p_id
     returning id into v_id;
    if v_id is null then
      return json_build_object('error', 'not_found');
    end if;
  end if;

  perform app_audit(v_id, null, 'event_save',
                    jsonb_build_object('name', p_name), 'admin');
  return json_build_object('id', v_id, 'event', app_event_json(v_id));
end;
$$;

create or replace function app_set_event_status(p_id uuid, p_status text)
returns json
language plpgsql
as $$
begin
  if p_status not in ('open', 'closed', 'done') then
    return json_build_object('error', 'bad_status');
  end if;
  begin
    update events set status = p_status where id = p_id;
  exception when unique_violation then
    return json_build_object('error', 'event_open');
  end;
  perform app_audit(p_id, null, 'event_status',
                    jsonb_build_object('status', p_status), 'admin');
  return json_build_object('status', p_status);
end;
$$;
