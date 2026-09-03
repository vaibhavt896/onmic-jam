/**
 * §16 acceptance tests — data integrity, reconciliation, the claim, and the
 * failure modes.
 *
 * Runs against a real `next start` process and a real Postgres, so every
 * assertion goes through the same route handlers, middleware and SQL functions
 * that production uses.
 *
 * The four UI tests (20–23) need a browser and live in tests/e2e/.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_PASSCODE,
  applySchema,
  closeDb,
  loginAdmin,
  makeClient,
  resetDb,
  seedAttendees,
  sql,
  startServer,
  statement,
} from "../helpers/harness.mjs";
import { startMockResend } from "../helpers/mock-resend.mjs";

let mail;
let mailed; // server with a (mock) email provider configured
let silent; // server with no RESEND_API_KEY at all
let admin;
let eventId;

before(async () => {
  await applySchema();
  mail = await startMockResend();

  mailed = await startServer(3101, {
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "On Mic <tickets@example.com>",
    RESEND_BASE_URL: mail.url,
  });
  silent = await startServer(3102); // RESEND_API_KEY intentionally empty

  admin = makeClient(mailed.base);
  // Log in before test 28 exhausts the login rate limiter for this IP.
  await loginAdmin(admin);
});

after(async () => {
  await mailed?.stop();
  await silent?.stop();
  await mail?.stop();
  await closeDb();
});

const pub = () => makeClient(mailed.base);

async function register(over = {}) {
  const client = pub();
  return client.req("/api/register", {
    method: "POST",
    body: { name: "Test Person", phone: "9876543210", email: "t@example.com", ...over },
  });
}

/** Register → submit a UTR → confirm through the admin path. Returns the pass. */
async function confirmedAttendee(over = {}) {
  const reg = await register(over);
  const pass = reg.body.pass_code;
  const [{ id }] = await sql("select id from attendees where pass_code = $1", [pass]);
  await sql("select confirm_attendee($1, 'manual', null)", [id]);
  return { pass, id };
}

const claim = (pass) =>
  pub().req("/api/claim", { method: "POST", body: { pass_code: pass } });

