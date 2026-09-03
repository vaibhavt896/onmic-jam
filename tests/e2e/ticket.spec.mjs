/**
 * §16 tests 20–24 — the ticket, and [R7]: the coupon is inert until the moment
 * a drink is actually being handed over.
 */
import { expect, test } from "@playwright/test";
import { closePool, seedEvent, sql } from "./fixtures.mjs";

test.afterAll(async () => {
  await closePool();
});

async function fontSizePx(locator) {
  return locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

/** The largest font size anywhere in the document, in px. */
async function biggestTextPx(page) {
  return page.evaluate(() =>
    Math.max(
      ...[...document.querySelectorAll("body *")].map((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      ),
    ),
  );
}

test("20 · a confirmed ticket shows the coupon small, grey and labelled not active", async ({
  page,
}) => {
  await seedEvent({ confirmed: 3 });
  const [{ pass_code }] = await sql("select pass_code from attendees where coupon_no = 2");

  await page.goto(`/pass/${pass_code}`);

  await expect(page.getByText("✓ You're in")).toBeVisible();
  const coupon = page.getByTestId("coupon-inactive");
  await expect(coupon).toHaveText("2");
  expect(await fontSizePx(coupon), "well under serving size").toBeLessThan(40);

  // --text-3 #6B6480: the design system's "labels only" grey.
  const colour = await coupon.evaluate((el) => getComputedStyle(el).color);
  expect(colour, "greyed, not the brand accent").toBe("rgb(107, 100, 128)");

  await expect(page.getByTestId("coupon-inactive-label")).toHaveText("not active yet");
  await expect(page.getByTestId("green-screen")).toHaveCount(0);

  // §11.3 — the button is right there, with the warning on it.
  await expect(page.getByTestId("claim-button")).toBeVisible();
  await expect(page.getByText(/only tap when the waiter is standing with you/)).toBeVisible();
});

test("21 · tapping CLAIM turns the page full green, at serving size, with a live countdown", async ({
  page,
}) => {
  await seedEvent({ confirmed: 3, claimSeconds: 90 });
  const [{ pass_code }] = await sql("select pass_code from attendees where coupon_no = 1");

  await page.goto(`/pass/${pass_code}`);
  await page.getByTestId("claim-button").click();

  // §11.3 — the confirm sheet, with "Not yet" as the dominant option. The
  // expensive mistake is claiming too early, so the safe answer is the easy one.
  const sheet = page.getByTestId("claim-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByText("Is the waiter with you right now?")).toBeVisible();
  const notYet = page.getByTestId("claim-cancel");
  const yes = page.getByTestId("claim-confirm");
  const notYetBox = await notYet.boundingBox();
  const yesBox = await yes.boundingBox();
  expect(notYetBox.height * notYetBox.width, '"Not yet" is the bigger target').toBeGreaterThan(
    yesBox.height * yesBox.width,
  );

  // Backing out changes nothing at all.
  await notYet.click();
  await expect(sheet).toHaveCount(0);
  expect((await sql("select state from attendees where pass_code = $1", [pass_code]))[0].state).toBe(
    "confirmed",
  );

  await page.getByTestId("claim-button").click();
  await page.getByTestId("claim-confirm").click();

  await expect(page.getByTestId("green-screen")).toBeVisible();
  const coupon = page.getByTestId("coupon-active");
  await expect(coupon).toHaveText("1");
  expect(
    await fontSizePx(coupon),
    "≥ 96px — the waiter reads it across a table",
  ).toBeGreaterThanOrEqual(96);

  // --live #35E08A, and it appears on exactly this one screen in the product.
  const bg = await page
    .getByTestId("green-screen")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg, "full-bleed green").toBe("rgb(53, 224, 138)");

  // The countdown is the anti-screenshot measure: a screenshot freezes.
  const first = await page.getByTestId("claim-countdown").textContent();
  expect(first, "starts at the event's 90s window").toMatch(/^⏱ 1:(30|2\d)$/);
  await page.waitForTimeout(1600);
  const second = await page.getByTestId("claim-countdown").textContent();
  expect(second).not.toBe(first);

  const [row] = await sql("select state, claim_by from attendees where pass_code = $1", [pass_code]);
  expect(row).toMatchObject({ state: "claimed", claim_by: "self" });
});

test("22 · the window expires to grey on the page, with no large number left in the DOM", async ({
  page,
}) => {
  // A three-second window, so the transition can be watched rather than mocked.
  await seedEvent({ confirmed: 2, claimSeconds: 3 });
  const [{ pass_code }] = await sql("select pass_code from attendees where coupon_no = 1");

  await page.goto(`/pass/${pass_code}`);
  await page.getByTestId("claim-button").click();
  await page.getByTestId("claim-confirm").click();
  await expect(page.getByTestId("green-screen")).toBeVisible();
  expect(await biggestTextPx(page)).toBeGreaterThanOrEqual(96);

  // No reload, no navigation — the page transitions itself. §11.3
  await expect(page.getByTestId("spent-card")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("green-screen")).toHaveCount(0);
  await expect(page.getByTestId("claimed-at")).toContainText("Claimed");

  expect(await biggestTextPx(page), "nothing at serving size is left").toBeLessThan(96);
  const coupon = page.getByTestId("coupon-inactive");
  expect(await fontSizePx(coupon)).toBeLessThan(40);

  // [R6] and it is spent for good — a second attempt does not reopen it.
  const again = await page.request.post("/api/claim", { data: { pass_code } });
  expect((await again.json()).reason).toBe("already");
});

test("E12 · closing and re-opening the page mid-window shows the same claim", async ({ page }) => {
  await seedEvent({ confirmed: 2, claimSeconds: 90 });
  const [{ pass_code }] = await sql("select pass_code from attendees where coupon_no = 1");

  await page.goto(`/pass/${pass_code}`);
  await page.getByTestId("claim-button").click();
  await page.getByTestId("claim-confirm").click();
  await expect(page.getByTestId("green-screen")).toBeVisible();
  const [before] = await sql("select claimed_at from attendees where pass_code = $1", [pass_code]);

  await page.reload();

  await expect(page.getByTestId("green-screen")).toBeVisible();
  await expect(page.getByTestId("claim-countdown")).toContainText("⏱");
  const [after] = await sql("select claimed_at from attendees where pass_code = $1", [pass_code]);
  expect(after.claimed_at.getTime(), "the same claim, not a second one").toBe(
    before.claimed_at.getTime(),
  );
});

test("E14 · an organiser claiming for someone turns that person's own phone green", async ({
  page,
}) => {
  const eventId = await seedEvent({ confirmed: 2, claimSeconds: 90 });
  const [{ id, pass_code }] = await sql("select id, pass_code from attendees where coupon_no = 1");

  await page.goto(`/pass/${pass_code}`);
  await expect(page.getByTestId("coupon-inactive")).toBeVisible();

  // Their phone is dead, or it is not — either way the organiser claims it.
  await sql("select app_admin_claim($1)", [id]);

  // The ticket polls every 5s, so this must land with no navigation. [R8]
  await expect(page.getByTestId("green-screen")).toBeVisible({ timeout: 9000 });
  await expect(page.getByTestId("coupon-active")).toHaveText("1");

  const [row] = await sql("select claim_by from attendees where id = $1", [id]);
  expect(row.claim_by).toBe("admin");
  void eventId;
});

test("23 · a refunded ticket contains no coupon number anywhere in the HTML", async ({ page }) => {
  await seedEvent({ confirmed: 2 });
  const [{ id, pass_code }] = await sql("select id, pass_code from attendees where coupon_no = 1");

  // A distinctive number, so finding it in the markup cannot be a coincidence.
  await sql("update attendees set coupon_no = 987 where id = $1", [id]);

  // Positive control: while confirmed, the number IS in the document.
  await page.goto(`/pass/${pass_code}`);
  expect(await page.content()).toContain("987");

  await sql("select set_attendee_void($1, 'refunded')", [id]);
  await page.goto(`/pass/${pass_code}`);

  await expect(page.getByTestId("void-card")).toBeVisible();
  await expect(page.getByText("This pass is no longer valid.")).toBeVisible();

  const html = await page.content();
  expect(html, "withheld at the source, not hidden with CSS").not.toContain("987");
  expect(html).not.toContain("coupon-active");
  expect(html).not.toContain("coupon-inactive");

  // And the poll endpoint agrees.
  const state = await page.request.get(`/api/pass/${pass_code}`);
  expect((await state.json()).coupon).toBeNull();
});

test("24 · the ticket never publishes the per-head split", async ({ page }) => {
  await seedEvent({ confirmed: 2 });
  const [{ pass_code }] = await sql("select pass_code from attendees where coupon_no = 1");

  await page.goto(`/pass/${pass_code}`);

  // A client decision that reverses §3.5. The cafe share and the community fund
  // are settlement figures for /admin/money — they must not reach an attendee,
  // and checking the HTML rather than the pixels is the point.
  const html = await page.content();
  expect(html).not.toMatch(/community fund/i);
  expect(html).not.toContain("₹250");
  expect(html).not.toContain("entry + 1 mocktail (cafe)");
  await expect(page.getByTestId("price-split")).toHaveCount(0);
});

test("an unpaid ticket offers payment, the QR, and a visible way out", async ({ page }) => {
  await seedEvent({ confirmed: 1 });
  const [{ id, pass_code }] = await sql("select id, pass_code from attendees limit 1");
  await sql(
    "update attendees set state = 'registered', coupon_no = null, utr = null, confirmed_at = null where id = $1",
    [id],
  );

  await page.goto(`/pass/${pass_code}`);

  await expect(page.getByText("Not paid yet")).toBeVisible();

  // §12.1: the deep link and the QR are co-equal paths, both always rendered.
  const href = await page.getByTestId("upi-link").getAttribute("href");
  expect(href).toContain("upi://pay?");
  expect(href).toContain("pa=onmic%40ybl");
  expect(href).toContain("am=300.00");
  await expect(page.locator('img[alt*="UPI QR"]')).toBeVisible();

  // §11.2 — the refund line is not decoration. Prepayment fails without a
  // visible exit, and it has to be above the fold.
  await expect(page.getByText(/full refund/)).toBeVisible();
  await expect(page.getByText("Where do I find the reference number?")).toBeVisible();
});

test("the ticket accepts a UTR and moves to the waiting state without a reload", async ({ page }) => {
  await seedEvent({ confirmed: 1 });
  const [{ id, pass_code }] = await sql("select id, pass_code from attendees limit 1");
  await sql(
    "update attendees set state = 'registered', coupon_no = null, utr = null, confirmed_at = null where id = $1",
    [id],
  );

  await page.goto(`/pass/${pass_code}`);
  await page.getByTestId("utr-input").fill("41234567890"); // 11 digits
  await page.getByTestId("utr-submit").click();
  await expect(page.getByText(/A UPI reference number is 12 digits/)).toBeVisible();

  await page.getByTestId("utr-input").fill("412345678901");
  await page.getByTestId("utr-submit").click();

  await expect(page.getByTestId("submitted-note")).toBeVisible();
  await expect(page.getByText(/4123…8901/)).toBeVisible();
  await expect(page.getByText(/this page turns active/)).toBeVisible();

  const rows = await sql("select state, utr from attendees where id = $1", [id]);
  expect(rows[0]).toMatchObject({ state: "submitted", utr: "412345678901" });
});
