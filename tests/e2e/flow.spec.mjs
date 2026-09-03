/**
 * The §17 smoke test, driven end to end in a browser:
 * register → pay → submit UTR → paste the statement → tap CLAIM → green screen
 * → settle with the cafe.
 */
import { expect, test } from "@playwright/test";
import { applySchema, closePool, login, sql } from "./fixtures.mjs";

test.afterAll(async () => {
  await closePool();
});

async function freshEvent(capacity = 50) {
  await applySchema();
  await sql("truncate attendees, events, audit_log cascade");
  const [{ id }] = await sql(
    `insert into events (name, event_date, start_time, venue, capacity,
                         upi_vpa, upi_name, closes_at)
     values ('On Mic Jam', current_date + 3, '5:00 PM', 'Pandu Nagar', $1,
             'onmic@ybl', 'On Mic Community', now() + interval '2 days')
     returning id`,
    [capacity],
  );
  return id;
}

test("the whole jam, start to finish", async ({ page }) => {
  await freshEvent();

  // --- 1. register -------------------------------------------------------
  await page.goto("/");
  await expect(page.getByText("₹300", { exact: true })).toBeVisible();
  // Real scarcity, straight off the events table — never a decorative number.
  await expect(page.getByTestId("seats-left")).toHaveText("50 / 50");

  // A client decision that reverses §3.5: attendees see the price, never the
  // per-head split. cafe_share / fund_share stay settlement figures.
  await expect(page.getByTestId("price-card")).toContainText("entry and one mocktail");
  await expect(page.getByTestId("price-split")).toHaveCount(0);
  await expect(page.getByText(/community fund/i)).toHaveCount(0);
  await expect(page.getByText("₹250")).toHaveCount(0);

  await page.getByPlaceholder("Your name").fill("Vaibhav Tiwari");
  await page.getByPlaceholder("Phone (10 digits)").fill("+91 98765 43210");
  // Two fields, and the optional ones live behind a link: every extra required
  // field costs bookings, and the pass works by phone lookup anyway.
  await page.getByTestId("add-email").click();
  await page.getByPlaceholder("Email (for your ticket)").fill("v@example.com");
  await page.getByPlaceholder("Instagram (optional)").fill("@vaibhav");
  await page.getByTestId("register-submit").click();

  await page.waitForURL(/\/pass\/OM\d{4}-[A-Z0-9]{4}$/);
  const passCode = page.url().split("/pass/")[1];

  // Phone stored bare, so a re-registration cannot duplicate it.
  const [row] = await sql("select phone, instagram, state from attendees");
  expect(row).toMatchObject({ phone: "9876543210", instagram: "vaibhav", state: "registered" });

  // --- 2. pay + submit the reference -------------------------------------
  await expect(page.getByText("Not paid yet")).toBeVisible();
  await page.getByTestId("utr-input").fill("412345678901");
  await page.getByTestId("utr-submit").click();
  await expect(page.getByTestId("submitted-note")).toBeVisible();

  // --- 3. the organiser reconciles on Saturday night ---------------------
  await login(page);
  await expect(page.getByTestId("tile-submitted")).toHaveText("1");

  await page.goto("/admin/verify");
  await page
    .getByTestId("verify-paste")
    .fill(
      [
        "05/09/2026 20:41  UPI/999888777666/SOMEONE ELSE  450.00 Cr",
        "05/09/2026 20:44  UPI/412345678901/ONMIC  300.00 Cr",
        "05/09/2026 20:52  ACCT 1234567890123456  statement balance",
      ].join("\n"),
    );
  await page.getByTestId("verify-run").click();

  await expect(page.getByTestId("verify-summary")).toContainText("1 confirmed");
  await expect(page.getByTestId("verify-summary")).toContainText("coupons 1–1");

  // §12.2 the total check balances, and says so.
  await expect(page.getByTestId("total-check")).toContainText("Expected 1 × ₹300");
  await expect(page.getByTestId("in-paste")).toHaveText("₹300");
  await expect(page.getByTestId("total-verdict")).toContainText("Balances");

  // Re-running the same paste is safe. [E18]
  await page.getByTestId("verify-run").click();
  await expect(page.getByTestId("verify-summary")).toContainText("0 confirmed");
  const still = await sql("select state, coupon_no from attendees");
  expect(still[0]).toMatchObject({ state: "confirmed", coupon_no: 1 });

  // --- 4. the attendee's ticket is confirmed but inert -------------------
  const ticket = await page.context().newPage();
  await ticket.goto(`/pass/${passCode}`);
  await expect(ticket.getByTestId("coupon-inactive")).toHaveText("1");
  await expect(ticket.getByTestId("green-screen")).toHaveCount(0);

  // --- 5. the waiter arrives; they tap CLAIM in front of them ------------
  await ticket.getByTestId("claim-button").click();
  await ticket.getByTestId("claim-confirm").click();
  await expect(ticket.getByTestId("green-screen")).toBeVisible();
  await expect(ticket.getByTestId("coupon-active")).toHaveText("1");
  await ticket.close();

  // --- 6. the floor screen agrees ----------------------------------------
  await page.goto("/admin/floor");
  await page.getByTestId("floor-search").fill("vaib");
  await expect(page.getByTestId("floor-results")).toContainText("claimed");

  // --- 7. settlement -----------------------------------------------------
  await page.goto("/admin/money");
  await expect(page.getByTestId("total-confirmed-claimed")).toHaveText("₹300");
  await expect(page.getByTestId("total-committed-to-cafe")).toHaveText("₹250");
  await expect(page.getByTestId("total-community-fund")).toHaveText("₹50");
  await expect(page.getByTestId("drinks-claimed")).toHaveText("1");
  await expect(page.getByTestId("not-claimed")).toHaveText("0");

  const summary = page.getByTestId("cafe-summary");
  await expect(summary).toContainText("Committed headcount: 1");
  await expect(summary).toContainText("Rate: ₹250 per head (entry + 1 mocktail)");
  await expect(summary).toContainText("Our records: 1 mocktail claimed.");

  // §11.5 the leak detector — the whole point of counting claims.
  await page.getByTestId("cafe-count").fill("3");
  await expect(page.getByTestId("leak")).toContainText("2 served without a green screen");
  await expect(page.getByTestId("leak")).toContainText("Not a charge to the community");
});

