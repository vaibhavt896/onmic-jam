import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55432/onmic_e2e";

export const PASSCODE = "test-passcode-9910";

let pool;
function db() {
  if (!pool) pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
  return pool;
}

export async function sql(text, params = []) {
  const { rows } = await db().query(text, params);
  return rows;
}

export async function applySchema() {
  await sql(readFileSync(join(ROOT, "handoff/supabase/schema.sql"), "utf8"));
  await sql(readFileSync(join(ROOT, "supabase/app.sql"), "utf8"));
}

/** A fresh open event with `confirmed` attendees ready to walk through the door. */
export async function seedEvent({ confirmed = 12, capacity = 50, claimSeconds = 90 } = {}) {
  await applySchema();
  await sql("truncate attendees, events, audit_log cascade");
  const [{ id }] = await sql(
    `insert into events (name, event_date, start_time, venue, capacity, claim_seconds,
                         upi_vpa, upi_name, closes_at)
     values ('On Mic Jam', current_date + 3, '5:00 PM', 'Pandu Nagar', $1, $2,
             'onmic@ybl', 'On Mic Community', now() + interval '2 days')
     returning id`,
    [capacity, claimSeconds],
  );

  // Deliberately includes "Vaibhav Tiwari" and "Vaibhavi Sharma" so the search
  // box is exercised on a genuine prefix collision, as in §11.4's mockup.
  const names = [
    "Vaibhav Tiwari", "Vaibhavi Sharma", "Aditya Prakash Gupta", "Ananya Rao",
    "Rohit Verma", "Sneha Kulkarni", "Imran Qureshi", "Priya Nair",
    "Karan Mehta", "Divya Iyer", "Farhan Ali", "Meera Joshi",
    "Nikhil Bose", "Tanvi Desai", "Arjun Menon", "Zoya Khan",
  ];

  for (let g = 1; g <= confirmed; g++) {
    await sql(
      `insert into attendees (event_id, pass_code, name, phone, email, utr, utr_at, state)
       values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval, 'submitted')`,
      [
        id,
        `OM0609-P${String(g).padStart(3, "0")}`,
        names[(g - 1) % names.length],
        `9${String(700000000 + g).padStart(9, "0")}`,
        `p${g}@example.com`,
        String(600000000000 + g).padStart(12, "0"),
        String(g),
      ],
    );
  }

  await sql(
    "select confirm_attendee(id, 'auto', null) from attendees where event_id = $1 order by utr_at",
    [id],
  );

  return id;
}

/**
 * Signs in through the API rather than the form.
 *
 * [S6] caps logins at 10 per IP per 10 minutes and this suite signs in far more
 * often than that, so each call presents its own x-forwarded-for. The form
 * itself is covered by its own test below. `page.request` shares the browser
 * context's cookie jar, so the session lands where the page can use it.
 */
let loginIp = 0;
export async function login(page) {
  const res = await page.request.post("/api/admin/login", {
    data: { passcode: PASSCODE },
    headers: { "x-forwarded-for": `10.1.0.${++loginIp}` },
  });
  if (!res.ok()) throw new Error(`admin login failed: ${res.status()}`);
  await page.goto("/admin");
  await page.waitForLoadState("domcontentloaded");
}

export async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}