// ===========================================================================
describe("data integrity", () => {
  it("1 · same phone registered 5× concurrently yields one row and one pass", async () => {
    eventId = await resetDb();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => register({ name: "Vaibhav Tiwari", phone: "9876543210" })),
    );

    assert.equal(results.filter((r) => r.status === 200).length, 5, "all five succeed");
    const passes = new Set(results.map((r) => r.body.pass_code));
    assert.equal(passes.size, 1, `one distinct pass_code, got ${[...passes].join(",")}`);

    const rows = await sql("select count(*)::int n from attendees where phone = '9876543210'");
    assert.equal(rows[0].n, 1, "exactly one attendee row");
  });

  it("E1 · phone is normalised, so +91 / 0 / spaces cannot create duplicates", async () => {
    await resetDb();
    const a = await register({ phone: "9876543210" });
    const b = await register({ phone: "+91 98765 43210" });
    const c = await register({ phone: "09876543210" });

    assert.equal(a.body.pass_code, b.body.pass_code);
    assert.equal(a.body.pass_code, c.body.pass_code);
    const rows = await sql("select count(*)::int n from attendees");
    assert.equal(rows[0].n, 1);
  });

  it("2 · two people submitting the same UTR — second gets 409 utr_taken", async () => {
    await resetDb();
    const one = await register({ phone: "9000000001" });
    const two = await register({ phone: "9000000002" });

    const first = await pub().req("/api/utr", {
      method: "POST",
      body: { pass_code: one.body.pass_code, utr: "412345678901" },
    });
    const second = await pub().req("/api/utr", {
      method: "POST",
      body: { pass_code: two.body.pass_code, utr: "412345678901" },
    });

    assert.equal(first.status, 200);
    assert.equal(first.body.state, "submitted");
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "utr_taken");
    assert.match(second.body.message, /already registered against another person/);

    const rows = await sql("select count(*)::int n from attendees where utr = '412345678901'");
    assert.equal(rows[0].n, 1, "the database holds exactly one");
  });

  it("E4 · re-submitting a UTR from `submitted` overwrites (people mistype)", async () => {
    await resetDb();
    const reg = await register({ phone: "9000000003" });
    const send = (utr) =>
      pub().req("/api/utr", { method: "POST", body: { pass_code: reg.body.pass_code, utr } });

    assert.equal((await send("412345678901")).status, 200);
    assert.equal((await send("412345678902")).status, 200);

    const rows = await sql("select utr from attendees where pass_code = $1", [reg.body.pass_code]);
    assert.equal(rows[0].utr, "412345678902");
  });

  it("3 · 10 concurrent confirms mint coupons 1..10 — no duplicates, no gaps", async () => {
    const id = await resetDb();
    await seedAttendees(id, 10, 10);
    const ids = await sql("select id from attendees order by created_at");

    await Promise.all(ids.map((r) => sql("select confirm_attendee($1, 'auto', null)", [r.id])));

    const rows = await sql(
      "select coupon_no from attendees where coupon_no is not null order by coupon_no",
    );
    assert.deepEqual(
      rows.map((r) => r.coupon_no),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
  });

  it("4 · capacity 3, five payers — earliest utr_at wins, the rest are over_capacity", async () => {
    const id = await resetDb({ capacity: 3 });
    await seedAttendees(id, 5, 5);

    const rows = await sql("select * from verify_by_utrs($1, (select array_agg(utr) from attendees))", [
      id,
    ]);
    assert.equal(rows.filter((r) => r.out_status === "confirmed").length, 3);
    assert.equal(rows.filter((r) => r.out_status === "over_capacity").length, 3 - 3 + 2);

    // [E7] the three earliest payers are the ones holding seats.
    const confirmed = await sql(
      "select name from attendees where state = 'confirmed' order by utr_at",
    );
    assert.deepEqual(
      confirmed.map((r) => r.name),
      ["Guest 1", "Guest 2", "Guest 3"],
    );
  });

  it("5 · a refunded attendee cannot claim, and their coupon is retired not recycled", async () => {
    await resetDb();
    const { pass, id } = await confirmedAttendee({ phone: "9000000004" });
    const [{ coupon_no: coupon }] = await sql("select coupon_no from attendees where id = $1", [id]);

    const res = await admin.req(`/api/admin/attendee/${id}/refund`, {
      method: "POST",
      body: { reason: "could not make it" },
    });
    assert.equal(res.status, 200);

    const blocked = await claim(pass);
    assert.equal(blocked.body.ok, false);
    assert.equal(blocked.body.reason, "void");

    // [R5] the number stays on the refunded row; the next person gets the next
    // number, and the gap is correct.
    const [row] = await sql("select coupon_no, state from attendees where id = $1", [id]);
    assert.equal(row.coupon_no, coupon);
    assert.equal(row.state, "refunded");

    const next = await confirmedAttendee({ phone: "9000000005" });
    const [after] = await sql("select coupon_no from attendees where id = $1", [next.id]);
    assert.equal(after.coupon_no, coupon + 1, "numbers are never reused");
  });

  it("refund and reject demand a reason of at least 3 characters", async () => {
    await resetDb();
    const { id } = await confirmedAttendee({ phone: "9000000006" });
    for (const action of ["refund", "reject"]) {
      const res = await admin.req(`/api/admin/attendee/${id}/${action}`, {
        method: "POST",
        body: { reason: "x" },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "bad_reason");
    }
  });

  it("R3/E23 · registration and UTR submission are rejected after closes_at", async () => {
    await resetDb();
    const reg = await register({ phone: "9000000007" });
    await sql("update events set closes_at = now() - interval '1 minute'");

    const late = await register({ phone: "9000000008" });
    assert.equal(late.status, 409);
    assert.equal(late.body.error, "closed");

    const utr = await pub().req("/api/utr", {
      method: "POST",
      body: { pass_code: reg.body.pass_code, utr: "412345678903" },
    });
    assert.equal(utr.status, 409);
    assert.equal(utr.body.error, "closed");
    assert.match(utr.body.message, /Message the organisers/);
  });

  it("E22 · with no open event the public API says no_event", async () => {
    await sql("truncate attendees, events, audit_log cascade");
    const res = await register({ phone: "9000000009" });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "no_event");
  });

  it("validation rejects bad name, phone and email with the documented codes", async () => {
    await resetDb();
    const cases = [
      [{ name: "V" }, "bad_name"],
      [{ phone: "12345" }, "bad_phone"],
      [{ phone: "5876543210" }, "bad_phone"],
      [{ email: "not-an-email" }, "bad_email"],
    ];
    for (const [over, code] of cases) {
      const res = await register(over);
      assert.equal(res.status, 400, JSON.stringify(over));
      assert.equal(res.body.error, code);
      assert.ok(res.body.message.length > 15, "every error carries a renderable sentence");
    }
  });

  it("E5/S3 · a UTR is 12 digits — 11 and 13 are refused", async () => {
    await resetDb();
    const reg = await register({ phone: "9000000010" });
    for (const bad of ["41234567890", "4123456789012", "abc"]) {
      const res = await pub().req("/api/utr", {
        method: "POST",
        body: { pass_code: reg.body.pass_code, utr: bad },
      });
      assert.equal(res.status, 400, bad);
      assert.equal(res.body.error, "bad_utr");
    }
  });
});

