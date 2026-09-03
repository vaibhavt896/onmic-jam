import { dayTime } from "@/lib/format";

/**
 * The locked venue — "mystery is the product".
 *
 * This is not a limitation to work around: it is the strongest conversion
 * device on the page, and it gives the confirmed screen a reason to be
 * re-opened, which brings people back before the jam.
 *
 * The blur is a visual effect and never a security boundary. When the address
 * is locked the server sends `venue: null` — there is nothing behind the blur
 * to read in the HTML, the JSON, or the DOM. See app_event_json.
 */
export function LockedVenue({
  venue,
  locked,
  unlocksAt,
  compact = false,
}: {
  venue: string | null;
  locked: boolean;
  unlocksAt: string;
  compact?: boolean;
}) {
  if (!locked && !venue) return null;

  return (
    <section
      className={`relative overflow-hidden rounded-card border border-line bg-surface ${
        compact ? "p-4" : "p-5"
      }`}
      data-testid="venue-card"
    >
      {locked && <span className="shimmer" aria-hidden="true" />}

      <span className="mono mb-3 flex items-center gap-2 text-flare">
        {locked ? `🔒 Address drops ${dayTime(unlocksAt)}` : "📍 Venue"}
      </span>

      {locked ? (
        <>
          {/* Nothing real is under this blur — the address has not been sent. */}
          <div className="locked-blur" aria-hidden="true">
            <p className="dsp text-[26px] leading-[1.05]">
              Kanpur
              <br />
              somewhere good
            </p>
          </div>
          <p className="mt-2 text-[13px] text-text-3">
            We send the address to everyone who has booked, the evening before.
          </p>
        </>
      ) : (
        <p className="dsp text-[26px] leading-[1.05]" data-testid="venue-name">
          {venue}
        </p>
      )}
    </section>
  );
}
