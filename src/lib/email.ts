/**
 * §13 — Resend, free tier. The email is a receipt and a convenience, not the
 * ticket; the ticket is the live page. Anything that requires the email to have
 * arrived is a bug, which is exactly why /find exists.
 *
 * [R9] is absolute: a send failure must never propagate into a confirmation.
 * Every function here resolves; none of them throw.
 */
import { Resend } from "resend";
import { env, emailEnabled } from "./env";
import { rpc } from "./db";
import { longDate, shortDate, weekday } from "./format";

export type Recipient = {
  id: string;
  name: string;
  email: string | null;
  pass: string;
  coupon: number | null;
};

export type EventLike = {
  name: string;
  event_date: string;
  start_time: string | null;
  venue: string | null;
  price: number;
  cafe_share: number;
  fund_share: number;
};

const g = globalThis as typeof globalThis & { __onmicResend?: Resend };

function resend(): Resend {
  if (!g.__onmicResend) g.__onmicResend = new Resend(env.RESEND_API_KEY);
  return g.__onmicResend;
}

function when(ev: EventLike): string {
  return [longDate(ev.event_date), ev.start_time, ev.venue].filter(Boolean).join(" · ");
}

function plainBody(to: Recipient, ev: EventLike, url: string): string {
  return `Confirmed. See you ${weekday(ev.event_date)}.

    COUPON  ${to.coupon}

${to.name} · ${to.pass}
${when(ev)}

₹${ev.price} paid — entry and one mocktail.

>> OPEN YOUR TICKET  ${url}

How the mocktail works:

Open your ticket link when the waiter comes to your
table, and tap CLAIM. Your screen turns GREEN with
your number. That's what the staff serve on.

Only tap it when the waiter is actually with you —
it can only be claimed once.

Lost this email? Go to ${env.SITE_URL}/find and
enter your phone number.

— On Mic Community`;
}

function htmlBody(to: Recipient, ev: EventLike, url: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><body style="margin:0;background:#0B0912;color:#F5F1EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
  <p style="font-size:20px;font-weight:600;color:#fff;margin:0 0 24px">Confirmed. See you ${weekday(ev.event_date)}.</p>

  <div style="background:#16121F;border:1px solid #FFFFFF14;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
    <div style="font-size:12px;letter-spacing:.18em;color:#A69FB5;text-transform:uppercase">Coupon</div>
    <div style="font-size:56px;font-weight:700;color:#FF277F;line-height:1.1">${to.coupon}</div>
  </div>

  <p style="margin:0 0 4px;font-size:16px;color:#fff">${esc(to.name)} · ${esc(to.pass)}</p>
  <p style="margin:0 0 20px;font-size:14px;color:#A69FB5">${esc(when(ev))}</p>

  <!-- The per-head split is deliberately not published to attendees. -->
  <p style="margin:0 0 24px;font-size:14px;color:#A69FB5">
    <strong style="color:#F5F1EA">₹${ev.price} paid</strong> — entry and one mocktail.
  </p>

  <a href="${url}" style="display:block;background:#FF277F;color:#0B0912;text-decoration:none;font-weight:700;text-align:center;padding:16px;border-radius:10px;font-size:16px">OPEN YOUR TICKET</a>

  <p style="margin:28px 0 8px;font-size:14px;color:#F5F1EA;font-weight:600">How the mocktail works</p>
  <p style="margin:0 0 12px;font-size:14px;color:#A69FB5;line-height:1.6">
    Open your ticket link when the waiter comes to your table, and tap <strong style="color:#F5F1EA">CLAIM</strong>.
    Your screen turns <strong style="color:#35E08A">GREEN</strong> with your number. That's what the staff serve on.
  </p>
  <p style="margin:0 0 24px;font-size:14px;color:#A69FB5;line-height:1.6">
    Only tap it when the waiter is actually with you — it can only be claimed once.
  </p>

  <p style="font-size:13px;color:#6B6480;margin:0">Lost this email? Go to <a href="${env.SITE_URL}/find" style="color:#FF277F">${env.SITE_URL}/find</a> and enter your phone number.</p>
  <p style="font-size:13px;color:#6B6480;margin:16px 0 0">— On Mic Community</p>
</div></body></html>`;
}

/**
 * Returns true only when the provider accepted the message. Never throws.
 * Callers set emailed_at from this and nothing else.
 */
export async function sendTicketEmail(to: Recipient, ev: EventLike): Promise<boolean> {
  if (!emailEnabled || !to.email || to.coupon == null) return false;
  const url = `${env.SITE_URL}/pass/${to.pass}`;
  try {
    const { error } = await resend().emails.send({
      from: env.EMAIL_FROM,
      to: to.email,
      subject: `Your On Mic pass — ${shortDate(ev.event_date)} — coupon #${to.coupon}`,
      text: plainBody(to, ev, url),
      html: htmlBody(to, ev, url),
    });
    if (error) {
      console.error("[email] send failed", to.email, error.message);
      return false;
    }
  } catch (err) {
    console.error("[email] send threw", to.email, err);
    return false;
  }

  try {
    await rpc("app_mark_emailed", { p_id: to.id });
  } catch (err) {
    console.error("[email] could not record emailed_at", to.id, err);
  }
  return true;
}

