/**
 * Real scarcity.
 *
 * "Never fake urgency, fake countdowns, or 'only 2 left' that resets. Gen Z
 * identifies manufactured scarcity instantly and it costs trust permanently."
 * Both numbers come from the events table — `taken` is the confirmed headcount,
 * not registrations, which is the honest number and the one that drives
 * prepayment.
 *
 * Pure CSS: the fill grows on load with no JavaScript, so the page is fully
 * readable and bookable with scripting off.
 */
export function SeatMeter({ taken, capacity }: { taken: number; capacity: number }) {
  const left = Math.max(0, capacity - taken);
  const pct = capacity > 0 ? Math.min(100, Math.round((taken / capacity) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2" data-testid="seat-meter">
      <div className="flex items-baseline justify-between gap-3">
        <span className="mono text-text-3">Seats left</span>
        <span className="tnum text-[15px] font-medium" data-testid="seats-left">
          {left} / {capacity}
        </span>
      </div>
      <div className="meter-bar">
        <div
          className="meter-fill"
          style={{ width: `${pct}%`, animation: "grow 1.1s var(--e-out) both" }}
        />
      </div>
      <style>{`@keyframes grow{from{width:0}}`}</style>
    </div>
  );
}
