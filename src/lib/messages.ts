/**
 * §10: errors are always { error: "<machine_code>", message: "<human sentence>" }
 * and the client renders `message` verbatim — it never composes its own error
 * text. That means every sentence a user can see about a failure lives here.
 */

export type ErrorCode = keyof typeof CATALOG;

const CATALOG = {
  bad_name: { status: 400, message: "Please enter your name — between 2 and 60 characters." },
  bad_phone: {
    status: 400,
    message: "That doesn't look like an Indian mobile number. Enter 10 digits, starting with 6, 7, 8 or 9.",
  },
  bad_email: { status: 400, message: "That email address doesn't look right. Check it and try again." },
  bad_utr: {
    status: 400,
    message:
      "A UPI reference number is 12 digits. Check the number on your payment success screen and try again.",
  },
  bad_json: { status: 400, message: "We couldn't read that request. Please try again." },
  bad_reason: { status: 400, message: "Write a short reason — at least 3 characters. It goes in the audit log." },
  bad_walkin: { status: 400, message: "A walk-in needs a name and a 10-digit phone number." },
  bad_status: { status: 400, message: "That is not a valid event status." },
  bad_event: { status: 400, message: "Check the event details — every field except venue is required." },

  no_event: { status: 404, message: "There's no jam open for registration right now." },
  not_found: { status: 404, message: "We couldn't find that pass. Check the link, or use Find my pass." },

  closed: {
    status: 409,
    message:
      "Registration for this jam has closed. Message the organisers on WhatsApp if you still want a seat.",
  },
  already_confirmed: {
    status: 409,
    message: "You're already confirmed — nothing more to do. Open your ticket to see your coupon number.",
  },
  void: { status: 409, message: "This pass is no longer valid. Message the organisers if that's unexpected." },
  utr_taken: {
    status: 409,
    message:
      "That reference number is already registered against another person. If you think this is a mistake, message the organisers.",
  },
  phone_taken: { status: 409, message: "Another attendee at this event already uses that phone number." },
  event_open: {
    status: 409,
    message: "A jam is already open. Close or finish it before opening another one.",
  },
  bad_state: { status: 409, message: "That person is not in a state that allows this action." },
  over_capacity: {
    status: 409,
    message:
      "The room is at capacity. Raise the capacity on the event page if the cafe has agreed to more, then try again.",
  },

  unauthorized: { status: 401, message: "Sign in with the admin passcode first." },
  bad_passcode: { status: 401, message: "That passcode is not right." },

  too_large: {
    status: 413,
    message: "That paste is too large — the limit is 200 KB. Paste one event's transactions at a time.",
  },

  rate_limited: { status: 429, message: "Too many attempts. Wait a minute and try again." },

  pass_collision: { status: 500, message: "Something went wrong generating your pass. Please try again." },
  server_error: { status: 500, message: "Something went wrong at our end. Please try again." },
} as const;

export function describe(code: string): { status: number; message: string } {
  return (CATALOG as Record<string, { status: number; message: string }>)[code] ?? CATALOG.server_error;
}
