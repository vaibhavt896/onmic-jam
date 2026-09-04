/**
 * §6 startup validation.
 *
 * A missing secret must fail at deploy, never at 6 PM on a Sunday. This module
 * is imported by src/lib/db.ts, so it runs the moment anything touches data.
 */

export type Driver = "supabase" | "pg";

function need(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
        `See .env.example and §6 of the build specification.`,
    );
  }
  return v;
}

/**
 * Production uses @supabase/supabase-js over HTTP (§5). Local development and
 * the acceptance harness set DATABASE_URL and talk to Postgres directly — same
 * SQL functions either way, so the tests exercise the production code paths.
 */
export const DRIVER: Driver = process.env.DATABASE_URL ? "pg" : "supabase";

export const env = (() => {
  const ADMIN_PASSCODE = need("ADMIN_PASSCODE");
  const AUTH_SECRET = need("AUTH_SECRET");

  if (AUTH_SECRET.length < 32) {
    throw new Error(
      `[env] AUTH_SECRET must be at least 32 characters (got ${AUTH_SECRET.length}). ` +
        `Generate one with: openssl rand -hex 32`,
    );
  }

  const base = {
    ADMIN_PASSCODE,
    AUTH_SECRET,
    SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    RESEND_API_KEY: process.env.RESEND_API_KEY || "",
    EMAIL_FROM: process.env.EMAIL_FROM || "",
    SMS_WEBHOOK_SECRET: process.env.SMS_WEBHOOK_SECRET || "",
  };

  if (DRIVER === "pg") {
    return { ...base, DATABASE_URL: need("DATABASE_URL"), SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" };
  }

  return {
    ...base,
    DATABASE_URL: "",
    SUPABASE_URL: need("NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: need("SUPABASE_SERVICE_ROLE_KEY"),
  };
})();

/** Email is optional; the app must work fully without it. [R8] */
export const emailEnabled = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
