import { rpc } from "@/lib/db";
import { fail, ok } from "@/lib/api";
import { emailEnabled } from "@/lib/env";
import { sendTicketEmails, type Recipient } from "@/lib/email";
import type { EventJson } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * §13 — re-sends to every confirmed attendee with emailed_at IS NULL. This is
 * the recovery path for [R8]: the provider was down during verify, 58 people
 * were confirmed anyway, and the email catches up later.
 */
export async function POST() {
  const data = await rpc<{ event: EventJson | null; people: Recipient[] }>("app_pending_emails");
  if (!data?.event) return fail("no_event");

  if (!emailEnabled) {
    return ok({ pending: data.people.length, sent: 0, email_configured: false });
  }

  const sent = await sendTicketEmails(data.people, data.event);
  return ok({ pending: data.people.length, sent: sent.size, email_configured: true });
}
