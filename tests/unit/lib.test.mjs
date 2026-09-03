/**
 * Pure-function tests. Node 24 strips the TypeScript annotations on import, so
 * these run against the real modules with no build step.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cleanEmail,
  cleanInstagram,
  cleanName,
  cleanPhone,
  cleanUtr,
  extractUtrs,
  normalisePass,
  sumAmountsForUtrs,
} from "../../src/lib/validate.ts";
import { upiLink } from "../../src/lib/upi.ts";
import { dayTime, longDate, maskUtr, rupees, shortDate } from "../../src/lib/format.ts";
import { describe as describeError } from "../../src/lib/messages.ts";

describe("phone normalisation", () => {
  it("strips +91, leading 0, spaces and punctuation to bare 10 digits", () => {
    for (const input of [
      "9876543210",
      "+91 98765 43210",
      "+919876543210",
      "09876543210",
      "98765-43210",
      "  98765 43210  ",
      "919876543210",
    ]) {
      assert.equal(cleanPhone(input), "9876543210", input);
    }
  });

  it("refuses anything that is not a 10-digit Indian mobile", () => {
    for (const bad of ["12345", "5876543210", "1234567890", "98765432101234", "", "abcdefghij"]) {
      assert.equal(cleanPhone(bad), null, bad);
    }
  });
});

describe("name, email, instagram", () => {
  it("trims and collapses whitespace, enforcing 2–60 characters", () => {
    assert.equal(cleanName("  Vaibhav   Tiwari "), "Vaibhav Tiwari");
    assert.equal(cleanName("V"), null);
    assert.equal(cleanName("x".repeat(61)), null);
    assert.equal(cleanName("x".repeat(60))?.length, 60);
  });

  it("treats a missing email as valid — it is a convenience, not the ticket", () => {
    assert.deepEqual(cleanEmail(undefined), { ok: true, value: "" });
    assert.deepEqual(cleanEmail(""), { ok: true, value: "" });
    assert.deepEqual(cleanEmail(" V@Example.COM "), { ok: true, value: "v@example.com" });
  });

  it("requires an @ with a dot after it", () => {
    for (const bad of ["nope", "a@b", "@example.com", "a@b.", "a b@c.com"]) {
      assert.equal(cleanEmail(bad).ok, false, bad);
    }
  });

  it("drops a leading @ from an instagram handle", () => {
    assert.equal(cleanInstagram("@vaibhav"), "vaibhav");
    assert.equal(cleanInstagram("  "), "");
  });
});

describe("UTR handling", () => {
  it("accepts exactly 12 digits, ignoring separators", () => {
    assert.equal(cleanUtr("412345678901"), "412345678901");
    assert.equal(cleanUtr(" 4123 4567 8901 "), "412345678901");
    assert.equal(cleanUtr("41234567890"), null);
    assert.equal(cleanUtr("4123456789012"), null);
  });

  it("§12.2 pulls 12-digit references out of any statement format", () => {
    const raw = `
      06/09/2026  UPI/412345678901/ONMIC  300.00 Cr
      07/09/2026  UPI-500000000002-ONMIC  300.00 Cr
      Ref: 500000000003
      500000000004,300.00,Cr
    `;
    assert.deepEqual(extractUtrs(raw), [
      "412345678901",
      "500000000002",
      "500000000003",
      "500000000004",
    ]);
  });

  it("de-duplicates, so a statement listing a payment twice confirms one person", () => {
    assert.deepEqual(extractUtrs("412345678901 412345678901"), ["412345678901"]);
  });

  it("word boundaries stop a fragment of a longer number matching", () => {
    assert.deepEqual(extractUtrs("9412345678901"), []);
    assert.deepEqual(extractUtrs("4123456789012"), []);
    assert.deepEqual(extractUtrs("ACCT41234567890123"), []);
  });

  it("returns nothing for an empty or reference-free paste", () => {
    assert.deepEqual(extractUtrs(""), []);
    assert.deepEqual(extractUtrs("no numbers here at all"), []);
  });
});

describe("UPI deep link — §12.1", () => {
  const link = upiLink({
    vpa: "onmic@ybl",
    payeeName: "On Mic Community",
    amount: 300,
    note: "OM0709-K3F7",
  });

  it("starts with the upi scheme and carries the required parameters", () => {
    assert.ok(link.startsWith("upi://pay?"));
    const p = new URLSearchParams(link.slice("upi://pay?".length));
    assert.equal(p.get("pa"), "onmic@ybl");
    assert.equal(p.get("pn"), "On Mic Community");
    assert.equal(p.get("cu"), "INR");
    assert.equal(p.get("tn"), "OM0709-K3F7");
    assert.equal(p.get("tr"), "OM0709-K3F7");
  });

  it("sends the amount as a bare decimal — no ₹, no separators", () => {
    const p = new URLSearchParams(link.slice("upi://pay?".length));
    assert.equal(p.get("am"), "300.00");
    assert.ok(!link.includes("₹"));
    assert.ok(!link.includes(","));
  });

  it("keeps the amount fixed at two decimals for any price", () => {
    for (const [amount, expected] of [
      [300, "300.00"],
      [1, "1.00"],
      [1250.5, "1250.50"],
    ]) {
      const l = upiLink({ vpa: "a@b", payeeName: "X", amount, note: "n" });
      assert.equal(new URLSearchParams(l.slice(10)).get("am"), expected);
    }
  });
});

describe("formatting", () => {
  it("reads a Postgres date as a plain calendar day, not a UTC instant", () => {
    assert.equal(shortDate("2026-08-16"), "Sun 16 Aug");
    assert.equal(longDate("2026-08-16"), "Sunday 16 August");
  });

  it("renders the cutoff in IST as the copy deck writes it", () => {
    // 2026-08-15 21:00 IST is 15:30 UTC the same day.
    assert.equal(dayTime("2026-08-15T15:30:00.000Z"), "Sat 9:00 PM");
  });

  it("masks a reference to something the payer still recognises", () => {
    assert.equal(maskUtr("412345678901"), "4123…8901");
    assert.equal(maskUtr("short"), "short");
  });

  it("groups rupees the Indian way", () => {
    assert.equal(rupees(13340), "₹13,340");
    assert.equal(rupees(0), "₹0");
  });
});

describe("error catalogue — §10", () => {
  it("pairs every code with a status and a renderable sentence", () => {
    for (const code of ["bad_utr", "utr_taken", "closed", "too_large", "unauthorized"]) {
      const d = describeError(code);
      assert.ok(d.status >= 400 && d.status < 600, code);
      assert.ok(d.message.length > 15, code);
      assert.ok(/[.!]$/.test(d.message), `${code} reads as a sentence`);
    }
  });

  it("uses the exact wording the spec dictates", () => {
    assert.equal(
      describeError("bad_utr").message,
      "A UPI reference number is 12 digits. Check the number on your payment success screen and try again.",
    );
    assert.equal(
      describeError("utr_taken").message,
      "That reference number is already registered against another person. If you think this is a mistake, message the organisers.",
    );
  });

  it("falls back to a server error rather than throwing on an unknown code", () => {
    assert.equal(describeError("nonsense").status, 500);
  });
});

describe("pass codes", () => {
  it("upper-cases and trims so a hand-typed code still resolves", () => {
    assert.equal(normalisePass("  om0709-k3f7 "), "OM0709-K3F7");
    assert.equal(normalisePass(undefined), "");
  });
});

// ===========================================================================
describe("the total check — §12.2", () => {
  const matched = ["412345678901", "412345678902", "412345678903"];

  it("sums the amount sitting beside each matched reference", () => {
    const raw = [
      "06/09/2026 18:05  UPI/412345678901/ONMIC  300.00 Cr",
      "06/09/2026 18:09  UPI/412345678902/ONMIC  300.00 Cr",
      "06/09/2026 18:11  UPI/412345678903/ONMIC  300.00 Cr",
    ].join("\n");
    assert.deepEqual(sumAmountsForUtrs(raw, matched), { readable: 3, total: 900 });
  });

  it("[E6] surfaces a payer who edited ₹300 down to ₹250 in their UPI app", () => {
    const raw = [
      "06/09/2026 18:05  UPI/412345678901/ONMIC  300.00 Cr",
      "06/09/2026 18:09  UPI/412345678902/ONMIC  250.00 Cr",
      "06/09/2026 18:11  UPI/412345678903/ONMIC  300.00 Cr",
    ].join("\n");
    const { readable, total } = sumAmountsForUtrs(raw, matched);
    assert.equal(readable, 3);
    assert.equal(readable * 300 - total, 50, "the ₹50 gap is visible");
  });

  it("ignores dates, clock times and the reference itself", () => {
    const raw = "16/08/2026 18:05:31  UPI/412345678901/ONMIC  300.00 Cr";
    assert.deepEqual(sumAmountsForUtrs(raw, matched), { readable: 1, total: 300 });
  });

  it("prefers the amount nearest the reference over a running balance", () => {
    const raw = "06/09  UPI/412345678901/ONMIC  300.00 Cr   Balance 15,300.00";
    assert.deepEqual(sumAmountsForUtrs(raw, matched), { readable: 1, total: 300 });
  });

  it("reads a bare integer amount when the export has no paise", () => {
    const raw = "06/09  UPI/412345678901/ONMIC  Rs 300 Cr";
    assert.deepEqual(sumAmountsForUtrs(raw, matched), { readable: 1, total: 300 });
  });

  it("reports zero readable rather than a fake shortfall when no amount is on the line", () => {
    const raw = "UPI/412345678901/ONMIC\ncredited";
    assert.deepEqual(sumAmountsForUtrs(raw, matched), { readable: 0, total: 0 });
  });

  it("counts a transaction listed twice only once", () => {
    const raw = [
      "06/09  UPI/412345678901/ONMIC  300.00 Cr",
      "06/09  UPI/412345678901/ONMIC  300.00 Cr",
    ].join("\n");
    assert.deepEqual(sumAmountsForUtrs(raw, matched), { readable: 1, total: 300 });
  });

  it("[E19] ignores references that belong to nobody at this event", () => {
    const raw = "06/09  UPI/999999999999/OTHER  9000.00 Cr";
    assert.deepEqual(sumAmountsForUtrs(raw, matched), { readable: 0, total: 0 });
  });
});