test("E1 · re-registering with the same phone returns the same pass, not an error", async ({
  page,
}) => {
  await freshEvent();

  await page.goto("/");
  await page.getByPlaceholder("Your name").fill("Vaibhav Tiwari");
  await page.getByPlaceholder("Phone (10 digits)").fill("9876543210");
  await page.getByTestId("register-submit").click();
  await page.waitForURL(/\/pass\//);
  const first = page.url();

  await page.goto("/");
  await page.getByPlaceholder("Your name").fill("Someone Else Entirely");
  await page.getByPlaceholder("Phone (10 digits)").fill("09876543210");
  await page.getByTestId("register-submit").click();
  await page.waitForURL(/\/pass\//);

  expect(page.url()).toBe(first);
  const rows = await sql("select count(*)::int n from attendees");
  expect(rows[0].n).toBe(1);
});

test("E17 · /find recovers the pass by phone number", async ({ page }) => {
  await freshEvent();
  await page.goto("/");
  await page.getByPlaceholder("Your name").fill("Aditya Prakash Gupta");
  await page.getByPlaceholder("Phone (10 digits)").fill("9812345678");
  await page.getByTestId("register-submit").click();
  await page.waitForURL(/\/pass\//);
  const passUrl = page.url();

  await page.goto("/find");
  await page.getByPlaceholder("Phone (10 digits)").fill("9812345678");
  await page.getByRole("button", { name: "Find my pass" }).click();
  await page.waitForURL(/\/pass\//);
  expect(page.url()).toBe(passUrl);
});

test("E22/R3 · the public pages close themselves at the cutoff", async ({ page }) => {
  const eventId = await freshEvent();

  await page.goto("/");
  await expect(page.getByTestId("register-submit")).toBeVisible();

  await sql("update events set closes_at = now() - interval '1 minute' where id = $1", [eventId]);

  await page.goto("/");
  await page.waitForURL("**/closed");
  await expect(page.getByText("Registration has closed")).toBeVisible();
});

test("R2 · confirmations stop at capacity while registration stays open", async ({ page }) => {
  const eventId = await freshEvent(2);

  await sql(
    `insert into attendees (event_id, pass_code, name, phone, utr, utr_at, state)
     select $1, 'OM0609-Q' || g, 'Queue ' || g, '96000000' || lpad(g::text, 2, '0'),
            lpad((700000000000 + g)::text, 12, '0'),
            now() + (g || ' seconds')::interval, 'submitted'
     from generate_series(1, 4) g`,
    [eventId],
  );

  await login(page);
  await page.goto("/admin/verify");
  await page
    .getByTestId("verify-paste")
    .fill([1, 2, 3, 4].map((g) => `UPI/${700000000000 + g}/ONMIC 300.00 Cr`).join("\n"));
  await page.getByTestId("verify-run").click();

  await expect(page.getByTestId("verify-summary")).toContainText("2 confirmed");
  await expect(page.getByText("2 over capacity")).toBeVisible();

  // Registration is untouched: an unpaid registration costs nothing. [R2]
  await page.goto("/");
  await expect(page.getByTestId("seats-left")).toHaveText("0 / 2");
  await expect(page.getByTestId("register-submit")).toBeVisible();
});
