// Headless Chrome at 412x915 (Pixel-class) with ALL APIs mocked, hand-checked numbers in the UI,
// fallback / offline / rate-limit behaviour, and a screenshot of every tab.
//   node tests/e2e.mjs        (starts its own server on :4181)
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./server.mjs";
const req = createRequire("/workspace/tools/package.json");
const { chromium } = req("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS || path.join(here, "..", "test-results");
await mkdir(SHOTS, { recursive: true });
const srv = await serve(4181);
const BASE = "http://127.0.0.1:4181/crypto-lab/";

let fails = 0, passes = 0, phase = "normal";
const errors = [], unknownHosts = new Set();
const check = (cond, msg, extra = "") => { cond ? passes++ : fails++; console.log(`${cond ? "✓" : "✗"} ${msg}${!cond && extra ? `  [got: ${extra}]` : ""}`); };

// ------------------------------------------------------------------ mock data
const M = {
  btcUsd: 70000, btcAud: 100000, tick: { BTCUSDT: 100000 }, fail: new Set(), status: {},
  coins: [["bitcoin", "btc", "Bitcoin", 1], ["ethereum", "eth", "Ethereum", 2], ["solana", "sol", "Solana", 3]],
};
const DAY = 86400000;
const dayMs = (d) => Date.parse(d + "T00:00:00Z");
const DAYPRICE = { "2020-03-13": 5000, "2021-04-14": 60000 };
function marketsRows(cur) {
  return M.coins.map(([id, sym, name, rank], i) => {
    const aud = id === "bitcoin" ? M.btcAud : [100000, 5000, 200][i];
    const usd = id === "bitcoin" ? M.btcUsd : [70000, 3500, 140][i];
    return { id, symbol: sym, name, current_price: cur === "aud" ? aud : usd, market_cap: 1e12 / rank, market_cap_rank: rank, price_change_percentage_24h: i === 1 ? -2.5 : 1.25,
      sparkline_in_7d: cur === "usd" ? { price: Array.from({ length: 168 }, (_, k) => usd * (1 + Math.sin(k / 10) * 0.03)) } : undefined };
  });
}
function respond(url) {
  const u = new URL(url), p = u.pathname, q = u.searchParams;
  switch (u.host) {
    case "api.coingecko.com":
      if (p.endsWith("/coins/markets")) return marketsRows(q.get("vs_currency"));
      if (p.endsWith("/simple/price")) return { tether: { aud: 1.5, usd: 1 }, bitcoin: { aud: M.btcAud, usd: M.btcUsd } };
      if (p.includes("/market_chart")) return { prices: Array.from({ length: 365 }, (_, k) => [Date.now() - (365 - k) * DAY, 50000 + k * 10]) };
      break;
    case "api.coinpaprika.com":
      if (p.endsWith("/tickers")) return marketsRows("usd").map((r, i) => ({ symbol: r.symbol.toUpperCase(), name: r.name, rank: r.market_cap_rank, quotes: { USD: { price: r.current_price, percent_change_24h: 1 }, AUD: { price: marketsRows("aud")[i].current_price, market_cap: 1e12 } } }));
      break;
    case "data-api.binance.vision": {
      if (p.endsWith("/ticker/price")) return { symbol: q.get("symbol"), price: String(M.tick[q.get("symbol")] ?? 100) };
      if (p.endsWith("/klines")) {
        const iv = q.get("interval"), lim = +q.get("limit"), st = +q.get("startTime") || Date.now() - 500 * 3600000;
        if (iv === "1h") return Array.from({ length: 500 }, (_, i) => { const c = 100000 * (1 - 0.001 * i), o = 100000 * (1 - 0.001 * (i - 1)); return [st + i * 3600000, String(o), String(Math.max(o, c) * 1.001), String(Math.min(o, c) * 0.999), String(c), "1"]; });
        if (iv === "1d" && lim === 1) { const d = new Date(st).toISOString().slice(0, 10); const c = DAYPRICE[d] ?? 10000; return [[st, String(c), String(c), String(c), String(c), "1"]]; }
        if (iv === "1d") return [100, 50, 100].map((c, i) => [st + i * DAY, String(c), String(c), String(c), String(c), "1"]);
      }
      if (p.endsWith("/ticker/24hr")) return [];
      break;
    }
    case "api.exchange.coinbase.com":
      if (p.endsWith("/ticker")) return { price: "100000" };
      if (p.endsWith("/candles")) return [];
      break;
    case "mempool.space":
      if (p === "/api/v1/mining/hashrate/3d") return { currentHashrate: (1e14 * 4294967296) / 600, currentDifficulty: 1e14, hashrates: [] };
      if (p === "/api/v1/difficulty-adjustment") return { timeAvg: 600000, difficultyChange: 1.5, remainingBlocks: 1000, nextRetargetHeight: 971712, estimatedRetargetDate: Date.now() + 6e8 };
      if (p === "/api/blocks/tip/height") return "970615";
      if (p === "/api/v1/mining/reward-stats/144") return { startBlock: "970472", endBlock: "970615", totalFee: "0", totalReward: "45000000000" };
      if (p === "/api/v1/prices") return { time: Date.now() / 1000, USD: M.btcUsd, AUD: M.btcAud };
      if (p === "/api/v1/historical-price") return q.get("timestamp") ? { prices: [{ time: +q.get("timestamp"), USD: 10000 }] } : { prices: Array.from({ length: 400 }, (_, k) => ({ time: 1281000000 + k * 604800 * 1.3, USD: Math.exp(k / 40) })) };
      if (/^\/api\/address\/[^/]+\/txs$/.test(p)) return [{ txid: "ab".repeat(32), status: { confirmed: true, block_time: 1700000000 }, vin: [], vout: [{ scriptpubkey_address: p.split("/")[3], value: 5000000000 }] }];
      if (/^\/api\/address\/[^/]+$/.test(p)) return { chain_stats: { funded_txo_sum: 5000000000, spent_txo_sum: 0, tx_count: 1000 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } };
      break;
    case "blockstream.info":
      if (/^\/api\/address\/[^/]+\/txs$/.test(p)) return [];
      if (/^\/api\/address\/[^/]+$/.test(p)) return { chain_stats: { funded_txo_sum: 10000000000, spent_txo_sum: 0, tx_count: 7 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } };
      break;
    case "blockchain.info": return "1";
    case "api.frankfurter.dev":
      if (p.endsWith("/latest")) return { rates: { AUD: 1.5 } };
      if (p.includes("..")) { const [a, b] = p.split("/").pop().split(".."); const out = {}; for (let t = dayMs(a); t <= dayMs(b); t += DAY) out[new Date(t).toISOString().slice(0, 10)] = { AUD: 1.5 }; return { rates: out }; }
      return { rates: { AUD: 1.5 } };
    case "api.alternative.me": return { data: Array.from({ length: 30 }, (_, k) => ({ value: String(59 - k % 7), value_classification: "Greed", timestamp: String(Math.floor(Date.now() / 1000) - k * 86400) })) };
  }
  return undefined;
}

const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/google-chrome", args: ["--lang=en-AU"] });
async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-AU", timezoneId: "Australia/Brisbane", serviceWorkers: "block", acceptDownloads: true });
  await ctx.route((url) => !url.href.startsWith("http://127.0.0.1:4181/"), async (route) => {
    const url = route.request().url(); const host = new URL(url).host;
    if (M.fail.has(host)) return route.abort("failed");
    if (M.status[host]) return route.fulfill({ status: M.status[host], body: "{}", headers: { "access-control-allow-origin": "*" } });
    const body = respond(url);
    if (body === undefined) { unknownHosts.add(url); return route.abort("blockedbyclient"); }
    return route.fulfill({ status: 200, headers: { "content-type": typeof body === "string" ? "text/plain" : "application/json", "access-control-allow-origin": "*" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${phase}] pageerror ${e.message}`));
  page.on("console", (m) => { if (m.type() !== "error") return; const t = m.text(); if (phase !== "normal" && /Failed to load resource|ERR_FAILED|status of (429|503)/.test(t)) return; errors.push(`[${phase}] console ${t}`); });
  page.on("dialog", (d) => d.accept("Test label"));
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const full = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}-full.png`), fullPage: true });
const text = (page, sel) => page.locator(sel).first().innerText();
async function go(page, route, waitSel) { await page.goto(BASE + "#" + route); await page.waitForSelector(waitSel || "main .card, main .tiles", { timeout: 15000 }); await page.waitForTimeout(400); }
const refresh = (page) => page.evaluate(async () => { window.__cl.clearCache(); await window.__cl.ctx.refreshMarkets(true); });

const { ctx, page } = await newCtx();

// ---------------------------------------------------------------- home
await go(page, "home", ".src.live");
check((await text(page, "main")).includes("A$100,000"), "home shows live BTC A$100,000");
check((await page.locator("main .src.live").count()) >= 3, "home: 3 live badges (prices, F&G, halving)");
check(await page.evaluate(() => getComputedStyle(document.querySelector(".bottom")).position === "fixed"), "bottom nav is fixed");
check(await page.evaluate(() => document.documentElement.scrollWidth <= 412), "no horizontal overflow at 412 px", await page.evaluate(() => document.documentElement.scrollWidth));
await shot(page, "01-home"); await full(page, "01-home");

// ---------------------------------------------------------------- markets + alerts
await go(page, "markets", "table.mkt tbody tr");
check((await page.locator("table.mkt tbody tr").count()) === 3, "markets table rows");
check((await text(page, 'tr[data-coin="bitcoin"]')).includes("A$100,000") && (await text(page, 'tr[data-coin="bitcoin"]')).includes("US$70,000"), "BTC row shows AUD and USD");
check((await page.locator("table.mkt svg.spark polyline").count()) === 3, "sparklines drawn");
await page.getByLabel("Alert price").fill("90000");
await page.getByRole("button", { name: "Add alert" }).click();
await page.waitForSelector(".alert-banner", { timeout: 5000 }).catch(() => {});
check((await page.locator(".alert-banner").count()) === 1, "in-app price alert fires (BTC above A$90,000)");
await shot(page, "02-markets-alert");
await page.locator(".alert-banner .x").click();
await page.getByLabel("BTC", { exact: true }).fill("0.5");
check((await page.getByLabel("Satoshis").inputValue()) === "50000000" && (await page.getByLabel("AUD", { exact: true }).inputValue()) === "50000", "converter 0.5 BTC = 50,000,000 sats = A$50,000");
await shot(page, "02-markets");

// ---------------------------------------------------------------- portfolio
await go(page, "portfolio", ".src.live");
await page.getByLabel("Amount AUD").fill("10000");
await page.getByRole("button", { name: "Buy", exact: true }).click();
await page.waitForTimeout(300);
check((await text(page, '[data-k="total"]')).includes("A$100,000"), "after buy, total still A$100,000");
M.btcAud = 120000; await refresh(page); await page.waitForTimeout(300);
check((await text(page, '[data-k="pnl"]')).includes("A$2,000"), "BTC +20% → P&L +A$2,000 on 0.1 BTC", await text(page, '[data-k="pnl"]'));
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
check(dl.suggestedFilename() === "crypto-lab-portfolio.json", "portfolio export downloads JSON");
await shot(page, "03-portfolio"); await full(page, "03-portfolio");
M.btcAud = 100000; await refresh(page);

// ---------------------------------------------------------------- trade (live)
await go(page, "trade", "[data-open]:not([disabled])");
await page.locator("[data-open]").click();
await page.waitForSelector("[data-pos]");
check((await text(page, "[data-pos]")).includes("US$90,452"), "10x long at US$100,000 → liquidation US$90,452 (MMR 0.5%)", await text(page, "[data-pos]"));
M.tick.BTCUSDT = 110000; await page.evaluate(() => window.__cl.clearCache());
await page.waitForFunction(() => document.querySelector('[data-k="upnl"]')?.innerText.includes("US$100.00"), null, { timeout: 15000 }).catch(() => {});
check((await text(page, '[data-k="upnl"]')).includes("US$100.00"), "price → 110,000: unrealised P&L +US$100 (ROE +100%)", await text(page, '[data-k="upnl"]'));
await shot(page, "04-trade-live");
await page.locator("[data-pos] button", { hasText: "Close" }).click();
await page.waitForTimeout(300);
const hist = await text(page, "main");
check(hist.includes("US$98.95"), "closed: net = 100 − 0.50 − 0.55 fees = US$98.95");
check((await text(page, '[data-k="winrate"]')).includes("100%"), "win rate 100%");
check(hist.includes("US$10,099"), "balance 10,000 + 98.95 ≈ US$10,099");
// replay + liquidation
await page.click('[data-mode="replay"]');
await page.waitForSelector(".chart rect", { timeout: 10000 });
await page.getByLabel("Leverage number").fill("50");
await page.locator("[data-open]").click();
await page.waitForSelector("[data-pos]");
check((await text(page, "[data-pos]")).includes("US$93,765"), "replay: 50x long at 95,200 → liq US$93,765", await text(page, "[data-pos]"));
for (let i = 0; i < 16; i++) await page.getByRole("button", { name: "Step ⏭" }).click();
await page.waitForTimeout(300);
check((await text(page, "main")).includes("liquidated"), "replay: falling candles liquidate the 50x long");
await shot(page, "05-trade-replay"); await full(page, "05-trade");
await page.getByLabel("Stop", { exact: true }).fill("98000"); await page.getByLabel("Entry", { exact: true }).fill("100000"); await page.getByLabel("Account (USD)").fill("10000"); await page.getByLabel("Risk per trade %").fill("2");
check((await text(page, '[data-k="risk"]')).includes("US$100") && (await text(page, '[data-k="qty"]')).includes("0.05"), "position size: 2% of 10k capped at $100, stop 2,000 away → 0.05 BTC");

// ---------------------------------------------------------------- mining
await go(page, "mining", ".src.live");
for (const [l, v] of [["Hashrate (TH/s)", "100"], ["Power draw (W)", "3000"], ["Electricity (AUD/kWh)", "0.3"], ["Pool fee %", "0"], ["Hardware cost (AUD)", "3000"]]) await page.getByLabel(l).fill(v);
const mt = await text(page, '[data-k="mining-table"]');
check(mt.includes("0.000063") && mt.includes("A$6.29") && mt.includes("A$21.60") && mt.includes("−A$15.31"), "mining 100 TH/s @ D=1e14, 3.125 BTC, A$100k, 3 kW @ 30c: 0.000063 BTC, A$6.29 rev, A$21.60 power, −A$15.31/day", mt.replace(/\s+/g, " "));
check((await text(page, '[data-k="breakeven"]')).includes("Never"), "loss-making → break-even never");
check((await text(page, "main")).includes("1.5625 BTC"), "halving effect shown (3.125 → 1.5625)");
await page.getByLabel("Hashrate multiplier").fill("1000000"); await page.getByLabel("Hashrate multiplier").dispatchEvent("change");
await page.getByRole("button", { name: "▶ Start" }).click();
await page.waitForTimeout(2500);
check(/[1-9][\d,]* network blocks/.test(await text(page, "main")), "simulation produces blocks");
await page.getByRole("button", { name: /Pause/ }).click();
await page.locator("canvas.sim").scrollIntoViewIfNeeded();
await shot(page, "06-mining-sim"); await page.evaluate(() => scrollTo(0, 0)); await shot(page, "06-mining"); await full(page, "06-mining");

// ---------------------------------------------------------------- project
await go(page, "project", '[data-k="health"]');
check((await text(page, '[data-k="health"]')).includes("100/100"), "default tokenomics score 100/100");
check((await text(page, '[data-k="sum"]')).includes("100"), "allocations sum 100%");
check((await text(page, '[data-k="mcap"]')).includes("US$7,500,000"), "launch MC = 15% float × 1B × $0.05 = US$7.5M", await text(page, '[data-k="mcap"]'));
check((await text(page, '[data-k="fdv"]')).includes("US$50,000,000"), "FDV = 1B × $0.05 = US$50M");
await shot(page, "07-project");
await page.getByRole("button", { name: "Load a bad example" }).click();
check((await text(page, '[data-k="health"]')).includes("10/100"), "bad example → 10/100 with warnings", await text(page, '[data-k="health"]'));
check((await page.locator(".warnlist li").count()) >= 4, "bad example lists warnings");
const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export one-page summary" }).click()]);
check(dl2.suggestedFilename().endsWith("-summary.html"), "one-page summary exported");
await full(page, "07-project");

// ---------------------------------------------------------------- address
await go(page, "address");
await page.getByLabel("Bitcoin address").fill("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ");
check((await text(page, '[data-k="valid"]')).includes("PRIVATE KEY") && (await page.getByLabel("Bitcoin address").inputValue()) === "", "pasting a private key is refused and cleared");
await page.getByLabel("Bitcoin address").fill("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0");
check((await text(page, '[data-k="valid"]')).includes("Taproot"), "taproot address recognised");
await page.locator('[data-famous="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"]').click();
await page.waitForSelector('[data-k="balance"]');
check((await text(page, '[data-k="balance"]')).includes("50 BTC") && (await text(page, '[data-k="balance"]')).includes("A$5,000,000"), "genesis lookup: 50 BTC ≈ A$5,000,000 (mock)");
await page.getByRole("button", { name: "＋ Watch" }).first().click();
check((await text(page, "main")).includes("Test label"), "watch-only address book saves a label");
await shot(page, "08-address"); await full(page, "08-address");
phase = "fallback"; M.status["mempool.space"] = 503;
await page.locator('[data-famous="34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo"]').click();
await page.waitForFunction(() => document.querySelector('[data-k="balance"]')?.innerText.includes("100 BTC"), null, { timeout: 10000 }).catch(() => {});
check((await text(page, ".card .src")).includes("Blockstream"), "mempool.space 503 → Blockstream Esplora fallback", await text(page, ".card .src"));
delete M.status["mempool.space"]; await page.evaluate(() => window.__cl.clearCache()); phase = "normal";

// ---------------------------------------------------------------- what if
await go(page, "whatif", '[data-k="missed"]');
const wi = await text(page, "main");
check((await text(page, '[data-k="sold"]')).includes("A$90,000") && (await text(page, '[data-k="now"]')).includes("A$100,000") && (await text(page, '[data-k="missed"]')).includes("A$10,000"), "what-if: bought 2020 (US$5k×1.5), sold 2021 (US$60k×1.5=A$90k), now A$100k → missed A$10,000");
check(wi.includes("US$60,000") || wi.includes("US$60000"), "what-if shows USD × FX source line");
await shot(page, "09-whatif"); await full(page, "09-whatif");

// ---------------------------------------------------------------- passive
await go(page, "passive", '[data-k="il"]');
check((await text(page, '[data-k="il"]')).includes("−5.72%"), "IL at 2× = −5.72%");
check((await text(page, '[data-k="stack-month"]')).includes("A$27.92"), "income stack 5k@3.5% + 3k@5% + 1k@1% = A$335/yr = A$27.92/mo", await text(page, '[data-k="stack-month"]'));
check((await page.locator("[data-method]").count()) >= 18, "all passive income method cards present");
check((await text(page, "main")).includes("illustrative"), "ranges labelled illustrative");
await shot(page, "10-passive"); await full(page, "10-passive");

// ---------------------------------------------------------------- learn
await go(page, "learn");
await page.locator('[data-lesson="what"] summary').click();
await page.locator('[data-lesson="what"] button').click();
await page.locator('[data-opt="0"]').click();
check((await text(page, "main")).includes("Correct"), "quiz scores a correct answer");
await page.reload(); await page.waitForSelector('[data-k="lessons"]');
check((await text(page, '[data-k="lessons"]')).startsWith("1/10"), "lesson progress persists after reload");
await shot(page, "11-learn"); await full(page, "11-learn");

// ---------------------------------------------------------------- tools
await go(page, "tools?dca", '[data-k="dca"]');
await page.getByLabel("Buy every").selectOption("1"); await page.getByLabel("Total to invest (AUD)").fill("300");
await page.getByRole("button", { name: "Run with real prices" }).click();
await page.waitForFunction(() => document.querySelector('[data-k="dca"]')?.innerText.includes("A$400"), null, { timeout: 8000 }).catch(() => {});
check((await text(page, '[data-k="dca"]')).includes("A$400") && (await text(page, '[data-k="lump"]')).includes("A$300"), "DCA (100,50,100) → A$400 vs lump A$300", (await text(page, '[data-k="dca"]')) + " | " + (await text(page, '[data-k="lump"]')));
await shot(page, "12-tools-dca");
for (const [tab, sel, want, label] of [
  ["tax", '[data-k="net"]', "A$7,450", "CGT: (24,950 − 10,050) × 50% discount = A$7,450"],
  ["fees", '[data-k="feetotal"]', "A$11.00", "fees: 0.5% + half of 1% spread + 0.1% slippage on A$1,000 = A$11"],
  ["halving", '[data-k="blocksleft"]', "79,385", "halving: 1,050,000 − 970,615 = 79,385 blocks"],
  ["fng", '[data-k="fng"]', "59", "Fear & Greed 59"],
  ["sats", '[data-k="sat"]', "A$0.001000", "1 sat at A$100k = A$0.001"],
  ["scam", '[data-k="tokenrisk"]', "/100", "token risk scorer"],
  ["pnl", '[data-k="pnl"]', "A$", "P&L calculator"],
  ["compound", '[data-k="cfinal"]', "A$", "compound calculator"],
]) {
  await page.click(`[data-tool="${tab}"]`);
  await page.waitForSelector(sel, { timeout: 10000 }).catch(() => {});
  const t = await page.locator(sel).first().innerText().catch(() => "");
  check(t.includes(want), label, t);
  await shot(page, `13-tools-${tab}`);
}
check((await text(page, "main")).length > 0, "tools tabs render");
await page.click('[data-tool="tax"]'); await page.waitForSelector('[data-k="taxest"]');
check((await text(page, '[data-k="taxest"]')).includes("A$2,384"), "tax estimate at A$85k income (FY26-27): 30% × 7,450 + 2% Medicare = A$2,384", await text(page, '[data-k="taxest"]'));
check(await page.evaluate(() => document.documentElement.scrollWidth <= 412), "tools: no horizontal overflow");

for (const r of ["more", "sources", "settings"]) { await go(page, r); await shot(page, `14-${r}`); }

// ---------------------------------------------------------------- rate limit → fallback, then offline → last known
phase = "fallback"; M.status["api.coingecko.com"] = 429;
await go(page, "markets", "table.mkt tbody tr");
await refresh(page); await page.waitForTimeout(500);
check((await text(page, "main .src")).includes("CoinPaprika"), "CoinGecko 429 → CoinPaprika fallback", await text(page, "main .src"));
check(await page.evaluate(() => window.__cl.hostBlocked("api.coingecko.com") > Date.now()), "rate-limited host is backed off");
delete M.status["api.coingecko.com"];
phase = "offline"; for (const h of ["api.coingecko.com", "api.coinpaprika.com", "data-api.binance.vision", "api.frankfurter.dev", "api.coinbase.com"]) M.fail.add(h);
await refresh(page); await page.waitForTimeout(500);
check((await text(page, "main .src")).includes("last known"), "all price APIs down → 'last known' with source + time", await text(page, "main .src"));
await shot(page, "15-markets-last-known");
await ctx.close();

// ---------------------------------------------------------------- cold offline (nothing cached) → example values
phase = "offline";
for (const h of ["mempool.space", "blockchain.info", "api.alternative.me", "blockstream.info"]) M.fail.add(h);
const off = await newCtx();
await go(off.page, "home"); await off.page.waitForTimeout(1500);
check((await text(off.page, "main")).includes("Offline"), "cold offline: home shows offline state");
await go(off.page, "mining"); await off.page.waitForTimeout(1500);
check((await text(off.page, "main")).includes("Offline: example values"), "cold offline: mining uses labelled example values");
await shot(off.page, "16-mining-offline");
await go(off.page, "markets"); await off.page.waitForTimeout(1000);
check((await text(off.page, "main")).includes("no example prices are invented"), "cold offline: markets shows no invented prices");
await off.ctx.close();

check(errors.length === 0, "no console errors / page errors", errors.join("\n"));
check(unknownHosts.size === 0, "no requests to unexpected hosts", [...unknownHosts].join(", "));
console.log(`\n${passes}/${passes + fails} e2e checks passed`);
await browser.close(); srv.close();
process.exit(fails ? 1 : 0);
