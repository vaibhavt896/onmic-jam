create extension if not exists pgcrypto;

drop table if exists attendees cascade;
drop table if exists events cascade;
drop table if exists audit_log cascade;

create table events (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  event_date    date        not null,
  venue         text,
  price         int         not null default 300,
  door_price    int         not null default 350,
  cafe_share    int         not null default 250,
  fund_share    int         not null default 50,
  capacity      int         not null default 50,
  claim_seconds int         not null default 90,
  upi_vpa       text        not null,
  upi_name      text        not null,
  closes_at     timestamptz not null,
  status        text        not null default 'open'
                            check (status in ('open','closed','done')),
  created_at    timestamptz not null default now()
);

create unique index events_one_open_idx
  on events ((status = 'open')) where status = 'open';

create table attendees (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,

  pass_code     text not null,
  coupon_no     int,

  name          text not null,
  phone         text not null,
  email         text,
  instagram     text,

  utr           text,
  utr_at        timestamptz,
  amount_paid   int,
  is_walkin     boolean not null default false,

  state         text not null default 'registered'
                check (state in ('registered','submitted','confirmed',
                                 'claimed','refunded','rejected')),

  confirmed_at  timestamptz,
  verify_method text check (verify_method in ('auto','manual')),

  claimed_at    timestamptz,
  claim_until   timestamptz,
  claim_by      text check (claim_by in ('self','admin')),

  emailed_at    timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);

create unique index attendees_event_phone_idx  on attendees (event_id, phone);
create unique index attendees_event_utr_idx    on attendees (event_id, utr) where utr is not null;
create unique index attendees_event_pass_idx   on attendees (event_id, pass_code);
create unique index attendees_event_coupon_idx on attendees (event_id, coupon_no) where coupon_no is not null;
create index        attendees_event_state_idx  on attendees (event_id, state);

create table audit_log (
  id          bigserial primary key,
  event_id    uuid,
  attendee_id uuid,
  action      text not null,
  detail      jsonb,
  actor       text,
  created_at  timestamptz not null default now()
);

-- ===========================================================================
create or replace function confirm_attendee(p_attendee uuid, p_method text, p_amount int default null)
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

  if v_state in ('confirmed','claimed') then
    return query select v_coupon, 'already'; return;
  end if;

  if v_state in ('refunded','rejected') then
    return query select null::int, 'blocked'; return;
  end if;

  perform 1 from events where id = v_event for update;

  select capacity, price into v_cap, v_price from events where id = v_event;
  select count(*) into v_taken from attendees
    where event_id = v_event and state in ('confirmed','claimed');

  if v_taken >= v_cap then
    return query select null::int, 'over_capacity'; return;
  end if;

  select coalesce(max(coupon_no),0)+1 into v_coupon
    from attendees where event_id = v_event;

  update attendees
     set state='confirmed', coupon_no=v_coupon, confirmed_at=now(),
         verify_method=p_method,
         amount_paid = coalesce(p_amount, amount_paid, v_price)
   where id = p_attendee;

  return query select v_coupon, 'confirmed';
end; $$;

-- ===========================================================================
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
     order by a.utr_at nulls last, a.created_at
  loop
    select * into res from confirm_attendee(r.id,'auto',null);
    return query select a.id,a.name,a.email,a.phone,a.pass_code,a.coupon_no,res.out_status
      from attendees a where a.id = r.id;
  end loop;
end; $$;

-- ===========================================================================
-- claim_drink : the ONLY gate between a person and a mocktail.
-- One claim per pass, ever. Opens a short green window; re-opening the page
-- inside that window shows the same live countdown, not a second claim.
-- ===========================================================================
create or replace function claim_drink(p_event uuid, p_pass text, p_by text)
returns table (out_ok boolean, out_reason text, out_name text, out_coupon int,
               out_until timestamptz, out_claimed_at timestamptz)
language plpgsql
as $$
declare a attendees%rowtype; v_secs int;
begin
  select * into a from attendees
   where event_id = p_event and pass_code = p_pass for update;

  if a.id is null then
    return query select false,'not_found',null::text,null::int,null::timestamptz,null::timestamptz; return;
  end if;

  if a.state in ('refunded','rejected') then
    return query select false,'void',a.name,null::int,null::timestamptz,null::timestamptz; return;
  end if;

  if a.state in ('registered','submitted') then
    return query select false,'not_paid',a.name,null::int,null::timestamptz,null::timestamptz; return;
  end if;

  if a.state = 'claimed' then
    if now() < a.claim_until then
      -- still inside the window: same claim, not a new one
      return query select true,'active',a.name,a.coupon_no,a.claim_until,a.claimed_at; return;
    else
      return query select false,'already',a.name,a.coupon_no,null::timestamptz,a.claimed_at; return;
    end if;
  end if;

  select claim_seconds into v_secs from events where id = p_event;

  update attendees
     set state='claimed', claimed_at=now(),
         claim_until = now() + (v_secs || ' seconds')::interval,
         claim_by = p_by
   where id = a.id
   returning claimed_at, claim_until into a.claimed_at, a.claim_until;

  return query select true,'ok',a.name,a.coupon_no,a.claim_until,a.claimed_at;
end; $$;

-- ===========================================================================
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

-- ===========================================================================
create or replace function set_attendee_void(p_attendee uuid, p_state text)
returns text
language plpgsql
as $$
begin
  if p_state not in ('refunded','rejected') then
    raise exception 'bad state %', p_state;
  end if;
  update attendees set state = p_state where id = p_attendee
    and state in ('registered','submitted','confirmed','claimed');
  return p_state;
end; $$;

alter table events    enable row level security;
alter table attendees enable row level security;
alter table audit_log enable row level security;
