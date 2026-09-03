import { redirect } from "next/navigation";
import { rpc } from "@/lib/db";
import { rupees, shortDate } from "@/lib/format";
import type { Stats } from "@/lib/types";
import { AdminShell } from "@/components/AdminNav";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CafeCount } from "@/components/CafeCount";
import { CopyButton } from "@/components/CopyButton";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const stats = await rpc<(Stats & { error?: string }) | null>("app_stats");
  if (!stats || stats.error) redirect("/admin/event");

  const ev = stats.event;

  // §11.5 — the exact text that gets pasted into WhatsApp. It says "committed
  // headcount", not "drinks", because that is the deal. [R10]
  const summary = [
    `${ev.name} — ${shortDate(ev.event_date)}`,
    `Committed headcount: ${stats.headcount}`,
    `Rate: ₹${ev.cafe_share} per head (entry + 1 mocktail)`,
    `Total: ${rupees(stats.cafe_due)} — paying by UPI now.`,
    ``,
    `Our records: ${stats.claimed} mocktail${stats.claimed === 1 ? "" : "s"} claimed.`,
    `Please confirm your count matches.`,
  ].join("\n");

  return (
    <AdminShell active="/admin/money">
      <AutoRefresh seconds={20} />
      <h1 className="text-lg font-bold tracking-widest text-white uppercase">Money</h1>

      <div className="mt-4 overflow-hidden rounded-xl border border-line">
        <Line
          label="Confirmed + claimed"
          sub={`${stats.headcount} people`}
          total={stats.collected}
          note="collected"
        />
        <Line
          label="Committed to cafe"
          sub={`${stats.headcount} × ₹${ev.cafe_share}`}
          total={stats.cafe_due}
          note="flat, agreed in advance"
          tone="good"
        />
        <Line label="Community fund" sub="" total={stats.fund} note="" tone="brand" />
        {stats.walkins > 0 && (
          <div className="flex items-baseline justify-between border-b border-line bg-card px-4 py-2 pl-8">
            <span className="text-xs text-dim tnum">
              of which walk-ins · {stats.walkins} × ₹{ev.door_price - ev.cafe_share}
            </span>
            <span className="text-sm text-muted tnum" data-testid="walkin-fund">
              {rupees(stats.walkin_fund)}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Count label="Drinks claimed" value={stats.claimed} testid="drinks-claimed" tone="good" />
        <Count
          label="Not claimed"
          value={stats.not_claimed}
          testid="not-claimed"
          hint="paid, didn't drink"
        />
      </div>

      <CafeCount claimed={stats.claimed} />

      {/* [R10] is counter-intuitive and stated explicitly so that it is never
          mistaken for a bug at 11 PM on a Sunday. */}
      <p className="mt-4 rounded-xl border border-line bg-card p-4 text-xs leading-relaxed text-muted">
        The cafe is paid the <strong className="text-bright">committed headcount</strong>, not the
        claim count. That is deliberate: it makes an over-served mocktail the cafe&apos;s cost rather
        than the community&apos;s, which is what gives them a reason to check the green screen.
        Someone who prepaid and never drank is still paid for; their ₹{ev.fund_share} stays with the
        fund. Claims are a leak detector, not an invoice.
      </p>

      <div className="mt-5 rounded-xl border border-line bg-card p-4">
        <pre className="overflow-x-auto text-xs whitespace-pre-wrap text-bright" data-testid="cafe-summary">
          {summary}
        </pre>
        <CopyButton text={summary} label="Copy cafe summary" className="btn btn-brand mt-4" />
      </div>
    </AdminShell>
  );
}

function Line({
  label,
  sub,
  total,
  note,
  tone = "plain",
}: {
  label: string;
  sub: string;
  total: number;
  note: string;
  tone?: "plain" | "good" | "brand";
}) {
  const color = tone === "good" ? "text-good" : tone === "brand" ? "text-brand" : "text-white";
  return (
    <div className="flex items-baseline justify-between border-b border-line bg-card px-4 py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white uppercase">{label}</div>
        {sub && <div className="text-xs text-dim tnum">{sub}</div>}
      </div>
      <div className="text-right">
        <div
          className={`text-xl font-bold tnum ${color}`}
          data-testid={`total-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
        >
          {rupees(total)}
        </div>
        {note && <div className="text-[11px] text-dim">{note}</div>}
      </div>
    </div>
  );
}

function Count({
  label,
  value,
  testid,
  hint,
  tone = "plain",
}: {
  label: string;
  value: number;
  testid: string;
  hint?: string;
  tone?: "plain" | "good";
}) {
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div
        className={`text-3xl font-bold tnum ${tone === "good" ? "text-good" : "text-white"}`}
        data-testid={testid}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] tracking-wide text-dim uppercase">{label}</div>
      {hint && <div className="text-[11px] text-dim">({hint})</div>}
    </div>
  );
}
