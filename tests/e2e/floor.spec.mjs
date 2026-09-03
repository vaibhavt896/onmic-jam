/**
 * §11.4 — the floor screen, and §12.3's three failure modes at the table.
 *
 * There is deliberately NO offline claim queue here. §12.3: "a claim must be
 * authoritative at the moment it is granted, and an optimistic local claim that
 * later fails on the server hands out a drink you cannot account for." One
 * reliable path plus one human fallback beats two unreliable paths — so the
 * roster is cached and searchable offline, and claiming is not.
 */
import { expect, test } from "@playwright/test";
import { closePool, login, seedEvent, sql } from "./fixtures.mjs";

test.afterAll(async () => {
  await closePool();
});

async function openFloor(page) {
  await login(page);
  await page.goto("/admin/floor");
  // Wait until the roster is actually in hand before anything else.
  await page.getByTestId("floor-search").fill("OM0609-P001");
  await expect(page.getByTestId("claim-for-OM0609-P001")).toBeVisible();
  await page.getByTestId("floor-search").fill("");
}

test("R8 · claiming for someone whose phone is dead shows the waiter a green screen", async ({
  page,
}) => {
  await seedEvent({ confirmed: 6, claimSeconds: 90 });
  await openFloor(page);

  await page.getByTestId("floor-search").fill("OM0609-P001");
  await page.getByTestId("claim-for-OM0609-P001").click();

  // The same green screen the attendee would have shown: staff learn one rule.
  await expect(page.getByTestId("green-screen")).toBeVisible();
  await expect(page.getByTestId("coupon-active")).toHaveText("1");
  const size = await page
    .getByTestId("coupon-active")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(96);
  await expect(page.getByTestId("claim-countdown")).toContainText("⏱");

  const [row] = await sql("select state, claim_by from attendees where pass_code = 'OM0609-P001'");
  expect(row).toMatchObject({ state: "claimed", claim_by: "admin" });

  await page.getByTestId("green-dismiss").click();
  await expect(page.getByTestId("green-screen")).toHaveCount(0);
});

test("E10 · an accidental claim is undone in two taps, and the drink is claimable again", async ({
  page,
}) => {
  const eventId = await seedEvent({ confirmed: 4, claimSeconds: 90 });
  await sql("select claim_drink($1, 'OM0609-P002', 'self')", [eventId]);
  await openFloor(page);

  await page.getByTestId("floor-search").fill("OM0609-P002");
  await expect(page.getByTestId("floor-results")).toContainText("claimed");

  // Tap one: ask. Tap two: do it. §8.4
  await page.getByTestId("reset-OM0609-P002").click();
  await page.getByTestId("reset-confirm-OM0609-P002").click();
  await expect(page.getByTestId("floor-note")).toContainText("claimable again");

  const [row] = await sql("select state, claimed_at from attendees where pass_code = 'OM0609-P002'");
  expect(row).toMatchObject({ state: "confirmed", claimed_at: null });

  // [S9] and it is in the append-only log, with a reason.
  const log = await sql("select detail from audit_log where action = 'reset_claim'");
  expect(log).toHaveLength(1);
  expect(log[0].detail.reason).toBe("accidental tap");

  await page.getByTestId("floor-search").fill("OM0609-P002");
  await expect(page.getByTestId("claim-for-OM0609-P002")).toBeVisible();
});

test("R12 · a walk-in is added in two fields and gets a coupon at door price", async ({ page }) => {
  await seedEvent({ confirmed: 3 });
  await openFloor(page);

  await page.getByTestId("walkin-open").click();
  await page.getByTestId("walkin-name").fill("Friend Of Guest");
  await page.getByTestId("walkin-phone").fill("9800000001");
  await page.getByTestId("walkin-save").click();

  const done = page.getByTestId("walkin-done");
  await expect(done).toBeVisible();
  await expect(done).toContainText("4"); // the next coupon
  await expect(done).toContainText("₹350 to collect");
  // §11.4 — "show them the QR": it is on the screen, not in another app.
  await expect(done.locator('img[alt*="UPI QR"]')).toBeVisible();

  const [row] = await sql(
    "select state, amount_paid, is_walkin, coupon_no from attendees where phone = '9800000001'",
  );
  expect(row).toMatchObject({ state: "confirmed", amount_paid: 350, is_walkin: true, coupon_no: 4 });
});

test("E9 · a friend with no pass is not in the list, and the screen says what to do", async ({
  page,
}) => {
  await seedEvent({ confirmed: 4 });
  await openFloor(page);

  await page.getByTestId("floor-search").fill("Nobody At All");
  await expect(page.getByText("Nobody paid by that name.")).toBeVisible();
  await expect(page.getByText(/No green screen, no mocktail/)).toBeVisible();
  await expect(page.getByTestId("walkin-open")).toBeVisible();
});

test("§12.3 · with the API unreachable the cached roster still searches, and says so", async ({
  page,
}) => {
  await seedEvent({ confirmed: 8 });
  await openFloor(page);

  // Everything the server provides is now dead. The document still loads from
  // the browser cache; every data call fails.
  await page.route("**/api/**", (route) => route.abort("failed"));
  await page.reload();

  await expect(page.getByTestId("floor-search")).toBeVisible();
  await expect(page.getByText(/Roster from \d+ min ago/)).toBeVisible();

  await page.getByTestId("floor-search").fill("OM0609-P003");
  await expect(page.getByTestId("claim-for-OM0609-P003")).toBeVisible();

  // But a claim is never faked. No optimistic green, and the server heard
  // nothing. §12.3
  await page.getByTestId("claim-for-OM0609-P003").click();
  await expect(page.getByTestId("floor-error")).toContainText("No signal");
  await expect(page.getByTestId("green-screen")).toHaveCount(0);

  const rows = await sql("select count(*)::int n from attendees where state = 'claimed'");
  expect(rows[0].n).toBe(0);
});

test("search matches name, last-4, coupon and pass — all four, one box", async ({ page }) => {
  await seedEvent({ confirmed: 6 });
  await openFloor(page);

  const [person] = await sql(
    "select name, phone, coupon_no, pass_code from attendees where coupon_no = 3",
  );

  for (const query of [
    person.name.slice(0, 4),
    person.phone.slice(-4),
    String(person.coupon_no),
    person.pass_code,
  ]) {
    await page.getByTestId("floor-search").fill(query);
    await expect(
      page.getByTestId("floor-results").getByText(person.name, { exact: true }).first(),
      `searching "${query}"`,
    ).toBeVisible();
  }

  // Case- and diacritic-insensitive.
  await page.getByTestId("floor-search").fill("vaibhav");
  await expect(page.getByTestId("floor-results").locator("li")).not.toHaveCount(0);
});

test("S10 · the cached roster on a volunteer's phone holds no full phone numbers", async ({
  page,
}) => {
  await seedEvent({ confirmed: 6 });
  await openFloor(page);

  const cached = await page.evaluate(() => {
    const id = localStorage.getItem("onmic.lastEvent");
    return localStorage.getItem(`onmic.roster.${id}`);
  });
  expect(cached).toBeTruthy();
  expect(cached).not.toMatch(/\b9\d{9}\b/);
  expect(cached).toContain("phone4");
});
