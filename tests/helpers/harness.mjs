import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55432/onmic_test";

export const ADMIN_PASSCODE = "test-passcode-9910";
export const AUTH_SECRET = "0".repeat(48) + "abcdef";

let pool;

export function db() {
  if (!pool) pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
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

/** One open event, capacity configurable, closing in the future by default. */
export async function resetDb({ capacity = 50, closesInHours = 48, claimSeconds = 90 } = {}) {
  await sql("truncate attendees, events, audit_log cascade");
  const rows = await sql(
    `insert into events (name, event_date, start_time, venue, capacity, claim_seconds,
                         upi_vpa, upi_name, closes_at)
     values ('On Mic Jam', current_date + 3, '5:00 PM', 'Pandu Nagar', $1, $3,
             'onmic@ybl', 'On Mic Community', now() + ($2 || ' hours')::interval)
     returning id`,
    [capacity, String(closesInHours), claimSeconds],
  );
  return rows[0].id;
}

/** Start `next start` with a specific environment and wait for it to answer. */
export async function startServer(port, extraEnv = {}) {
  const child = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL,
      ADMIN_PASSCODE,
      AUTH_SECRET,
      NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`server on ${port} did not start:\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${base}/closed`, { cache: "no-store" });
      if (res.status < 500) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    base,
    logs,
    stop: () =>
      new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 3000).unref?.();
      }),
  };
}

/**
 * Minimal cookie-aware fetch — enough for one admin session.
 *
 * Each client sends its own x-forwarded-for so rate-limit buckets stay isolated
 * between tests. In production Vercel sets that header itself and overwrites
 * anything the client supplies.
 */
let ipSeq = 0;
export function makeClient(base, ip = `10.0.0.${++ipSeq}`) {
  let cookie = "";
  return {
    base,
    ip,
    get cookie() {
      return cookie;
    },
    setCookie(value) {
      cookie = value;
    },
    async req(path, { method = "GET", body, headers = {}, raw = false } = {}) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          "x-forwarded-for": ip,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
        redirect: "manual",
        cache: "no-store",
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      for (const c of setCookie) {
        if (c.startsWith("onmic_admin=")) cookie = c.split(";")[0];
      }
      if (raw) return res;
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* not json */
      }
      return { status: res.status, body: json, headers: res.headers };
    },
  };
}

export async function loginAdmin(client) {
  const res = await client.req("/api/admin/login", {
    method: "POST",
    body: { passcode: ADMIN_PASSCODE },
  });
  if (res.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(res.body)}`);
  return res;
}

/** Seed attendees directly, the way tests.sql does, to keep tests focused. */
export async function seedAttendees(eventId, count, withUtr) {
  await sql(
    `insert into attendees (event_id, pass_code, name, phone, email, utr, utr_at, state)
     select $1,
            'OM0609-G' || lpad(g::text, 3, '0'),
            'Guest ' || g,
            '95' || lpad(g::text, 8, '0'),
            'guest' || g || '@example.com',
            case when g <= $3 then lpad((500000000000 + g)::text, 12, '0') else null end,
            case when g <= $3 then now() + (g || ' seconds')::interval else null end,
            case when g <= $3 then 'submitted' else 'registered' end
     from generate_series(1, $2) g`,
    [eventId, count, withUtr],
  );
}

/** A statement blob shaped like a real merchant export. */
export function statement(utrs, noise = 200, amount = "300.00") {
  const lines = utrs.map(
    (u, i) => `06/09/2026 18:${String(i % 60).padStart(2, "0")}  UPI/${u}/ONMIC  ${amount} Cr`,
  );
  for (let i = 1; i <= noise; i++) {
    lines.push(`06/09/2026  ACCT ${String(999000000000 + i)}  balance fwd`);
  }
  return lines.join("\n");
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = undefined;
}
