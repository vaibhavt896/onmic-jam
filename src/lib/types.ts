export type AttendeeState =
  | "registered"
  | "submitted"
  | "confirmed"
  | "claimed"
  | "refunded"
  | "rejected";

export type EventJson = {
  id: string;
  name: string;
  event_date: string;
  start_time: string | null;
  /** null on public payloads until the address drops — withheld at the source */
  venue: string | null;
  /** true when a venue exists but has not dropped yet */
  venue_locked: boolean;
  venue_unlocks_at: string;
  price: number;
  door_price: number;
  cafe_share: number;
  fund_share: number;
  capacity: number;
  claim_seconds: number;
  upi_vpa: string;
  upi_name: string;
  closes_at: string;
  status: "open" | "closed" | "done";
  is_open: boolean;
  confirmed_count: number;
};

export type PassView = {
  event: EventJson;
  /** Server clock, so the countdown never trusts the phone's. §11.3 */
  now: string;
  attendee: {
    pass_code: string;
    name: string;
    state: AttendeeState;
    /** null unless confirmed or claimed — [R7] and acceptance test 23 */
    coupon_no: number | null;
    utr: string | null;
    claimed_at: string | null;
    claim_until: string | null;
    confirmed_at: string | null;
  };
};

/** §10.4 GET /api/pass/[code] */
export type PassState = {
  state: AttendeeState;
  name: string;
  coupon: number | null;
  claimed_at: string | null;
  claim_until: string | null;
  now: string;
  event: {
    name: string;
    date: string;
    start_time: string | null;
    venue: string | null;
    venue_locked: boolean;
    venue_unlocks_at: string;
    price: number;
    cafe_share: number;
    fund_share: number;
  };
};

/** §10.3 — every outcome is a 200. */
export type ClaimResult = {
  ok: boolean;
  reason: "ok" | "active" | "already" | "not_paid" | "not_found" | "void";
  name?: string | null;
  coupon?: number | null;
  until?: string | null;
  claimed_at?: string | null;
  now?: string;
};

/** §10.5 — phone4 only, never the full number. [S10] */
export type RosterPerson = {
  id: string;
  pass: string;
  coupon: number | null;
  name: string;
  phone4: string;
  state: AttendeeState;
  claimed_at: string | null;
};

export type Roster = {
  event: EventJson;
  fetched_at: string;
  people: RosterPerson[];
};

export type Stats = {
  event: EventJson;
  registered: number;
  submitted: number;
  /** confirmed + claimed — the committed headcount the cafe is paid on [R10] */
  headcount: number;
  claimed: number;
  not_claimed: number;
  refunded: number;
  rejected: number;
  seats_left: number;
  collected: number;
  cafe_due: number;
  fund: number;
  walkins: number;
  walkin_fund: number;
  unemailed: number;
};

export type Person = {
  id: string;
  pass_code: string;
  coupon_no: number | null;
  name: string;
  phone: string;
  email: string | null;
  instagram: string | null;
  utr: string | null;
  utr_at: string | null;
  amount_paid: number | null;
  is_walkin: boolean;
  state: AttendeeState;
  confirmed_at: string | null;
  verify_method: "auto" | "manual" | null;
  claimed_at: string | null;
  claim_until: string | null;
  claim_by: "self" | "admin" | null;
  emailed_at: string | null;
  note: string | null;
  created_at: string;
};

/** §12.2 — the total check, computed from the paste and never persisted. [S11] */
export type TotalCheck = {
  /** matched references for which an amount could be read next to the UTR */
  readable: number;
  /** matched references belonging to a real attendee of this event */
  matched: number;
  expected: number;
  in_paste: number;
};

export type VerifyResult = {
  scanned: number;
  price: number;
  total: TotalCheck;
  confirmed: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    pass: string;
    coupon: number;
    emailed?: boolean;
  }[];
  over_capacity: { id: string; name: string; phone: string; pass: string }[];
  pending: { id: string; name: string; utr: string; phone: string; pass: string }[];
  no_utr: { id: string; name: string; phone: string; pass: string }[];
};

export type WalkinResult = {
  pass_code: string;
  url: string;
  name: string;
  coupon: number | null;
  amount: number;
  status: "confirmed" | "already";
};
