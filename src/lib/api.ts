import { NextResponse } from "next/server";
import { describe } from "./messages";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** §10: every error body carries a machine code and a ready-to-render sentence. */
export function fail(code: string, status?: number) {
  const d = describe(code);
  return NextResponse.json({ error: code, message: d.message }, { status: status ?? d.status });
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
