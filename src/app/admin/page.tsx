import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { rpc } from "@/lib/db";
import { env } from "@/lib/env";
import { dayTime, shortDate } from "@/lib/format";
import type { Stats } from "@/lib/types";
import { AdminShell } from "@/components/AdminNav";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CopyButton } from "@/components/CopyButton";
import { EventControls } from "@/components/EventControls";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const stats = await rpc<(Stats & { error?: string }) | null>("app_stats");
  if (!stats || stats.error) redirect("/admin/event");

  const ev = stats.event;

  // Taken from the request, not from NEXT_PUBLIC_SITE_URL: that variable is
  // inlined at build time, so a deploy where it was missing would hand the
  // admin a wrong link to paste into WhatsApp dozens of times.
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  const registerUrl = host ? `${proto}://${host}/` : `${env.SITE_URL}/`;

  return (
    <AdminShell active="/admin">
      <AutoRefresh />

      <header>
        <h1 className="text-xl font-bold text-white">{ev.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {shortDate(ev.event_date)}
          {ev.start_time ? ` · ${ev.start_time}` : ""}
          {ev.venue ? ` · ${ev.venue}` : ""}
        </p>
        <p className="mt-1 text-xs text-dim">
          {ev.status === "open" && ev.is_open
            ? `Registration open until ${dayTime(ev.closes_at)}`
            : ev.status === "done"
              ? "Event marked done"
              : "Registration closed"}
        </p>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="Registered" value={stats.registered} />
        <Tile label="Submitted" value={stats.submitted} tone="brand" />
        <Tile label="Confirmed" value={stats.headcount} tone="good" />
        <Tile label="Drinks" value={stats.claimed} tone="good" />
        <Tile label="Seats left" value={stats.seats_left} />
        <Tile label="Void" value={stats.refunded + stats.rejected} />
      </section>

      <section className="mt-4 grid grid-cols-2 gap-2">
        <Big href="/admin/verify" label="Verify payments" hint={`${stats.submitted} waiting`} />
        <Big href="/admin/floor" label="Floor" hint={`${stats.claimed} drinks claimed`} />
        <Big href="/admin/money" label="Money" hint="Settlement" />
        <Big href="/admin/people" label="People" hint="Search & fix" />
      </section>

      {/* This URL gets pasted into WhatsApp dozens of times. */}
      <section className="mt-6 rounded-xl border border-line bg-card p-4">
        <h2 className="text-xs font-semibold tracking-widest text-dim uppercase">
          Public registration link
        </h2>
        <p className="mt-2 break-all text-sm text-bright">{registerUrl}</p>
        <CopyButton text={registerUrl} label="Copy link" className="btn btn-ghost mt-3" />
      </section>

      <EventControls event={ev} />

      <Link
        href="/admin/event"
        className="mt-4 block text-center text-sm text-brand tap leading-[48px]"
      >
        Edit full event details →
      </Link>
    </AdminShell>
  );
}

function Tile({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: number;
  tone?: "plain" | "brand" | "good";
}) {
  const color = tone === "good" ? "text-good" : tone === "brand" ? "text-brand" : "text-white";
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className={`text-3xl font-bold tnum ${color}`} data-testid={`tile-${label.toLowerCase().replace(/\s/g, "-")}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] tracking-wide text-dim uppercase">{label}</div>
    </div>
  );
}

function Big({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <Link href={href} className="rounded-xl border border-line bg-surface p-4">
      <div className="text-base font-semibold text-white">{label}</div>
      <div className="mt-0.5 text-xs text-dim">{hint}</div>
    </Link>
  );
}
