/** Everything is displayed in IST — the audience, the venue and both admins. */
const IST = "Asia/Kolkata";

/**
 * en-IN renders "Sun, 16 Aug" and "9:00 pm"; the copy deck in the spec says
 * "Sun 16 Aug" and "9:00 PM". Normalise once, here, so every screen agrees.
 */
function tidy(s: string): string {
  return s.replace(/,/g, "").replace(/\b(am|pm)\b/g, (m) => m.toUpperCase());
}

function fmt(value: string | Date, opts: Intl.DateTimeFormatOptions): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return tidy(new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...opts }).format(d));
}

/** A bare `date` from Postgres is midnight UTC; read it as a plain calendar day. */
function asDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

/** "Sun 16 Aug" */
export function shortDate(ymd: string): string {
  return tidy(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(asDate(ymd)),
  );
}

/** "Sunday" — the email opens "See you Sunday", rendered from the event date. */
export function weekday(ymd: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long" }).format(asDate(ymd));
}

/** "Sunday 16 August" */
export function longDate(ymd: string): string {
  return tidy(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(asDate(ymd)),
  );
}

/** "Sat 9:00 PM" */
export function dayTime(iso: string): string {
  return fmt(iso, { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

/** "6:42 PM" */
export function clockTime(iso: string): string {
  return fmt(iso, { hour: "numeric", minute: "2-digit", hour12: true });
}

/** "₹13,340" */
export function rupees(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

/** "4123…8901" — enough for someone to recognise their own reference. */
export function maskUtr(utr: string): string {
  return utr.length === 12 ? `${utr.slice(0, 4)}…${utr.slice(-4)}` : utr;
}

export function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/** For a datetime-local input, which has no timezone: render IST wall-clock. */
export function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** The inverse: treat a datetime-local value as IST (+05:30). */
export function fromLocalInput(value: string): string {
  return `${value}:00+05:30`;
}
