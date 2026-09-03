/**
 * §10.8 admin session cookie.
 *
 * value: <expiry_ms>.<hex hmac-sha256(expiry_ms, AUTH_SECRET)>
 *
 * Written with Web Crypto rather than node:crypto so the identical verifier
 * runs inside middleware.ts (Edge runtime) and inside route handlers. [S7]
 */

export const COOKIE_NAME = "onmic_admin";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("[auth] AUTH_SECRET is missing or shorter than 32 characters");
  }
  return s;
}

async function hmac(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare — Web Crypto has no timingSafeEqual. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(ttlSeconds = COOKIE_MAX_AGE): Promise<string> {
  const expiry = String(Date.now() + ttlSeconds * 1000);
  return `${expiry}.${await hmac(expiry)}`;
}

export async function verifySession(value: string | undefined | null): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const expiry = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(expiry)) return false;
  if (!safeEqual(sig, await hmac(expiry))) return false;
  return Number(expiry) > Date.now();
}

export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}
