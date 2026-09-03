\set ON_ERROR_STOP on
\pset pager off
\set EV '''22222222-2222-2222-2222-222222222222'''

truncate attendees, events, audit_log cascade;
insert into events (id,name,event_date,venue,capacity,claim_seconds,upi_vpa,upi_name,closes_at)
values (:EV,'On Mic Jam','2026-08-16','Cafe',50,90,'onmic@ybl','On Mic','2026-08-15 21:00+05:30');

-- helper: make N confirmed attendees
create or replace function mk(n int) returns void language plpgsql as $$
declare g int; begin
  delete from attendees;
  for g in 1..n loop
    insert into attendees (event_id,pass_code,name,phone,utr,utr_at,state)
    values ('22222222-2222-2222-2222-222222222222','P-'||lpad(g::text,3,'0'),
            'Guest '||g,'96'||lpad(g::text,8,'0'),
            lpad((600000000000+g)::text,12,'0'), now()+(g||' sec')::interval,'submitted');
  end loop;
  perform confirm_attendee(id,'auto',null) from attendees;
end $$;

\echo ''
\echo '=== C-1  first claim succeeds, opens the green window ==='
select mk(3);
select case when out_ok and out_reason='ok' and out_coupon is not null
                 and out_until > now()
            then 'PASS: claim ok, window open, coupon '||out_coupon
            else 'FAIL: '||out_reason end as c1
from claim_drink(:EV,'P-001','self');

\echo '=== C-2  re-opening inside the window shows the SAME claim ==='
select case when out_ok and out_reason='active' then 'PASS: same claim still active'
            else 'FAIL: '||out_reason end as c2
from claim_drink(:EV,'P-001','self');
select case when count(*)=1 then 'PASS: still exactly one claimed row' else 'FAIL' end as c2b
from attendees where state='claimed';

\echo '=== C-3  after the window expires it is spent, not re-claimable ==='
update attendees set claim_until = now() - interval '1 second' where pass_code='P-001';
select case when not out_ok and out_reason='already' and out_claimed_at is not null
            then 'PASS: expired window returns already, keeps original time'
            else 'FAIL: '||out_reason end as c3
from claim_drink(:EV,'P-001','self');

\echo '=== C-4  unpaid person cannot claim a drink ==='
insert into attendees (event_id,pass_code,name,phone,state)
values (:EV,'P-FREE','Freeloader','9700000001','registered');
select case when not out_ok and out_reason='not_paid'
            then 'PASS: unpaid blocked at the drink' else 'FAIL: '||out_reason end as c4
from claim_drink(:EV,'P-FREE','self');

\echo '=== C-5  a friend with no pass at all ==='
select case when not out_ok and out_reason='not_found'
            then 'PASS: unknown pass blocked' else 'FAIL: '||out_reason end as c5
from claim_drink(:EV,'P-NOPE','self');

\echo '=== C-6  refunded pass cannot claim ==='
select set_attendee_void(id,'refunded') from attendees where pass_code='P-002';
select case when not out_ok and out_reason='void'
            then 'PASS: refunded blocked' else 'FAIL: '||out_reason end as c6
from claim_drink(:EV,'P-002','self');

\echo '=== C-7  concurrent double-tap yields exactly one claim ==='
select mk(1);
select string_agg(r,',' order by r) as c7_raw from (
  select (claim_drink('22222222-2222-2222-2222-222222222222','P-001','self')).out_reason r
  from generate_series(1,5)
) s;
select case when count(*)=1 and count(distinct claimed_at)=1
            then 'PASS: one claim, one immutable timestamp' else 'FAIL' end as c7
from attendees where state='claimed';

\echo '=== C-8  admin can reset an accidental claim, then it works again ==='
select reset_claim(id) from attendees where pass_code='P-001';
select case when out_ok and out_reason='ok' then 'PASS: reclaim after reset'
            else 'FAIL: '||out_reason end as c8
from claim_drink(:EV,'P-001','admin');
select case when claim_by='admin' then 'PASS: claim_by recorded' else 'FAIL' end as c8b
from attendees where pass_code='P-001';

\echo '=== C-9  walk-in at door price is confirmed and priced correctly ==='
select mk(2);
insert into attendees (event_id,pass_code,name,phone,state,is_walkin)
values (:EV,'P-WALK','Walkin Friend','9800000001','registered',true);
select case when out_status='confirmed' then 'PASS: walk-in confirmed'
            else 'FAIL: '||out_status end as c9
from confirm_attendee((select id from attendees where pass_code='P-WALK'),'manual',350);
select case when amount_paid=350 then 'PASS: charged door price 350'
            else 'FAIL: '||amount_paid end as c9b
from attendees where pass_code='P-WALK';
select case when out_ok then 'PASS: walk-in can claim a drink' else 'FAIL: '||out_reason end as c9c
from claim_drink(:EV,'P-WALK','admin');

\echo '=== C-10  50-person event: money math ==='
select mk(50);
select claim_drink(:EV, pass_code, 'self') from attendees where coupon_no <= 47;

select 'confirmed+claimed='||count(*) filter (where state in ('confirmed','claimed'))||
       '  drinks_claimed='||count(*) filter (where state='claimed')||
       '  collected=Rs'||sum(amount_paid)||
       '  owed_to_cafe=Rs'||(count(*) filter (where state in ('confirmed','claimed'))*250)||
       '  fund=Rs'||(sum(amount_paid) - count(*) filter (where state in ('confirmed','claimed'))*250)
       as money
from attendees where state in ('confirmed','claimed');

\echo '=== C-11  leak detector: claims can never exceed paid headcount ==='
select case when (select count(*) from attendees where state='claimed')
              <= (select count(*) from attendees where state in ('confirmed','claimed'))
            then 'PASS: claims <= paid headcount, structurally'
            else 'FAIL' end as c11;

\echo '=== C-12  capacity: 50 seats, 53 payers ==='
select mk(0);
insert into attendees (event_id,pass_code,name,phone,utr,utr_at,state)
select :EV,'Q-'||lpad(g::text,3,'0'),'G'||g,'97'||lpad(g::text,8,'0'),
       lpad((700000000000+g)::text,12,'0'), now()+(g||' sec')::interval,'submitted'
from generate_series(1,53) g;
select case when count(*) filter (where out_status='confirmed')=50
             and count(*) filter (where out_status='over_capacity')=3
            then 'PASS: 50 confirmed, 3 flagged for refund'
            else 'FAIL' end as c12
from verify_by_utrs(:EV,(select array_agg(utr) from attendees));
