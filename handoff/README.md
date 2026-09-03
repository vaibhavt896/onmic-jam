# On Mic Jam — developer handoff (spec v1.1)

- `onmic-jam-spec.md`   — the build specification. Read it end to end first.
- `supabase/schema.sql` — tables, indexes, and the five state-transition functions.
- `supabase/tests.sql`  — the database acceptance harness (§16).

Verified against PostgreSQL 16: every database-level test passes.

    psql "$DATABASE_URL" -f supabase/schema.sql
    psql "$DATABASE_URL" -f supabase/tests.sql

Every line of test output must read PASS. Run this BEFORE writing any
application code, so a later failure is unambiguously in the app layer.

## The three things to understand before you start

1. Payment currently happens AFTER people are served, which is why money
   goes missing. This app moves payment BEFORE the event. It must never
   chase anyone for money after the fact.

2. There is NO door checkpoint. The drink claim is the only gate. People
   arrive over two hours; stationing a volunteer at the entrance is the
   manual labour this system exists to remove.

3. The cafe is paid a FLAT committed headcount. That is deliberate: it
   makes an over-served mocktail the cafe's cost, not the community's,
   which is what gives them a reason to check the green screen. See 3.4.

Running cost must stay at zero: no payment gateway, no printing, no paid tier.

## Note on the UPI amount (12.1 / 12.2)

The pre-filled amount in a UPI deep link is NOT reliably locked -- some
payer apps let it be edited. Do not assume ₹300 arrived just because the
UTR matched. The total check on the verify screen is required, not optional.
