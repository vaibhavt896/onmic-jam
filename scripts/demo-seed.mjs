/**
 * Seeds the local database with a realistic mid-week state so every screen has
 * something to show, and writes a paste-ready merchant statement.
 *
 *   DATABASE_URL=... node scripts/demo-seed.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query(readFileSync(join(root, "handoff/supabase/schema.sql"), "utf8"));
await c.query(readFileSync(join(root, "supabase/app.sql"), "utf8"));
await c.query("truncate attendees, events, audit_log cascade");

const {
  rows: [ev],
} = await c.query(
  `insert into events (name, event_date, start_time, venue, capacity,
                       upi_vpa, upi_name, closes_at)
   values ('On Mic Jam', current_date + 3, '5:00 PM', 'Pandu Nagar', 50,
           'tiwarvaibhav997@okicici', 'On Mic Community', now() + interval '2 days')
   returning id`,
);

const FIRST = ["Vaibhav", "Vaibhavi", "Aditya", "Ananya", "Rohit", "Sneha", "Imran", "Priya",
  "Karan", "Divya", "Farhan", "Meera", "Nikhil", "Tanvi", "Arjun", "Zoya", "Ishaan", "Kavya",
  "Rehan", "Nandini", "Yash", "Aisha", "Dev", "Riya"];
const LAST = ["Tiwari", "Sharma", "Gupta", "Rao", "Verma", "Kulkarni", "Qureshi", "Nair",
  "Mehta", "Iyer", "Ali", "Joshi", "Bose", "Desai", "Menon", "Khan"];

const alphabet = "ACDEFGHJKLMNPQRTUVWXY34679";
const seen = new Set();
function pass(date) {
  for (;;) {
    let tail = "";
    for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(Math.random() * 26)];
    const code = `OM${date}-${tail}`;
    if (!seen.has(code)) return seen.add(code), code;
  }
}

const {
  rows: [{ dm }],
} = await c.query("select to_char(event_date, 'DDMM') dm from events where id = $1", [ev.id]);

/* 12 already confirmed (4 of them already drinking), 30 waiting on Saturday's
   reconciliation, 7 registered but never paid, 1 fresh registration. */
const PAID = 30;
const PRECONFIRMED = 12;
const NO_UTR = 7;
const total = PRECONFIRMED + PAID + NO_UTR + 1;
const utrs = [];

for (let g = 1; g <= total; g++) {
  const hasUtr = g <= PRECONFIRMED + PAID;
  const utr = hasUtr ? String(500000000000 + g * 7919).slice(0, 12) : null;
  if (hasUtr && g > PRECONFIRMED) utrs.push(utr);
  await c.query(
    `insert into attendees (event_id, pass_code, name, phone, email, instagram,
                            utr, utr_at, state)
     values ($1, $2, $3, $4, $5, $6, $7::text,
             case when $7::text is null then null
                  else now() + ($8::text || ' seconds')::interval end,
             case when $7::text is null then 'registered' else 'submitted' end)`,
    [
      ev.id,
      pass(dm),
      `${FIRST[(g - 1) % FIRST.length]} ${LAST[(g * 5) % LAST.length]}`,
      `9${String(700000000 + g * 137).padStart(9, "0")}`,
      `guest${g}@example.com`,
      g % 3 === 0 ? `guest_${g}` : null,
      utr,
      String(g),
    ],
  );
}

await c.query(
  `select confirm_attendee(id, 'auto', null) from (
     select id from attendees where event_id = $1 and state = 'submitted'
     order by utr_at limit $2) x`,
  [ev.id, PRECONFIRMED],
);
await c.query(
  "select claim_drink($1, pass_code, 'self') from attendees where event_id = $1 and coupon_no <= 4",
  [ev.id],
);

// A paste-ready export: the 40 unmatched references, salted with unrelated numbers.
const lines = [];
utrs.forEach((u, i) =>
  lines.push(`${String(5 + (i % 2)).padStart(2, "0")}/09/2026 ${19 + (i % 3)}:${String(i % 60).padStart(2, "0")}  UPI/${u}/ONMIC  300.00 Cr`),
);
for (let i = 1; i <= 120; i++) {
  lines.push(`05/09/2026  ACCT ${String(4726100000000000 + i)}  carried forward  0.00`);
}
lines.sort(() => Math.random() - 0.5);
const out = join(root, "sample-statement.txt");
writeFileSync(out, lines.join("\n"));

const { rows: samples } = await c.query(
  `select pass_code, name, state, coupon_no from attendees where event_id = $1
    and (coupon_no in (1, 5) or state in ('registered', 'submitted'))
    order by coupon_no nulls last, state, created_at limit 12`,
  [ev.id],
);

console.log(`event ${ev.id}`);
console.log(`statement written to ${out} (${utrs.length} real references + 120 decoys)`);
console.table(samples);
await c.end();
