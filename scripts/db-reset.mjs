/**
 * Reset the local database to a single open event.
 *
 *   node scripts/db-reset.mjs [--capacity 50] [--closes "+2 days"]
 *
 * Local development and the acceptance harness only. Refuses to run without
 * DATABASE_URL so it can never point at Supabase.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. This script is for local Postgres only.");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const client = new pg.Client({ connectionString: url });
await client.connect();

if (args.includes("--schema")) {
  await client.query(readFileSync(join(root, "handoff/supabase/schema.sql"), "utf8"));
  await client.query(readFileSync(join(root, "supabase/app.sql"), "utf8"));
  console.log("schema + app functions applied");
}

await client.query("truncate attendees, events, audit_log cascade");

const capacity = Number(flag("capacity", "50"));
const closesAt = flag("closes", null);

const { rows } = await client.query(
  `insert into events (name, event_date, start_time, venue, capacity,
                       upi_vpa, upi_name, closes_at)
   values ('On Mic Jam', current_date + 3, '5:00 PM', 'Pandu Nagar', $1,
           'tiwarvaibhav997@okicici', 'On Mic Community',
           coalesce($2::timestamptz, now() + interval '2 days'))
   returning id, capacity, closes_at`,
  [capacity, closesAt],
);

console.log("event", rows[0].id, "capacity", rows[0].capacity, "closes", rows[0].closes_at);
await client.end();
