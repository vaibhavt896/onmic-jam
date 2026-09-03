/**
 * "Add to calendar" on the confirmed screen (design screen 03).
 *
 * A Google Calendar template link rather than a generated .ics: no library, no
 * download, no file handling, and it works from the in-app browsers these links
 * are opened in.
 *
 * The entry is all-day. `start_time` is free text an admin types ("5:00 PM"), so
 * parsing it into a timestamp would fail quietly the first time somebody wrote
 * "5 pm onwards" — the time goes in the description, where being free text is
 * harmless.
 */
export function calendarUrl(o: {
  name: string;
  date: string;
  startTime: string | null;
  venue: string | null;
  passCode: string;
  coupon: number | null;
  ticketUrl: string;
}): string {
  const day = o.date.replace(/-/g, "");
  const next = new Date(`${o.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10).replace(/-/g, "");

  const details = [
    o.startTime ? `Starts ${o.startTime}.` : null,
    o.coupon != null ? `Coupon ${o.coupon} · ${o.passCode}` : o.passCode,
    "",
    "Open your ticket when the waiter comes to your table and tap CLAIM:",
    o.ticketUrl,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: o.name,
    dates: `${day}/${end}`,
    details,
    // Before the address drops there is deliberately nothing to put here.
    location: o.venue ?? "Address drops when booking closes",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