/**
 * Sent the moment someone submits their payment reference, so nobody is left
 * wondering whether it landed. This is an acknowledgement, NOT a confirmation:
 * the seat is only real once the reference is matched against the bank
 * statement, and saying otherwise here would promise a seat the reconciliation
 * might not be able to give (over capacity, or a reference that never arrives).
 *
 * Deliberately does not touch `emailed_at` — that flag tracks the confirmation
 * email with the coupon on it, and /api/admin/email/retry depends on it meaning
 * exactly that.
 *
 * [R9] never throws, and the caller does not wait for it: a dead email provider
 * must not stop a payment reference being recorded.
 */
export async function sendPaymentReceivedEmail(
  to: { name: string; email: string | null; pass: string; utr: string },
  ev: EventLike,
): Promise<boolean> {
  if (!emailEnabled || !to.email) return false;
  const url = `${env.SITE_URL}/pass/${to.pass}`;
  const masked = to.utr.length === 12 ? `${to.utr.slice(0, 4)}…${to.utr.slice(-4)}` : to.utr;

  const text = `Got it, ${to.name.split(" ")[0]}.

We've recorded your payment reference ${masked} against ${to.pass}.

We match every payment against the bank statement on Saturday
night. You'll get one more email then, with your coupon number
on it — that is the one that means your seat is confirmed.

Your ticket page (bookmark it, this is what turns green at the
table): ${url}

${when(ev)}

Lost this email? Go to ${env.SITE_URL}/find and enter your
phone number.

— On Mic Community`;

  const html = `<!doctype html><html><body style="margin:0;background:#0B0912;color:#F5F1EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
  <p style="font-size:20px;font-weight:600;color:#fff;margin:0 0 20px">Got it, ${to.name.split(" ")[0]}.</p>

  <div style="background:#16121F;border:1px solid #FFFFFF14;border-radius:12px;padding:20px;margin-bottom:20px">
    <div style="font-size:12px;letter-spacing:.18em;color:#A69FB5;text-transform:uppercase">Reference received</div>
    <div style="font-size:22px;font-weight:700;color:#FF277F;margin-top:6px">${masked}</div>
    <div style="font-size:13px;color:#A69FB5;margin-top:4px">${to.pass}</div>
  </div>

  <p style="margin:0 0 16px;font-size:14px;color:#A69FB5;line-height:1.6">
    We match every payment against the bank statement on Saturday night. You'll get one more email
    then, with your <strong style="color:#F5F1EA">coupon number</strong> on it — that is the one that
    means your seat is confirmed.
  </p>

  <a href="${url}" style="display:block;background:#FF277F;color:#0B0912;text-decoration:none;font-weight:700;text-align:center;padding:16px;border-radius:10px;font-size:16px">OPEN YOUR TICKET</a>

  <p style="margin:20px 0 0;font-size:13px;color:#A69FB5">${when(ev)}</p>
  <p style="font-size:13px;color:#6B6480;margin:16px 0 0">Lost this email? Go to <a href="${env.SITE_URL}/find" style="color:#FF277F">${env.SITE_URL}/find</a> and enter your phone number.</p>
  <p style="font-size:13px;color:#6B6480;margin:16px 0 0">— On Mic Community</p>
</div></body></html>`;

  try {
    const { error } = await resend().emails.send({
      from: env.EMAIL_FROM,
      to: to.email,
      subject: `We've got your payment — ${ev.name}, ${shortDate(ev.event_date)}`,
      text,
      html,
    });
    if (error) {
      console.error("[email] payment-received send failed", to.email, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] payment-received send threw", to.email, err);
    return false;
  }
}

/**
 * §13 — send in sequence with a small gap rather than 50 parallel requests. A
 * burst is the one thing that trips a free tier. Resolves to the ids that were
 * actually delivered.
 */
export async function sendTicketEmails(list: Recipient[], ev: EventLike): Promise<Set<string>> {
  const sent = new Set<string>();
  if (!emailEnabled) return sent;
  for (const person of list) {
    if (await sendTicketEmail(person, ev)) sent.add(person.id);
    await new Promise((r) => setTimeout(r, 120));
  }
  return sent;
}
