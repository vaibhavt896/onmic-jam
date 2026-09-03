import Link from "next/link";
import { redirect } from "next/navigation";
import { rpc } from "@/lib/db";
import { dayTime, shortDate } from "@/lib/format";
import type { EventJson } from "@/lib/types";
import { RegisterForm } from "@/components/RegisterForm";
import { SeatMeter } from "@/components/SeatMeter";
import { LockedVenue } from "@/components/LockedVenue";
import { ReelRail } from "@/components/ReelRail";
import { StickyBar } from "@/components/StickyBar";

export const dynamic = "force-dynamic";

/**
 * Design screens 01 and 02 — landing, then booking.
 *
 * One route, two screens: the hero owns the first viewport (headline, real seat
 * meter, reels, the locked venue) and the form is the screen below it. That is
 * what gives the sticky bar a job — it rises over the hero and yields once the
 * form is actually in reach, so there are never two primary actions at once.
 *
 * Designed at 390px. Everything above that is the same layout with more gutter,
 * which is why there is no separate desktop design and should not be one.
 */
export default async function RegisterPage() {
  const event = await rpc<EventJson | null>("app_public_event");
  // [E20] / [R3] — no open event, or past the cutoff, and this page is gone.
  if (!event || !event.is_open) redirect("/closed");

  const taken = event.confirmed_count;

  return (
    <>
      <main className="mx-auto w-full max-w-md px-5 sm:max-w-lg">
        {/* ---- screen 01 · the hero ------------------------------------- */}
        {/* Vertically centred: until there are reels in the rail the hero is
            shorter than the viewport, and centred whitespace reads as composed
            where a bottom-pinned gap reads as a bug. */}
        <section className="flex min-h-[100svh] flex-col justify-center pt-9 pb-28">
          <header className="rise">
            <p className="mono text-flare">
              {shortDate(event.event_date)}
              {event.start_time ? ` · ${event.start_time}` : ""}
            </p>
            <h1 className="dsp mt-3 text-[clamp(44px,13vw,72px)]">{event.name}</h1>
            <p className="mt-4 text-[17px] leading-[1.45] font-semibold text-text-2">
              {event.capacity} people, a cafe, and whoever picks up the mic.
            </p>
          </header>

          <div className="mt-7">
            <SeatMeter taken={taken} capacity={event.capacity} />
          </div>

          <div className="mt-6">
            <ReelRail />
          </div>

          {/* Mystery is the product: a locked object that visibly wants to be
              opened, and the address is not in this page until it drops. */}
          <div className="mt-6">
            <LockedVenue
              venue={event.venue}
              locked={event.venue_locked}
              unlocksAt={event.venue_unlocks_at}
            />
          </div>

          <p className="mono mt-8 text-center text-text-3">Closes {dayTime(event.closes_at)}</p>
        </section>

        {/* ---- screen 02 · book ----------------------------------------- */}
        <section className="pb-32">
          <h2 className="dsp text-[clamp(28px,8vw,40px)]">
            Who&apos;s
            <br />
            coming?
          </h2>

          {/* The per-head split (cafe share / community fund) is deliberately
              NOT shown to attendees — a client decision that reverses §3.5 of
              the spec. events.cafe_share and events.fund_share still drive the
              settlement on /admin/money; they are simply not published here. */}
          <section
            className="mt-5 rounded-card border border-line bg-surface p-5"
            data-testid="price-card"
          >
            <div className="dsp text-[40px] text-flare">₹{event.price}</div>
            <p className="mt-2 text-sm text-text-2">
              per person — entry and one mocktail, prepaid.
            </p>
          </section>

          <RegisterForm price={event.price} />

          {/* Prepayment fails without a visible exit. People who cannot see how
              to get their money back simply do not pay. §11.2 */}
          <p className="mt-4 text-[13px] leading-[1.5] text-text-3">
            Full refund any time before {dayTime(event.closes_at)}. After that, pass your seat to a
            friend — just tell us the name. Walk-ins on the day are ₹{event.door_price}.
          </p>

          <Link
            href="/find"
            className="press tap mt-5 flex items-center justify-center text-sm font-semibold text-flare"
          >
            Already booked? Find my pass →
          </Link>
        </section>
      </main>

      <StickyBar
        price={event.price}
        seatsLeft={Math.max(0, event.capacity - taken)}
        targetId="book"
      />
    </>
  );
}
