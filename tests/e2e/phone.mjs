/**
 * Phone-sized end-to-end check (390 x 844). Needs playwright-core, a seeded
 * database plus tests/e2e/setup.sql, and:
 *   CHROMIUM_PATH=/path/to/chromium STATEMENT_DIR=/path/to/statements node tests/e2e/phone.mjs
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS_DIR ?? "/tmp/";
const STMTS = process.env.STATEMENT_DIR; // folder with second.xls and jasuba.xls (client data, not in the repo)
const results = [];
const check = (name, cond, detail = "") => {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
async function phone() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: -1.2834, longitude: 36.8253, accuracy: 14 },
    permissions: ["geolocation"],
    timezoneId: "Africa/Nairobi",
  });
  return ctx.newPage();
}
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", "Switchlink2026!");
  await Promise.all([page.waitForURL(/dashboard/), page.click("button[type=submit]")]);
  await page.waitForSelector("h1", { timeout: 20000 }); // past the loading skeleton
}
const ready = (page) => page.waitForSelector("nav a:has-text('Overview')", { timeout: 20000 });
const shot = (page, name, full = false) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: full });
const noHorizontalScroll = async (page, name) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${name}: no sideways scrolling at 390px`, w <= 390, `page width ${w}px`);
};

// ---------------- BDO ----------------
{
  const page = await phone();
  await page.goto(`${BASE}/dashboard`);
  check("signed-out visitor is sent to login", page.url().includes("/login"));
  await page.fill("#email", "zaddock@test.com");
  await page.fill("#password", "wrong-password-1");
  await page.click("button[type=submit]");
  await page.waitForSelector("text=don't match");
  check("wrong password shows an error", true);
  await login(page, "zaddock@test.com");
  await shot(page, "01-bdo-dashboard", true);
  await noHorizontalScroll(page, "BDO dashboard");
  check("BDO dashboard shows their agents", (await page.locator("text=My agents this month").count()) === 1);

  await page.goto(`${BASE}/accounts`);
  await shot(page, "02-bdo-accounts");
  await noHorizontalScroll(page, "accounts list");
  const names = await page.locator("ul li a p.truncate").allTextContents();
  check(
    "BDO sees own and their agents' accounts, not other BDOs'",
    names.includes("Baraka Butchery") && names.includes("Upendo Hardware") && !names.includes("Mama Njeri Grocers"),
    names.join(", ")
  );

  // New merchant with location capture
  await page.goto(`${BASE}/accounts/new`);
  await page.click("button:has-text('Merchant')");
  await page.fill("#name", "Wanjiru Cereals Shop");
  await page.fill("#phone", "0711222333");
  await page.fill("#business_type", "Cereals");
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Location is required");
  check("saving without a location is refused", true);
  await page.click("button:has-text('Capture location')");
  await page.waitForSelector("text=Location captured");
  await page.waitForTimeout(1500);
  await shot(page, "03-new-account-location", true);
  await noHorizontalScroll(page, "new account form");
  await page.click("button[type=submit]");
  try { await page.waitForURL(/\/accounts\/[0-9a-f-]{36}/, { timeout: 20000, waitUntil: "commit" }); } catch (e) { await shot(page, "zz-create-failed", true); throw e; }
  await page.waitForSelector("h1:has-text('Wanjiru Cereals Shop')", { timeout: 20000 });
  check("merchant account created and opened", true);
  await shot(page, "04-account-overview", true);
  await noHorizontalScroll(page, "account page");
  const accountUrl = page.url();

  // Status rules: can't go to Document collection without a 4-digit Pesi number.
  await page.click("button:has-text('Change status')");
  await page.selectOption("select#status", "DOCUMENT_COLLECTION");
  await page.click("form button[type=submit]:has-text('Update status')");
  await page.waitForSelector("text=4-digit Pesi account number first");
  check("Document collection blocked until Pesi number recorded", true);
  await page.keyboard.press("Escape");

  await page.goto(`${accountUrl}?tab=pipeline`);
  check("merchant starts with a QF opportunity", (await page.locator("text=QF").count()) > 0);
  await shot(page, "05-account-pipeline");

  await page.goto(`${accountUrl}?tab=activity`);
  await page.click("button:has-text('Follow-up')");
  await page.click("button:has-text('Tomorrow')");
  await page.click("form button[type=submit]:has-text('Schedule')");
  try { await page.waitForSelector("text=Follow-up scheduled", { timeout: 15000 }); } catch (e) { await shot(page, "zz-followup-failed"); throw e; }
  const due = await page.locator("li:has-text('Due')").first().textContent();
  check("follow-up stored at 09:00 Nairobi", /09:00/.test(due ?? ""), due?.trim().slice(0, 80));
  await shot(page, "06-account-activity");

  check("BDO has no Location tab", (await page.locator("nav[aria-label='Account sections'] a:has-text('Location')").count()) === 0);
  await page.goto(`${accountUrl}?tab=money`);
  await ready(page);
  check("BDO can't set QF limits", (await page.locator("button:has-text('Set QF limit')").count()) === 0);
  await page.goto(`${BASE}/statements`);
  await page.waitForTimeout(800);
  const h1 = await page.locator("h1").first().innerText();
  check("BDO can't open Statements", !/Statements/.test(h1) && (await page.locator("text=Upload statement").count()) === 0, `shown: ${h1}`);

  // Add an agent
  await page.goto(`${BASE}/users`);
  await page.waitForSelector("h1:has-text('People')");
  await page.click("button:has-text('Add')");
  await page.fill("#name", "Kevin Mutua");
  await page.fill("#email", "kevin@test.com");
  await page.click("form button[type=submit]:has-text('Add')");
  try { await page.waitForSelector("text=Kevin Mutua added", { timeout: 15000 }); } catch (e) { await shot(page, "zz-add-agent-failed", true); throw e; }
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForSelector("h1:has-text('People')");
  const kevin = (await page.locator("li:has-text('Kevin Mutua')").first().innerText()).replace(/\s+/g, " ");
  check("BDO adds an agent who reports to them", /Agent · reports to Zaddock Anyona/.test(kevin), kevin.slice(0, 100));
  check("BDO can deactivate their agent", (await page.locator("li:has-text('Kevin Mutua') button:has-text('Deactivate')").count()) === 1);
  check("BDO can't manage another BDO's agent", (await page.locator("text=Mercy Wanjiru").count()) === 0);
  await shot(page, "07-bdo-people", true);
  await noHorizontalScroll(page, "BDO people");
  await page.context().close();
}

// ---------------- Agent ----------------
{
  const page = await phone();
  await login(page, "brian@test.com");
  await shot(page, "07b-agent-dashboard", true);
  await page.goto(`${BASE}/accounts`);
  const names = await page.locator("ul li a p.truncate").allTextContents();
  check("agent sees only own accounts", names.includes("Upendo Hardware") && !names.includes("Baraka Butchery"), names.join(", "));
  check("agent has no People page in the menu", (await page.locator("a[href='/users']").count()) === 0);
  await page.goto(`${BASE}/users`);
  await page.waitForTimeout(800);
  check("agent is turned away from People", !page.url().includes("/users"));
  await page.context().close();
}

// ---------------- Admin: statements and money ----------------
{
  const page = await phone();
  await login(page, "daniel@test.com");
  await page.goto(`${BASE}/statements`);
  await page.setInputFiles("#file", `${STMTS}/second.xls`);
  await page.click("button[type=submit]");
  const rows = () => page.locator("ul.card > li").count();
  let before = await rows();
  const done = async () => {
    for (let i = 0; i < 120 && (await rows()) <= before; i++) await page.waitForTimeout(500);
    before = await rows();
  };
  const latest = async () => (await page.locator("ul.card > li").first().innerText()).replace(/\s+/g, " ");
  await done(); await page.waitForTimeout(800);
  let row = await latest();
  check("statement matched by Paybill ACC. 3887 and saved", /Test Merchant Paybill 3887/.test(row) && /629 new of 629/.test(row), row.slice(0, 120));
  await page.setInputFiles("#file", `${STMTS}/second.xls`);
  await page.click("button[type=submit]");
  await done(); await page.waitForTimeout(800);
  row = await latest();
  check("re-uploading the same statement adds nothing", /0 new of 629/.test(row), row.slice(0, 80));
  await page.selectOption("#account_id", { label: "Test Merchant Header (1088)" });
  await page.setInputFiles("#file", `${STMTS}/jasuba.xls`);
  await page.click("button[type=submit]");
  await done(); await page.waitForTimeout(800);
  row = await latest();
  check("first statement saved against the chosen account", /Test Merchant Header/.test(row) && /243 new of 243/.test(row), row.slice(0, 160));
  await page.waitForTimeout(500);
  await shot(page, "09-statements", true);

  await page.goto(`${BASE}/accounts?q=Paybill`);
  const href = await page.getByRole("link", { name: /Test Merchant Paybill 3887/ }).getAttribute("href");
  await page.goto(`${BASE}${href}?tab=money`);
  await ready(page);
  check("admin can set QF limits and record disbursements", (await page.locator("button:has-text('Set QF limit')").count()) === 1 && (await page.locator("button:has-text('Record disbursement')").count()) === 1);
  await shot(page, "13-merchant-money", true);
  await noHorizontalScroll(page, "merchant money tab");
  await page.context().close();
}

// ---------------- Team Leader ----------------
{
  const page = await phone();
  await login(page, "joy@test.com");
  await shot(page, "08-leader-dashboard", true);
  await noHorizontalScroll(page, "leader dashboard");
  check("leader dashboard shows BDOs", (await page.locator("text=BDOs this month").count()) === 1);

  await page.goto(`${BASE}/reports?period=lastmonth`);
  await page.waitForSelector("text=By BDO", { timeout: 20000 });
  await shot(page, "10-reports-september", true);
  await noHorizontalScroll(page, "reports");
  const zgroup = (await page.locator("li.card:has-text('Zaddock Anyona') > div").first().innerText()).replace(/\s+/g, " ");
  check("September: Zaddock's BDO total includes his agent's draws", /QF KES 335,459/.test(zgroup), zgroup.slice(0, 140));
  const zown = (await page.locator("li.card:has-text('Zaddock Anyona') li:has-text(\"BDO's own\")").first().innerText()).replace(/\s+/g, " ");
  const bline = (await page.locator("li.card:has-text('Zaddock Anyona') li:has-text('Brian Kiptoo')").first().innerText()).replace(/\s+/g, " ");
  check("agent's figures shown under their BDO", /Agent/.test(bline) && !/QF KES 0\b/.test(bline), `${zown.slice(0, 60)} | ${bline.slice(0, 60)}`);

  await page.goto(`${BASE}/locations`);
  await page.waitForTimeout(1500);
  await shot(page, "11-locations");
  const locNames = await page.locator("ul.card li a span.truncate").allTextContents();
  check("leader sees own team's locations only", locNames.includes("Wanjiru Cereals Shop") && !locNames.includes("Mombasa International Academy"), `${locNames.length} rows`);

  await page.goto(`${BASE}/accounts?q=Paybill`);
  const href = await page.getByRole("link", { name: /Test Merchant Paybill 3887/ }).getAttribute("href");
  await page.goto(`${BASE}${href}?tab=money`);
  await ready(page);
  check("leader can't set limits or record disbursements (Admin only)", (await page.locator("button:has-text('Set QF limit')").count()) === 0 && (await page.locator("button:has-text('Record disbursement')").count()) === 0);
  await shot(page, "12-leader-merchant-money");
  await page.goto(`${page.url().split("?")[0]}?tab=location`);
  await ready(page);
  await shot(page, "13b-location-tab", true);
  check("leader has the Location tab", (await page.locator("nav[aria-label='Account sections'] a:has-text('Location')").count()) === 1);
  await page.goto(`${BASE}/statements`);
  await page.waitForTimeout(800);
  check("leader can't open Statements", (await page.locator("text=Upload statement").count()) === 0);

  await page.goto(`${BASE}/users`);
  await page.waitForSelector("h1:has-text('People')");
  check("leader can move an agent to another BDO", (await page.locator("li:has-text('Brian Kiptoo') button:has-text('Change BDO')").count()) === 1);
  await shot(page, "14b-leader-people", true);
  await page.goto(`${BASE}/pipeline`);
  await shot(page, "14-pipeline");
  await noHorizontalScroll(page, "pipeline");
  await page.context().close();
}

// ---------------- Admin ----------------
{
  const page = await phone();
  await login(page, "daniel@test.com");
  await page.goto(`${BASE}/users`);
  await shot(page, "15-admin-people", true);
  await noHorizontalScroll(page, "people");
  await page.goto(`${BASE}/reports?period=lastmonth`);
  check("admin sees By team and By BDO sections", (await page.locator("text=By team").count()) === 1 && (await page.locator("text=By BDO").count()) === 1);
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const d = await desktop.newPage();
  await d.goto(`${BASE}/login`);
  await d.fill("#email", "daniel@test.com");
  await d.fill("#password", "Switchlink2026!");
  await Promise.all([d.waitForURL(/dashboard/), d.click("button[type=submit]")]);
  await d.screenshot({ path: `${OUT}16-desktop-dashboard.png` });
  await desktop.close();
  await page.context().close();
}

await browser.close();
console.log(results.join("\n"));