// ===========================================================================
describe("reconciliation", () => {
  /** §16.6 uses 65 seeded / 58 paying; capacity is raised so this measures the
   *  match, not the cap — the cap has its own test above. */
  async function seedForVerify() {
    const id = await resetDb({ capacity: 70 });
    await seedAttendees(id, 65, 58);
    return id;
  }

  it("6 · 58 of 65 matched from a statement salted with 200 unrelated numbers", async () => {
    await seedForVerify();
    mail.clear();

    const utrs = (await sql("select utr from attendees where utr is not null order by utr_at")).map(
      (r) => r.utr,
    );
    const res = await admin.req("/api/admin/verify", {
      method: "POST",
      body: { raw: statement(utrs, 200) },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.confirmed.length, 58);
    assert.equal(res.body.no_utr.length, 7, "the seven who never paid are listed, not confirmed");
    assert.equal(res.body.pending.length, 0);

    const coupons = res.body.confirmed.map((c) => c.coupon);
    assert.deepEqual(coupons, Array.from({ length: 58 }, (_, i) => i + 1));

    // §12.2 the total check balances when everybody paid the asking price.
    assert.equal(res.body.total.readable, 58);
    assert.equal(res.body.total.expected, 58 * 300);
    assert.equal(res.body.total.in_paste, 58 * 300);
  });

  it("E6 · the total check surfaces someone who edited ₹300 down to ₹250", async () => {
    await resetDb({ capacity: 70 });
    const id = await sql("select id from events limit 1").then((r) => r[0].id);
    await seedAttendees(id, 3, 3);
    const utrs = (await sql("select utr from attendees order by utr_at")).map((r) => r.utr);

    // one payer edited the amount in their UPI app; the reference is valid
    const raw = [
      `06/09/2026 18:01  UPI/${utrs[0]}/ONMIC  300.00 Cr`,
      `06/09/2026 18:02  UPI/${utrs[1]}/ONMIC  250.00 Cr`,
      `06/09/2026 18:03  UPI/${utrs[2]}/ONMIC  300.00 Cr`,
    ].join("\n");

    const res = await admin.req("/api/admin/verify", { method: "POST", body: { raw } });
    assert.equal(res.body.total.expected - res.body.total.in_paste, 50, "short by ₹50");
    // and it does NOT block the confirmation — a short payer is a person to
    // talk to, not a system error.
    assert.equal(res.body.confirmed.length, 3);
  });

  it("7 · pasting the identical statement again confirms nobody and re-sends nothing", async () => {
    await seedForVerify();
    const utrs = (await sql("select utr from attendees where utr is not null")).map((r) => r.utr);
    const raw = statement(utrs, 50);

    const first = await admin.req("/api/admin/verify", { method: "POST", body: { raw } });
    assert.equal(first.body.confirmed.length, 58);
    mail.clear();

    const second = await admin.req("/api/admin/verify", { method: "POST", body: { raw } });
    assert.equal(second.body.confirmed.length, 0, "[E18] safe to paste again");
    assert.equal(mail.sent.length, 0, "and nobody is emailed twice");

    const rows = await sql("select count(*)::int n from attendees where state = 'confirmed'");
    assert.equal(rows[0].n, 58);
  });

  it("8 · UTRs embedded as UPI/412345678901/ONMIC are all matched", async () => {
    const id = await resetDb({ capacity: 70 });
    await seedAttendees(id, 5, 5);
    const utrs = (await sql("select utr from attendees")).map((r) => r.utr);
    const raw = utrs.map((u) => `06/09/2026  UPI/${u}/ONMIC  300.00 Cr`).join("\n");

    const res = await admin.req("/api/admin/verify", { method: "POST", body: { raw } });
    assert.equal(res.body.confirmed.length, 5);
  });

  it("8b · a 12-digit run inside a longer number is not treated as a reference", async () => {
    const id = await resetDb({ capacity: 70 });
    await seedAttendees(id, 1, 1);
    const [{ utr }] = await sql("select utr from attendees");

    const res = await admin.req("/api/admin/verify", {
      method: "POST",
      body: { raw: `ACCT9${utr}12  balance fwd` },
    });
    assert.equal(res.body.confirmed.length, 0);
  });

  it("E19 · a statement from the wrong week matches nobody, silently", async () => {
    const id = await resetDb({ capacity: 70 });
    await seedAttendees(id, 5, 5);

    const res = await admin.req("/api/admin/verify", {
      method: "POST",
      body: { raw: statement(["888800000001", "888800000002"], 20) },
    });
    assert.equal(res.body.confirmed.length, 0);
    assert.equal(res.body.pending.length, 5, "[E3] they stay pending, never auto-rejected");
    assert.equal(res.body.total.matched, 0);
  });

  it("9 · a 300 KB paste is refused with a clear message", async () => {
    await resetDb();
    const res = await admin.req("/api/admin/verify", {
      method: "POST",
      body: { raw: "9".repeat(300 * 1024) },
    });
    assert.equal(res.status, 413);
    assert.equal(res.body.error, "too_large");
    assert.match(res.body.message, /200 KB/);
  });

  it("S11 · the raw bank statement is never written to the audit log", async () => {
    const id = await resetDb({ capacity: 70 });
    await seedAttendees(id, 3, 3);
    const utrs = (await sql("select utr from attendees")).map((r) => r.utr);
    const raw = statement(utrs, 5);

    await admin.req("/api/admin/verify", { method: "POST", body: { raw } });

    const rows = await sql("select detail from audit_log where action = 'verify_bulk'");
    const blob = JSON.stringify(rows);
    assert.ok(!blob.includes("balance fwd"), "no statement text in the log");
    assert.ok(rows.some((r) => typeof r.detail.scanned === "number"), "counts only");
  });
});

// ===========================================================================
describe("the claim — §16.10–19", () => {
  it("10 · the first claim opens the green window and returns the coupon", async () => {
    await resetDb();
    const { pass, id } = await confirmedAttendee({ phone: "9111111111" });
    const [{ coupon_no }] = await sql("select coupon_no from attendees where id = $1", [id]);

    const res = await claim(pass);
    assert.equal(res.status, 200, "every outcome is a 200");
    assert.equal(res.body.ok, true);
    assert.equal(res.body.reason, "ok");
    assert.equal(res.body.coupon, coupon_no);
    assert.ok(Date.parse(res.body.until) > Date.parse(res.body.now), "window is open");
    assert.ok(res.body.claimed_at, "and stamped");
  });

  it("11 · claiming again inside the window returns the SAME claim, not a second one", async () => {
    await resetDb();
    const { pass } = await confirmedAttendee({ phone: "9111111112" });

    const first = await claim(pass);
    const again = await claim(pass);

    assert.equal(again.body.ok, true);
    assert.equal(again.body.reason, "active", "[R6] the same claim, still live");
    assert.equal(again.body.claimed_at, first.body.claimed_at, "timestamp is immutable");

    const rows = await sql("select count(*)::int n from attendees where state = 'claimed'");
    assert.equal(rows[0].n, 1);
  });

  it("12 · after the window expires the pass is spent, and keeps its original time", async () => {
    await resetDb();
    const { pass } = await confirmedAttendee({ phone: "9111111113" });
    const first = await claim(pass);

    await sql("update events set claim_seconds = 90");
    await sql("update attendees set claim_until = now() - interval '1 second' where pass_code = $1", [
      pass,
    ]);

    const res = await claim(pass);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, "already");
    assert.equal(res.body.claimed_at, first.body.claimed_at);
    assert.equal(res.body.until, null, "no new window is opened");
  });

  it("13 · an unpaid attendee cannot claim a drink", async () => {
    await resetDb();
    const reg = await register({ phone: "9111111114" });
    const res = await claim(reg.body.pass_code);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, "not_paid");
  });

  it("14 · E9 · a friend with no pass at all is blocked at the drink", async () => {
    await resetDb();
    const res = await claim("OM0609-NOPE");
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, "not_found");
    assert.equal(res.body.name ?? null, null, "and nothing leaks about anyone");
  });

  it("15 · a refunded pass is void at the drink", async () => {
    await resetDb();
    const { pass, id } = await confirmedAttendee({ phone: "9111111115" });
    await admin.req(`/api/admin/attendee/${id}/refund`, {
      method: "POST",
      body: { reason: "cancelled on Friday" },
    });

    const res = await claim(pass);
    assert.equal(res.body.reason, "void");
    assert.equal(res.body.coupon ?? null, null, "[R7] no number for a void pass");
  });

  it("16 · five concurrent claims on one pass yield exactly one claim", async () => {
    await resetDb();
    const { pass } = await confirmedAttendee({ phone: "9111111116" });

    const results = await Promise.all(Array.from({ length: 5 }, () => claim(pass)));
    const reasons = results.map((r) => r.body.reason).sort();

    assert.equal(reasons.filter((r) => r === "ok").length, 1, `one ok, got ${reasons.join(",")}`);
    assert.equal(reasons.filter((r) => r === "active").length, 4);

    const rows = await sql(
      "select count(*)::int n, count(distinct claimed_at)::int t from attendees where state = 'claimed'",
    );
    assert.equal(rows[0].n, 1, "one claimed row");
    assert.equal(rows[0].t, 1, "one immutable timestamp");
  });

  it("17 · E10 · an accidental claim can be reset in two taps, then claimed again", async () => {
    await resetDb();
    const { pass, id } = await confirmedAttendee({ phone: "9111111117" });
    await claim(pass);

    const reset = await admin.req(`/api/admin/attendee/${id}/reset-claim`, {
      method: "POST",
      body: {},
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.status, "reset");

    const [row] = await sql("select state, claimed_at, claim_until from attendees where id = $1", [id]);
    assert.equal(row.state, "confirmed");
    assert.equal(row.claimed_at, null);

    // [R8] and the admin can then claim it for them — phone dead, no signal
    const again = await admin.req(`/api/admin/attendee/${id}/claim`, { method: "POST" });
    assert.equal(again.body.ok, true);
    assert.equal(again.body.reason, "ok");

    const [after] = await sql("select claim_by from attendees where id = $1", [id]);
    assert.equal(after.claim_by, "admin", "claim_by records who did it");

    // [S9] and every reset lands in the append-only log with a reason
    const log = await sql("select detail from audit_log where action = 'reset_claim'");
    assert.equal(log.length, 1);
    assert.equal(log[0].detail.reason, "accidental tap");
  });

  it("17b · resetting a pass that was never claimed changes nothing", async () => {
    await resetDb();
    const { id } = await confirmedAttendee({ phone: "9111111118" });
    const res = await admin.req(`/api/admin/attendee/${id}/reset-claim`, {
      method: "POST",
      body: {},
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "bad_state");
  });

  it("18 · R12 · a walk-in is confirmed at door price and can claim a drink", async () => {
    await resetDb();
    const res = await admin.req("/api/admin/walkin", {
      method: "POST",
      body: { name: "Friend Of Guest", phone: "9800000001" },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.amount, 350);
    assert.equal(res.body.coupon, 1);
    assert.equal(res.body.url, `/pass/${res.body.pass_code}`);

    const [row] = await sql("select amount_paid, is_walkin, state from attendees where pass_code = $1", [
      res.body.pass_code,
    ]);
    assert.equal(row.amount_paid, 350);
    assert.equal(row.is_walkin, true);
    assert.equal(row.state, "confirmed");

    const drink = await claim(res.body.pass_code);
    assert.equal(drink.body.ok, true);
  });

  it("18b · a walk-in works after the cutoff — the jam is the day after it", async () => {
    await resetDb();
    await sql("update events set closes_at = now() - interval '12 hours'");

    const res = await admin.req("/api/admin/walkin", {
      method: "POST",
      body: { name: "Late Friend", phone: "9800000002" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.amount, 350);
  });

  it("18c · a walk-in already registered but unpaid is priced at the door, not refused", async () => {
    await resetDb();
    await register({ phone: "9800000003", name: "Came Anyway" });

    const res = await admin.req("/api/admin/walkin", {
      method: "POST",
      body: { name: "Came Anyway", phone: "9800000003" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.amount, 350);

    const rows = await sql("select count(*)::int n from attendees where phone = '9800000003'");
    assert.equal(rows[0].n, 1, "still one row — no duplicate person");
  });

  it("18d · R2 · a walk-in into a full room is refused, with the remedy named", async () => {
    const id = await resetDb({ capacity: 1 });
    await seedAttendees(id, 1, 1);
    await sql("select confirm_attendee(id, 'auto', null) from attendees");

    const res = await admin.req("/api/admin/walkin", {
      method: "POST",
      body: { name: "One Too Many", phone: "9800000004" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "over_capacity");
    assert.match(res.body.message, /capacity/i);
  });

  it("19 · R10 · 50 confirmed and 47 claimed settles at 15,000 / 12,500 / 2,500", async () => {
    const id = await resetDb({ capacity: 50 });
    await seedAttendees(id, 50, 50);
    await sql("select confirm_attendee(id, 'auto', null) from attendees");
    await sql(
      "select claim_drink($1, pass_code, 'self') from attendees where coupon_no <= 47",
      [id],
    );

    const [{ app_stats: s }] = await sql("select app_stats()");
    assert.equal(s.headcount, 50, "confirmed + claimed");
    assert.equal(s.claimed, 47, "drinks claimed");
    assert.equal(s.not_claimed, 3, "paid, didn't drink");
    assert.equal(s.collected, 15000);
    // [R10] the cafe is paid the COMMITTED HEADCOUNT, not the claim count.
    assert.equal(s.cafe_due, 12500);
    assert.equal(s.fund, 2500);
  });

  it("19b · a walk-in's extra ₹50 lands in the fund, and the cafe line does not move", async () => {
    const id = await resetDb({ capacity: 50 });
    await seedAttendees(id, 3, 3);
    await sql("select confirm_attendee(id, 'auto', null) from attendees");
    await admin.req("/api/admin/walkin", {
      method: "POST",
      body: { name: "Walkin Friend", phone: "9800000009" },
    });

    const [{ app_stats: s }] = await sql("select app_stats()");
    assert.equal(s.headcount, 4);
    assert.equal(s.collected, 3 * 300 + 350);
    assert.equal(s.cafe_due, 4 * 250, "flat per head, walk-in included");
    assert.equal(s.fund, 3 * 300 + 350 - 4 * 250);
    assert.equal(s.walkins, 1);
    assert.equal(s.walkin_fund, 350 - 250, "their whole contribution above the cafe's cut");
  });
});

// ===========================================================================
describe("the ticket API and the roster", () => {
  it("R7 · the pass endpoint withholds the coupon until it is real", async () => {
    await resetDb();
    const reg = await register({ phone: "9222222221" });
    const pass = reg.body.pass_code;

    const before = await pub().req(`/api/pass/${pass}`);
    assert.equal(before.body.state, "registered");
    assert.equal(before.body.coupon, null);

    const [{ id }] = await sql("select id from attendees where pass_code = $1", [pass]);
    await sql("select confirm_attendee($1, 'manual', null)", [id]);

    const after = await pub().req(`/api/pass/${pass}`);
    assert.equal(after.body.state, "confirmed");
    assert.equal(after.body.coupon, 1);
    assert.equal(after.body.claim_until, null, "not claimed, so no window");
    // §3.5 — the split is available to the ticket, from data
    assert.equal(after.body.event.cafe_share, 250);
    assert.equal(after.body.event.fund_share, 50);

    await admin.req(`/api/admin/attendee/${id}/refund`, {
      method: "POST",
      body: { reason: "asked to cancel" },
    });
    const voided = await pub().req(`/api/pass/${pass}`);
    assert.equal(voided.body.state, "refunded");
    assert.equal(voided.body.coupon, null, "a void pass never carries the number");
  });

  it("E12 · a claim survives a page reload with the same window", async () => {
    await resetDb();
    const { pass } = await confirmedAttendee({ phone: "9222222222" });
    const first = await claim(pass);

    const reloaded = await pub().req(`/api/pass/${pass}`);
    assert.equal(reloaded.body.state, "claimed");
    assert.equal(reloaded.body.claimed_at, first.body.claimed_at);
    assert.equal(reloaded.body.claim_until, first.body.until, "same window, not a new one");
    assert.ok(Date.parse(reloaded.body.now) > 0, "and a server clock to measure it against");
  });

  it("S10 · the floor roster carries phone4, never a full phone number", async () => {
    const id = await resetDb();
    await seedAttendees(id, 4, 4);
    await sql("select confirm_attendee(id, 'auto', null) from attendees");

    const res = await admin.req("/api/admin/roster");
    assert.equal(res.status, 200);
    assert.equal(res.body.people.length, 4);

    const blob = JSON.stringify(res.body);
    for (const p of res.body.people) {
      assert.equal(p.phone4.length, 4);
      assert.ok(p.pass && typeof p.coupon === "number");
    }
    assert.ok(!/\b9\d{9}\b/.test(blob), "no 10-digit number anywhere in the payload");
  });

  it("the roster holds only people who paid — an unpaid friend is not in it", async () => {
    const id = await resetDb();
    await seedAttendees(id, 2, 2);
    await sql("select confirm_attendee(id, 'auto', null) from attendees");
    await register({ phone: "9333333331", name: "Unpaid Friend" });

    const res = await admin.req("/api/admin/roster");
    assert.equal(res.body.people.length, 2);
    assert.ok(!JSON.stringify(res.body).includes("Unpaid Friend"));
  });

  it("E20 · PATCH transfers the seat — the person changes, the pass and coupon do not", async () => {
    await resetDb();
    const { pass, id } = await confirmedAttendee({ phone: "9444444441" });
    const [before] = await sql("select coupon_no from attendees where id = $1", [id]);

    const res = await admin.req(`/api/admin/attendee/${id}`, {
      method: "PATCH",
      body: { name: "New Owner", phone: "9444444442", email: "new@example.com" },
    });
    assert.equal(res.status, 200);

    const [after] = await sql(
      "select name, phone, pass_code, coupon_no from attendees where id = $1",
      [id],
    );
    assert.equal(after.name, "New Owner");
    assert.equal(after.phone, "9444444442");
    assert.equal(after.pass_code, pass);
    assert.equal(after.coupon_no, before.coupon_no);
  });
});

// ===========================================================================
describe("security — §16.27–28", () => {
  it("27 · every admin route returns 401 without a cookie and leaks nothing", async () => {
    const id = await resetDb();
    await seedAttendees(id, 2, 2);
    await sql("select confirm_attendee(id, 'auto', null) from attendees");
    const [{ id: attendeeId }] = await sql("select id from attendees limit 1");

    const anon = makeClient(mailed.base);
    const routes = [
      ["GET", "/api/admin/roster"],
      ["POST", "/api/admin/verify"],
      ["POST", "/api/admin/walkin"],
      ["POST", "/api/admin/event"],
      ["POST", "/api/admin/email/retry"],
      ["POST", `/api/admin/attendee/${attendeeId}/confirm`],
      ["POST", `/api/admin/attendee/${attendeeId}/claim`],
      ["POST", `/api/admin/attendee/${attendeeId}/reset-claim`],
      ["POST", `/api/admin/attendee/${attendeeId}/refund`],
      ["POST", `/api/admin/attendee/${attendeeId}/reject`],
      ["PATCH", `/api/admin/attendee/${attendeeId}`],
    ];

    for (const [method, path] of routes) {
      const res = await anon.req(path, { method, body: method === "GET" ? undefined : {} });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.body.error, "unauthorized");
      const blob = JSON.stringify(res.body);
      assert.ok(!blob.includes("Guest"), `${path} leaks no names`);
      assert.ok(!/\b9\d{9}\b/.test(blob), `${path} leaks no phone numbers`);
    }
  });

  it("S8 · admin pages redirect to the login form instead of rendering", async () => {
    const anon = makeClient(mailed.base);
    for (const path of ["/admin", "/admin/floor", "/admin/money", "/admin/people"]) {
      const res = await anon.req(path, { raw: true });
      assert.equal(res.status, 307, path);
      assert.match(res.headers.get("location") ?? "", /\/admin\/login/);
    }
  });

  it("S7 · a tampered session cookie is rejected", async () => {
    const forged = makeClient(mailed.base);
    forged.setCookie(`onmic_admin=${Date.now() + 999999}.${"f".repeat(64)}`);
    const res = await forged.req("/api/admin/roster");
    assert.equal(res.status, 401);
  });

  it("the public claim endpoint stays public — it is the attendee's own tap", async () => {
    await resetDb();
    const { pass } = await confirmedAttendee({ phone: "9555555551" });
    const anon = makeClient(mailed.base);
    const res = await anon.req("/api/claim", { method: "POST", body: { pass_code: pass } });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it("28 · the admin passcode is rate limited to 10 attempts per 10 minutes", async () => {
    const attacker = makeClient(mailed.base, "10.9.9.9");
    const codes = [];
    for (let i = 0; i < 20; i++) {
      const res = await attacker.req("/api/admin/login", {
        method: "POST",
        body: { passcode: `wrong-${i}` },
      });
      codes.push(res.status);
    }
    assert.equal(codes.filter((c) => c === 401).length, 10, "ten attempts, then the door shuts");
    assert.equal(codes.filter((c) => c === 429).length, 10);
  });

  it("E17 · /find returns the pass link by phone, and rate limits at 5 a minute", async () => {
    await resetDb();
    const reg = await register({ phone: "9666666661" });
    const client = makeClient(mailed.base, "10.8.8.8");

    const found = await client.req("/api/find", { method: "POST", body: { phone: "9666666661" } });
    assert.equal(found.status, 200);
    assert.equal(found.body.url, `/pass/${reg.body.pass_code}`);

    const codes = [];
    for (let i = 0; i < 8; i++) {
      const res = await client.req("/api/find", { method: "POST", body: { phone: "9666666661" } });
      codes.push(res.status);
    }
    assert.ok(codes.includes(429), "the lookup is rate limited");
  });
});

// ===========================================================================
describe("email — §16.25–26", () => {
  it("25 · with no RESEND_API_KEY, 50 people still confirm and nothing 500s", async () => {
    const id = await resetDb({ capacity: 50 });
    await seedAttendees(id, 50, 50);

    const quiet = makeClient(silent.base, "10.7.7.7");
    await loginAdmin(quiet);

    const utrs = (await sql("select utr from attendees where utr is not null")).map((r) => r.utr);
    const res = await quiet.req("/api/admin/verify", {
      method: "POST",
      body: { raw: statement(utrs, 20) },
    });

    assert.equal(res.status, 200, "[R9] email is never on the critical path");
    assert.equal(res.body.confirmed.length, 50);
    assert.ok(res.body.confirmed.every((c) => c.emailed === false));

    const rows = await sql(
      "select count(*)::int n from attendees where state = 'confirmed' and emailed_at is null",
    );
    assert.equal(rows[0].n, 50, "emailed_at stays null");
  });

  it("26 · provider down during verify, then fixed — /email/retry delivers all 50", async () => {
    const id = await resetDb({ capacity: 50 });
    await seedAttendees(id, 50, 50);
    mail.clear();
    mail.break();

    const utrs = (await sql("select utr from attendees where utr is not null")).map((r) => r.utr);
    const res = await admin.req("/api/admin/verify", {
      method: "POST",
      body: { raw: statement(utrs, 20) },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.confirmed.length, 50, "confirmations stand while email is down");
    assert.equal(mail.sent.length, 0);

    mail.fix();
    const retry = await admin.req("/api/admin/email/retry", { method: "POST" });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.sent, 50);

    const rows = await sql(
      "select count(*)::int n from attendees where state = 'confirmed' and emailed_at is null",
    );
    assert.equal(rows[0].n, 0, "everyone has now been emailed");
  });

  it("24 · the confirmation email carries the price, and NOT the per-head split", async () => {
    const id = await resetDb({ capacity: 50 });
    await seedAttendees(id, 1, 1);
    mail.clear();
    mail.fix();

    const utrs = (await sql("select utr from attendees where utr is not null")).map((r) => r.utr);
    await admin.req("/api/admin/verify", { method: "POST", body: { raw: statement(utrs, 5) } });

    assert.equal(mail.sent.length, 1);
    const sent = mail.sent[0];
    assert.match(sent.subject, /coupon #1$/);
    assert.match(sent.text, /₹300 paid/);
    assert.match(sent.text, /tap CLAIM/);

    // A client decision that reverses §3.5: the cafe share and the community
    // fund are settlement figures, not attendee-facing copy. They drive
    // /admin/money and must never reach an attendee.
    assert.doesNotMatch(sent.text, /community fund/i);
    assert.doesNotMatch(sent.text, /₹250/);
    assert.doesNotMatch(sent.text, /₹50\b/);
    assert.doesNotMatch(sent.html, /community fund/i);
    assert.doesNotMatch(sent.html, /₹250/);
  });

  it("the price follows the data — change the event, change the email", async () => {
    const id = await resetDb({ capacity: 50 });
    await sql("update events set price = 400, cafe_share = 320, fund_share = 80");
    await seedAttendees(id, 1, 1);
    mail.clear();

    const utrs = (await sql("select utr from attendees where utr is not null")).map((r) => r.utr);
    await admin.req("/api/admin/verify", { method: "POST", body: { raw: statement(utrs, 2) } });

    assert.match(mail.sent[0].text, /₹400 paid/);
    assert.doesNotMatch(mail.sent[0].text, /₹320/);
    assert.doesNotMatch(mail.sent[0].text, /₹80 community/);
  });

  it("submitting a payment reference emails an acknowledgement straight away", async () => {
    await resetDb({ capacity: 50 });
    mail.clear();
    mail.fix();

    const client = pub();
    const reg = await client.req("/api/register", {
      method: "POST",
      body: { name: "Rohit Iyer", phone: "9812345670", email: "rohit@example.com" },
    });
    assert.equal(reg.status, 200);
    assert.equal(mail.sent.length, 0, "registering alone is not a payment");

    const res = await client.req("/api/utr", {
      method: "POST",
      body: { pass_code: reg.body.pass_code, utr: "412345678901" },
    });
    assert.equal(res.status, 200);

    // The send is fire-and-forget, so give it a moment to reach the provider.
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(mail.sent.length, 1);
    const sent = mail.sent[0];
    assert.equal(sent.to, "rohit@example.com");
    assert.match(sent.subject, /got your payment/i);
    assert.match(sent.text, /4123…8901/, "the reference, masked");
    assert.match(sent.text, new RegExp(reg.body.pass_code));
    // It acknowledges, it does not confirm: the seat is only real once the
    // reference is matched on Saturday night.
    assert.doesNotMatch(sent.text, /coupon \d/i);
    assert.doesNotMatch(sent.text, /community fund/i);

    // And it is an acknowledgement only — emailed_at still tracks the
    // confirmation email with the coupon on it. [R9] / §13
    const rows = await sql("select emailed_at from attendees where pass_code = $1", [
      reg.body.pass_code,
    ]);
    assert.equal(rows[0].emailed_at, null);
  });

  it("[R9] a dead provider never breaks recording a payment reference", async () => {
    await resetDb({ capacity: 50 });
    mail.clear();
    mail.break();

    const client = pub();
    const reg = await client.req("/api/register", {
      method: "POST",
      body: { name: "Ananya Rao", phone: "9812345671", email: "ananya@example.com" },
    });
    const res = await client.req("/api/utr", {
      method: "POST",
      body: { pass_code: reg.body.pass_code, utr: "412345678902" },
    });

    assert.equal(res.status, 200, "the reference is recorded regardless");
    assert.equal(res.body.state, "submitted");
    await new Promise((r) => setTimeout(r, 400));

    const rows = await sql("select utr, state from attendees where pass_code = $1", [
      reg.body.pass_code,
    ]);
    assert.deepEqual(rows[0], { utr: "412345678902", state: "submitted" });
    mail.fix();
  });
});
