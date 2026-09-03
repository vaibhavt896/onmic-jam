import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/cookie";
import { describe } from "@/lib/messages";

/**
 * [S8] The cookie check lives here so a new admin route cannot ship
 * unprotected by accident. §10.7 names the two matchers; every admin endpoint
 * in §9 sits under one of them, and POST /api/claim is public by design —
 * it is the attendee tapping CLAIM on their own phone.
 */
const PUBLIC = new Set(["/admin/login", "/api/admin/login"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();

  if (await verifySession(req.cookies.get(COOKIE_NAME)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    const d = describe("unauthorized");
    return NextResponse.json({ error: "unauthorized", message: d.message }, { status: d.status });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
