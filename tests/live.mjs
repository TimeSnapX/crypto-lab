// Live smoke test against the REAL keyless APIs (no mocks).
//   BASE=http://127.0.0.1:4180/crypto-lab/ node tests/live.mjs
//   BASE=https://timesnapx.github.io/crypto-lab/ node tests/live.mjs
import { createRequire } from "node:module";
const req = createRequire("/workspace/tools/package.json");
const { chromium } = req("playwright-core");
const BASE = process.env.BASE || "http://127.0.0.1:4180/crypto-lab/";
const SHOTS = process.env.SHOTS || "";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [], apiHosts = new Map();
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console " + m.text()));
page.on("response", (r) => { const u = new URL(r.url()); if (!r.url().startsWith(BASE)) { const k = u.host; const s = apiHosts.get(k) || { ok: 0, fail: 0, codes: new Set() }; r.status() < 400 ? s.ok++ : s.fail++; s.codes.add(r.status()); apiHosts.set(k, s); } });
page.on("requestfailed", (r) => { const k = new URL(r.url()).host; const s = apiHosts.get(k) || { ok: 0, fail: 0, codes: new Set() }; s.fail++; s.codes.add("ERR " + r.failure()?.errorText); apiHosts.set(k, s); });
const results = [];
async function visit(route, waitFor, check) {
  await page.goto(BASE + "#" + route);
  let live = false;
  try { await page.waitForSelector(waitFor || ".src.live", { timeout: 25000 }); live = true; } catch {}
  await page.waitForTimeout(1200);
  const badges = await page.$$eval(".src", (els) => els.map((e) => e.textContent.trim()));
  const extra = check ? await check() : "";
  results.push({ route, live, badges: badges.slice(0, 4), extra });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-${route.replace(/\W/g, "_")}.png`, fullPage: false });
}
await visit("home");
await visit("markets", "table.mkt tbody tr", async () => `${await page.$$eval("table.mkt tbody tr", (r) => r.length)} coins; sparkline paths: ${await page.$$eval("table.mkt svg polyline", (r) => r.length)}`);
await visit("portfolio");
await visit("trade", "[data-price]:not([data-price=''])", async () => `price ${await page.getAttribute("[data-price]", "data-price")}`);
await page.click('[data-mode="replay"]'); try { await page.waitForSelector(".chart rect", { timeout: 25000 }); results.push({ route: "trade replay", live: true, extra: await page.textContent(".replay-status") }); } catch { results.push({ route: "trade replay", live: false }); }
await visit("mining", ".src.live", async () => (await page.textContent('[data-k="mining-table"]')).slice(0, 120));
await visit("address");
await page.click('[data-famous="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"]');
try { await page.waitForSelector('[data-k="balance"]', { timeout: 25000 }); results.push({ route: "address lookup genesis", live: true, extra: await page.textContent('[data-k="balance"]') + " / " + (await page.textContent('[data-k="txcount"]')) }); } catch { results.push({ route: "address lookup", live: false }); }
await visit("whatif", '[data-k="missed"]', async () => (await page.textContent('[data-k="missed"]')) + " | famous rows: " + (await page.$$eval(".card table tbody tr", (r) => r.map((x) => x.textContent.slice(0, 90)).join(" || "))));
await visit("tools?dca", '[data-k="dca"]', async () => (await page.textContent('[data-k="dca"]')) + " / " + (await page.textContent('[data-k="lump"]')));
await visit("tools?halving", '[data-k="blocksleft"]', async () => (await page.textContent('[data-k="blocksleft"]')) + `; chart paths ${await page.$$eval(".chart path", (p) => p.length)}`);
await visit("tools?fng", '[data-k="fng"]', async () => await page.textContent('[data-k="fng"]'));
await visit("tools?sats", '[data-k="sat"]', async () => await page.textContent('[data-k="sat"]'));
await visit("sources", "table");
await page.click("text=Test all sources now"); await page.waitForTimeout(8000);
const src = await page.$$eval("[data-src]", (els) => els.map((e) => `${e.dataset.src}: ${e.textContent}`));
console.log(JSON.stringify({ base: BASE, results, sources: src, apiHosts: Object.fromEntries([...apiHosts].map(([k, v]) => [k, { ok: v.ok, fail: v.fail, codes: [...v.codes] }])), errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
