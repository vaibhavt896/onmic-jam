/**
 * The only data access in the app.
 *
 * Every call is `rpc("<function>", {...})` against a Postgres function that
 * returns json. Nothing in src/app builds SQL or a PostgREST query, which is
 * what §8 asks for ("the API layer must not UPDATE attendees SET state = ...")
 * generalised to reads as well.
 *
 * Two transports, identical SQL:
 *   supabase — production, HTTP, service-role key, bypasses RLS  [S1]
 *   pg       — local dev and the acceptance harness (DATABASE_URL set)
 */
import type { Pool } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DRIVER, env } from "./env";

type Args = Record<string, unknown>;

// Cached on globalThis so Next's dev-mode module reloading does not open a new
// connection pool on every edit.
const g = globalThis as typeof globalThis & {
  __onmicPg?: Pool;
  __onmicSupabase?: SupabaseClient;
  __onmicSig?: Map<string, { names: string[]; types: string[] }>;
};

// ---------------------------------------------------------------------------
// pg transport

async function pool(): Promise<Pool> {
  if (!g.__onmicPg) {
    const { Pool: PgPool } = await import("pg");
    g.__onmicPg = new PgPool({ connectionString: env.DATABASE_URL, max: 10 });
  }
  return g.__onmicPg;
}

/**
 * Look up a function's declared argument names and types so the call can be
 * built with explicit casts. Without the casts Postgres cannot always infer a
 * placeholder's type, and a null uuid argument fails outright.
 */
async function signature(fn: string): Promise<{ names: string[]; types: string[] }> {
  if (!g.__onmicSig) g.__onmicSig = new Map();
  const hit = g.__onmicSig.get(fn);
  if (hit) return hit;

  const p = await pool();
  const { rows } = await p.query(
    `select p.proargnames::text[] as names,
            array(select format_type(t, null)
                    from unnest(p.proargtypes) with ordinality u(t, ord)
                   order by u.ord) as types
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where p.proname = $1 and n.nspname = 'public'
      limit 1`,
    [fn],
  );
  if (!rows[0]) throw new Error(`[db] no such database function: ${fn}`);
  const sig = { names: rows[0].names ?? [], types: rows[0].types ?? [] };
  g.__onmicSig.set(fn, sig);
  return sig;
}

async function pgRpc<T>(fn: string, args: Args): Promise<T> {
  const p = await pool();
  const { names, types } = await signature(fn);
  const values = names.map((n) => {
    const v = args[n];
    return v === undefined ? null : v;
  });
  const placeholders = names.map((_, i) => `$${i + 1}::${types[i]}`).join(", ");
  const { rows } = await p.query(
    `select ${fn}(${placeholders}) as result`,
    values,
  );
  return rows[0]?.result as T;
}

// ---------------------------------------------------------------------------
// supabase transport

function client(): SupabaseClient {
  if (!g.__onmicSupabase) {
    g.__onmicSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return g.__onmicSupabase;
}

async function supabaseRpc<T>(fn: string, args: Args): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error(`[db] ${fn}: ${error.message}`);
  return data as T;
}

// ---------------------------------------------------------------------------

export function rpc<T>(fn: string, args: Args = {}): Promise<T> {
  return DRIVER === "pg" ? pgRpc<T>(fn, args) : supabaseRpc<T>(fn, args);
}
