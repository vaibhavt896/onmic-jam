import QRCode from "qrcode";

/**
 * §12.1 — the reason there is no payment gateway. RBI mandates 0% MDR on
 * bank-to-bank UPI; a gateway's ~2% is its platform fee, not a UPI cost. [R12]
 */
export function upiLink(o: {
  vpa: string;
  payeeName: string;
  amount: number;
  note: string;
}) {
  const p = new URLSearchParams({
    pa: o.vpa,
    pn: o.payeeName,
    am: o.amount.toFixed(2), // bare decimal — no ₹, no separators
    cu: "INR",
    // `tn` is best-effort and is NEVER used for matching. Some UPI apps let the
    // user edit it, some strip it, some truncate it. Matching is by UTR, only
    // and always. [§12.1]
    tn: o.note,
    tr: o.note,
  });
  return `upi://pay?${p.toString()}`;
}

/**
 * The QR is not a desktop fallback, it is a co-equal path: `upi://` does not
 * resolve inside the Instagram and WhatsApp in-app browsers, which is exactly
 * where these users come from. Rendered server-side to a data URI so there is
 * no client library and no extra request.
 */
export async function upiQrDataUri(link: string): Promise<string> {
  return QRCode.toDataURL(link, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}
