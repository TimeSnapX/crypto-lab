import { h, card, money, num, pct, cls, badge, field, input, select, val, stat, lineChart, meter, date, compact, sparkline } from "../ui.js";
import { load, save } from "../store.js";
import { COINS, dailyUSD, fxSeries, networkStats, btcHistory, fearGreed, btcPrice, dayKey } from "../api.js";
import { dcaVsLump, tradeCost, cgt, cgtDiscountEligible, incomeTax, TAX_TABLES, tokenRisk, profitLoss, nextHalvingHeight, blockSubsidy, compound, MAX_SUPPLY_BTC } from "../calc.js";

const SECTIONS = [
  ["dca", "DCA vs lump sum"], ["tax", "Tax (CGT)"], ["fees", "Fees & slippage"], ["scam", "Scam check"], ["pnl", "Profit/loss"],
  ["halving", "Halving"], ["fng", "Fear & Greed"], ["sats", "Sats & rich list"], ["compound", "Compound"], ["more", "More tools"],
];

export async function render(root, ctx) {
  const want = (location.hash.split("?")[1] || load("toolsTab", "dca"));
  let tab = SECTIONS.some(([k]) => k === want) ? want : "dca";
  const chips = h("div", { class: "chips", role: "tablist" });
  const body = h("div");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Tools")), chips, body);
  const show = (k) => {
    tab = k; save("toolsTab", k);
    chips.replaceChildren(...SECTIONS.map(([id, label]) => h("button", { role: "tab", "aria-pressed": String(id === k), "data-tool": id, onclick: () => show(id) }, label)));
    body.replaceChildren();
    TOOLS[k](body, ctx);
  };
  show(tab);
}

const TOOLS = {
  // ------------------------------------------------------------ DCA
  dca(body) {
    const s = load("dca", { coin: "bitcoin", total: 12000, every: "7", start: dayKey(Date.now() - 3 * 365 * 86400_000) });
    const coin = select({ value: s.coin, "aria-label": "Coin" }, COINS.filter((c) => c.bn).map((c) => ({ value: c.id, label: c.sym })));
    const total = input({ value: s.total }), every = select({ value: s.every }, [{ value: "1", label: "Daily" }, { value: "7", label: "Weekly" }, { value: "14", label: "Fortnightly" }, { value: "30", label: "Monthly (30 d)" }]);
    const start = h("input", { type: "date", value: s.start, min: "2017-09-01", max: dayKey(Date.now() - 30 * 86400_000), "aria-label": "Start date" });
    const out = h("div");
    const run = async () => {
      save("dca", { coin: coin.value, total: val(total), every: every.value, start: start.value });
      out.replaceChildren(h("p", { class: "muted" }, "Loading price history…"));
      const from = Date.parse(start.value + "T00:00:00Z"), to = Date.now();
      const [px, fx] = await Promise.all([dailyUSD(coin.value, from, to), fxSeries(start.value, dayKey(to))]);
      if (!px.data?.length) return out.replaceChildren(badge(px, { exampleLabel: "History unavailable (offline?)" }));
      let series = px.data, unit = "USD";
      if (fx.data) {
        const days = Object.keys(fx.data).sort(); let j = 0, rate = fx.data[days[0]].AUD;
        series = px.data.map((p) => { const d = dayKey(p.t); while (j < days.length && days[j] <= d) rate = fx.data[days[j++]].AUD; return { t: p.t, price: p.price * rate }; });
        unit = "AUD";
      }
      const r = dcaVsLump(series, { total: val(total), every: +every.value });
      // value-over-time curves
      const step = +every.value, each = r.each; let units = 0, spent = 0; const dcaPts = [], lumpPts = [], spentPts = [];
      series.forEach((p, i) => { if (i % step === 0) { units += each / p.price; spent += each; } dcaPts.push([p.t, units * p.price]); lumpPts.push([p.t, r.lumpUnits * p.price]); spentPts.push([p.t, spent]); });
      out.replaceChildren(badge({ ...px, source: `${px.source}${fx.data ? " × " + fx.source : ""}` }),
        h("div", { class: "stats" }, h("div", { class: `stat ${cls(r.dcaPct)}`, "data-k": "dca" }, h("span", {}, `DCA (${r.buys} buys)`), h("b", {}, money(r.dcaValue, unit)), h("small", {}, `${pct(r.dcaPct, 1)} · avg ${money(r.dcaAvgPrice, unit)}`)),
          h("div", { class: `stat ${cls(r.lumpPct)}`, "data-k": "lump" }, h("span", {}, "Lump sum"), h("b", {}, money(r.lumpValue, unit)), h("small", {}, `${pct(r.lumpPct, 1)} · bought at ${money(series[0].price, unit)}`))),
        h("p", {}, r.lumpValue > r.dcaValue ? `Lump sum won by ${money(r.lumpValue - r.dcaValue, unit)} this time.` : `DCA won by ${money(r.dcaValue - r.lumpValue, unit)} this time.`, " Results depend entirely on the period you pick."),
        lineChart([{ name: "DCA value", color: "var(--amber)", pts: dcaPts }, { name: "Lump sum value", color: "#7aa2ff", pts: lumpPts }, { name: "Money in (DCA)", color: "#a6a3b3", pts: spentPts, dash: "4 3" }], { xfmt: (t) => date(t) }),
        fx.data ? null : h("p", { class: "note" }, "AUD conversion unavailable; shown in USD (USDT pairs)."));
    };
    body.append(card("DCA vs lump sum (real history)", h("div", { class: "grid2" }, field("Coin", coin), field("Total to invest (AUD)", total), field("Buy every", every), field("Start date", start)),
      h("button", { class: "primary", style: "width:100%;margin-top:8px", onclick: run }, "Run with real prices"), out,
      h("p", { class: "muted" }, "Daily closes from Binance public data (USDT pairs, from Aug 2017), converted with ECB USD/AUD rates. Ignores fees.")));
    run();
  },

  // ------------------------------------------------------------ Tax
  tax(body) {
    const s = load("tax", { cost: 10000, costFees: 50, proceeds: 25000, saleFees: 50, buyDate: "2023-07-01", sellDate: "2024-07-02", priorLosses: 0, income: 85000, fy: "2026-27" });
    const f = { cost: input({ value: s.cost }), costFees: input({ value: s.costFees }), proceeds: input({ value: s.proceeds }), saleFees: input({ value: s.saleFees }), priorLosses: input({ value: s.priorLosses }), income: input({ value: s.income }),
      buyDate: h("input", { type: "date", value: s.buyDate, "aria-label": "Acquired" }), sellDate: h("input", { type: "date", value: s.sellDate, "aria-label": "Disposed" }), fy: select({ value: s.fy }, Object.keys(TAX_TABLES)) };
    const out = h("div");
    const calc = () => {
      const v = Object.fromEntries(Object.entries(f).map(([k, e]) => [k, e.type === "date" || e.tagName === "SELECT" ? e.value : val(e)])); save("tax", v);
      if (!v.buyDate || !v.sellDate) return;
      const r = cgt(v);
      const table = TAX_TABLES[v.fy];
      const extra = incomeTax(v.income + r.net, table) - incomeTax(v.income, table);
      const medicare = r.net * 0.02;
      out.replaceChildren(h("div", { class: "stats" },
        h("div", { class: `stat ${cls(r.gross)}`, "data-k": "gross" }, h("span", {}, "Capital gain"), h("b", {}, money(r.gross)), h("small", {}, `cost base ${money(r.costBase)}`)),
        h("div", { class: "stat", "data-k": "discount" }, h("span", {}, "50% discount"), h("b", {}, r.eligible && r.gross > 0 ? `− ${money(r.discount)}` : "No"), h("small", {}, cgtDiscountEligible(v.buyDate, v.sellDate) ? "held ≥ 12 months" : "held < 12 months")),
        h("div", { class: "stat", "data-k": "net" }, h("span", {}, "Net capital gain"), h("b", {}, money(r.net)), h("small", {}, r.lossCarried ? `loss carried fwd ${money(r.lossCarried)}` : "")),
        h("div", { class: "stat down", "data-k": "taxest" }, h("span", {}, "Est. extra tax"), h("b", {}, money(extra + medicare)), h("small", {}, `incl. 2% Medicare ≈ ${money(medicare)}`))),
        h("p", { class: "muted" }, `Order: capital losses are applied first, then the 50% discount (individuals and trusts only, asset held at least 12 months, not counting the buy and sell days). Resident rates ${v.fy}, excluding offsets and the Medicare levy surcharge.`));
    };
    Object.values(f).forEach((e) => e.addEventListener("input", calc));
    body.append(card("Australian crypto tax (CGT) estimate",
      h("p", { class: "note bad" }, "General information only, not tax advice. Rules change and your situation matters: see a registered tax agent and check ato.gov.au."),
      h("div", { class: "grid2" }, field("Cost (AUD)", f.cost), field("Buy fees", f.costFees), field("Sale proceeds (AUD)", f.proceeds), field("Sale fees", f.saleFees), field("Acquired", f.buyDate), field("Disposed", f.sellDate), field("Prior capital losses", f.priorLosses), field("Other taxable income", f.income), field("Financial year", f.fy)), out),
      card("ATO basics (summary)", h("ul", {},
        h("li", {}, "Crypto is generally a CGT asset. Selling for AUD, swapping one coin for another, paying for things and gifting are usually CGT events."),
        h("li", {}, "12-month discount: individuals who hold an asset at least 12 months generally only pay tax on 50% of the net gain."),
        h("li", {}, "Personal use asset caveat: crypto bought and used within a short time to pay for personal items may be exempt if it cost under A$10,000, but the ATO says this rarely applies; crypto held as an investment, or for a while before spending, isn't a personal use asset."),
        h("li", {}, "Staking rewards and many airdrops are ordinary income when received (their AUD value), and that value becomes their cost base."),
        h("li", {}, "Losses can offset capital gains (not salary) and carry forward. Lost or stolen crypto may be claimable as a loss only with evidence."),
        h("li", {}, "Keep records: dates, AUD values, what the transaction was for, exchange records and wallet addresses."),
        h("li", {}, h("a", { href: "https://www.ato.gov.au/individuals-and-families/investments-and-assets/crypto-asset-investments", target: "_blank", rel: "noopener noreferrer" }, "ATO: crypto asset investments ↗")))));
    calc();
  },

  // ------------------------------------------------------------ Fees
  fees(body, ctx) {
    const f = { amount: input({ value: 1000 }), feePct: input({ value: 0.5 }), spreadPct: input({ value: 1 }), slippagePct: input({ value: 0.1 }), flatFee: input({ value: 0 }), price: input({ value: Math.round(ctx.price("bitcoin", "AUD") || 0) || "", placeholder: "BTC price (optional)" }) };
    const out = h("div");
    const calc = () => {
      const r = tradeCost(Object.fromEntries(Object.entries(f).map(([k, e]) => [k, val(e)])));
      out.replaceChildren(h("div", { class: "stats" }, stat("Trading fee", money(r.fee)), stat("Spread (half)", money(r.spread)), stat("Slippage", money(r.slip)),
        h("div", { class: "stat down", "data-k": "feetotal" }, h("span", {}, "Total cost"), h("b", {}, money(r.total)), h("small", {}, pct(r.pct, 2, false))),
        stat("You receive", money(r.received)), stat("Effective price", r.effectivePrice ? money(r.effectivePrice) : "—"), stat("Round trip (buy+sell)", pct(r.pct * 2, 2, false))),
        h("p", { class: "muted" }, "Spread: you pay about half of the bid/ask gap each way. 'Instant buy' buttons often hide a 1–2% spread on top of the fee. Slippage grows with order size versus order-book depth."));
    };
    Object.values(f).forEach((e) => e.addEventListener("input", calc));
    body.append(card("Fees & slippage", h("div", { class: "grid2" }, field("Amount (AUD)", f.amount), field("Exchange fee %", f.feePct), field("Bid/ask spread %", f.spreadPct), field("Slippage %", f.slippagePct), field("Network/withdrawal fee (AUD)", f.flatFee), field("Coin price (AUD)", f.price)), out));
    calc();
  },

  // ------------------------------------------------------------ Scam
  scam(body) {
    const FLAGS = ["Guaranteed or very high fixed returns", "Pressure to act now / limited time", "Contacted out of the blue (DM, dating app, WhatsApp group)", "Asked for your seed phrase or private key", "Asked to send crypto first to 'unlock' or 'verify' funds", "Celebrity or giveaway promotion ('send 1, get 2')",
      "Withdrawals blocked unless you pay a 'tax' or 'fee'", "Unregistered platform / not on AUSTRAC's register", "Anonymous team, no audit, copied whitepaper", "Asked to install remote-access or a new 'trading app' from a link"];
    const checks = FLAGS.map((t) => h("input", { type: "checkbox", "aria-label": t }));
    const sOut = h("div");
    const sc = () => { const n = checks.filter((c) => c.checked).length; sOut.replaceChildren(meter(Math.min(100, n * 25), { label: n === 0 ? "No flags ticked" : n === 1 ? "1 red flag: be very careful" : `${n} red flags: treat as a scam`, left: "OK", right: "Scam" })); };
    checks.forEach((c) => c.addEventListener("change", sc));
    const t = { liquidityLocked: h("input", { type: "checkbox" }), verified: h("input", { type: "checkbox" }), canMint: h("input", { type: "checkbox" }), anonTeam: h("input", { type: "checkbox", checked: true }), audit: h("input", { type: "checkbox" }), sellTax: input({ value: 0 }), top10: input({ value: 40 }), ageDays: input({ value: 10 }), liquidityUSD: input({ value: 20000 }) };
    const tOut = h("div");
    const tc = () => {
      const r = tokenRisk(Object.fromEntries(Object.entries(t).map(([k, e]) => [k, e.type === "checkbox" ? e.checked : val(e)])));
      tOut.replaceChildren(h("div", { class: "stats" }, h("div", { class: `stat ${r.score >= 35 ? "down" : ""}`, "data-k": "tokenrisk" }, h("span", {}, "Risk score"), h("b", {}, `${r.score}/100`), h("small", {}, r.level))), meter(r.score, { label: r.level, left: "Lower", right: "Very high" }),
        r.why.length ? h("ul", { class: "warnlist" }, r.why.map((w) => h("li", {}, w))) : h("p", { class: "ok" }, "No flags from these inputs (that doesn't make it safe)."));
    };
    Object.values(t).forEach((e) => e.addEventListener(e.type === "checkbox" ? "change" : "input", tc));
    const cb = (label, el) => h("label", { class: "row", style: "flex-wrap:nowrap" }, el, h("span", {}, label));
    body.append(card("Scam & rug-pull checklist", h("p", { class: "muted" }, "Tick anything that applies."), ...FLAGS.map((f, i) => cb(f, checks[i])), sOut,
      h("p", { class: "muted" }, "If you've been targeted: stop sending money, report to ", h("a", { href: "https://www.scamwatch.gov.au/report-a-scam", target: "_blank", rel: "noopener noreferrer" }, "Scamwatch ↗"), " and ReportCyber, and contact your bank or exchange.")),
      card("Token risk scorer", h("p", { class: "muted" }, "Fill in what you can find on a block explorer or token-scanner site. A rough guide, not a guarantee."),
        cb("Liquidity is locked", t.liquidityLocked), cb("Contract source verified", t.verified), cb("Owner can mint new tokens", t.canMint), cb("Team is anonymous", t.anonTeam), cb("Audited by a known firm", t.audit),
        h("div", { class: "grid2" }, field("Sell tax %", t.sellTax), field("Top-10 holders %", t.top10), field("Token age (days)", t.ageDays), field("Liquidity (USD)", t.liquidityUSD)), tOut));
    sc(); tc();
  },

  // ------------------------------------------------------------ P&L
  pnl(body) {
    const f = { qty: input({ value: 0.5 }), buy: input({ value: 60000 }), sell: input({ value: 90000 }), feePct: input({ value: 0.5 }) };
    const out = h("div");
    const calc = () => { const r = profitLoss(Object.fromEntries(Object.entries(f).map(([k, e]) => [k, val(e)]))); out.replaceChildren(h("div", { class: "stats" }, stat("Cost incl. fee", money(r.cost)), stat("Proceeds after fee", money(r.proceeds)), h("div", { class: `stat ${cls(r.pnl)}`, "data-k": "pnl" }, h("span", {}, "Profit / loss"), h("b", {}, money(r.pnl)), h("small", {}, pct(r.pct, 2))))); };
    Object.values(f).forEach((e) => e.addEventListener("input", calc));
    body.append(card("Profit / loss calculator", h("div", { class: "grid2" }, field("Quantity", f.qty), field("Buy price (AUD)", f.buy), field("Sell price (AUD)", f.sell), field("Fee % each side", f.feePct)), out,
      h("p", { class: "muted" }, "For leverage P&L use the Trade tab; for tax use Tax (CGT).")));
    calc();
  },

  // ------------------------------------------------------------ Halving
  async halving(body) {
    const c1 = card("Halving countdown"), c2 = card("Price cycles & halvings (log scale)");
    body.append(c1, c2);
    const HALVINGS = [["2012-11-28", "1st"], ["2016-07-09", "2nd"], ["2020-05-11", "3rd"], ["2024-04-20", "4th"]];
    const [n, hist] = await Promise.all([networkStats(), btcHistory()]);
    c1.append(badge(n, { exampleLabel: "Block height unavailable" }));
    if (n.data) {
      const next = nextHalvingHeight(n.data.height), left = next - n.data.height, eta = Date.now() + left * (n.data.avgBlockTimeS || 600) * 1000;
      const d = Math.max(0, (eta - Date.now()) / 86400_000);
      c1.append(h("div", { class: "stats" }, h("div", { class: "stat", "data-k": "blocksleft" }, h("span", {}, "Blocks to go"), h("b", {}, left.toLocaleString("en-AU"))), stat("Estimated", date(eta), `≈ ${num(d, 0)} days`),
        stat("Reward now", `${blockSubsidy(n.data.height)} BTC`), stat("Reward after", `${blockSubsidy(next)} BTC`)),
        h("div", { class: "progress" }, h("i", { style: `width:${(((n.data.height % 210000) / 210000) * 100).toFixed(1)}%` })),
        h("p", { class: "muted" }, `Epoch progress ${pct(((n.data.height % 210000) / 210000) * 100, 1, false)}. Estimate uses the recent average block time (${num(n.data.avgBlockTimeS || 600, 0)} s).`));
    }
    c2.append(badge(hist, { exampleLabel: "Price history unavailable" }));
    if (hist.data) c2.append(lineChart([{ name: "BTC/USD (weekly)", color: "var(--amber)", pts: hist.data.map((p) => [p.t, p.price]) }], { log: true, legend: true, xfmt: (t) => new Date(t).getUTCFullYear(), yfmt: (v) => "$" + compact(v), marks: HALVINGS.map(([d, l]) => ({ x: Date.parse(d), label: l })), h: 230 }),
      h("p", { class: "muted" }, "Dashed lines mark the halvings. Past cycles saw big rallies 12–18 months after halvings, followed by deep drawdowns. Past patterns are not a forecast."));
  },

  // ------------------------------------------------------------ F&G
  async fng(body) {
    const c = card("Crypto Fear & Greed index"); body.append(c);
    const r = await fearGreed();
    c.append(badge(r, { exampleLabel: "Fear & Greed unavailable (alternative.me unreachable)" }));
    if (!r.data) return;
    const now = r.data[0];
    c.append(h("p", { class: "big", "data-k": "fng" }, `${now.value} · ${now.value_classification}`), meter(+now.value, { label: now.value_classification, left: "Extreme fear", right: "Extreme greed" }),
      lineChart([{ name: "Index (30 days)", color: "var(--amber)", pts: r.data.map((d) => [d.timestamp * 1000, +d.value]).reverse() }], { xfmt: (t) => date(t), legend: true, hlines: [{ y: 50, label: "neutral", color: "#a6a3b3" }] }),
      h("p", { class: "muted" }, "Data: alternative.me (combines volatility, volume, social media, dominance and trends). Some investors treat extreme fear as a time to buy and extreme greed as a time to be careful; it is not a signal on its own."));
  },

  // ------------------------------------------------------------ Sats
  async sats(body, ctx) {
    const c = card("How much is 1 satoshi?"); const c2 = card("Your share of Bitcoin"); body.append(c, c2);
    const r = await btcPrice();
    const aud = r.data?.aud, usd = r.data?.usd;
    c.append(badge(r, { exampleLabel: "Live BTC price unavailable" }));
    if (aud) c.append(h("div", { class: "stats" }, h("div", { class: "stat", "data-k": "sat" }, h("span", {}, "1 sat"), h("b", {}, money(aud / 1e8, "AUD", 6)), h("small", {}, money(usd / 1e8, "USD", 6))), stat("A$1 buys", `${num(1e8 / aud, 0)} sats`), stat("A$100 buys", `${num(1e10 / aud, 0)} sats`), stat("1 BTC", money(aud))));
    const amt = input({ value: load("myBtc", 0.1), "aria-label": "Your BTC" });
    const pop = input({ value: 8.2, "aria-label": "World population (billions)" });
    const out = h("div");
    const calc = () => {
      save("myBtc", val(amt));
      const share = MAX_SUPPLY_BTC / (val(pop) * 1e9);
      out.replaceChildren(h("div", { class: "stats" }, stat("Of all 21M BTC", pct((val(amt) / MAX_SUPPLY_BTC) * 100, 8, false)), h("div", { class: "stat", "data-k": "equal" }, h("span", {}, "Equal share per person"), h("b", {}, `${num(share, 5)} BTC`), h("small", {}, `${num(share * 1e8, 0)} sats`)),
        stat("You hold", `${num(val(amt) / share, 1)}× an equal share`), stat("Worth", aud ? money(val(amt) * aud) : "—")),
        h("p", { class: "muted" }, "A real rich-list percentile needs the full address distribution, which no keyless API provides, so this compares you to an equal split of 21M BTC across everyone alive. Note one person can own many addresses and exchanges hold coins for millions of people."));
    };
    [amt, pop].forEach((e) => e.addEventListener("input", calc));
    c2.append(h("div", { class: "grid2" }, field("Your BTC", amt), field("World population (billions, editable)", pop, "~8.2 billion (UN estimate)")), out);
    calc();
  },

  // ------------------------------------------------------------ Compound
  compound(body) {
    const f = { p: input({ value: 1000 }), r: input({ value: 8 }), y: input({ value: 10 }), m: input({ value: 100 }) };
    const out = h("div");
    const calc = () => { const r = compound({ principal: val(f.p), apyPct: val(f.r), years: Math.min(60, val(f.y)), perYear: 12, contribution: val(f.m) });
      out.replaceChildren(h("div", { class: "stats" }, h("div", { class: "stat", "data-k": "cfinal" }, h("span", {}, "Final"), h("b", {}, money(r.final))), stat("Contributed", money(r.contributed)), stat("Growth", money(r.interest))), lineChart([{ name: "Balance", color: "var(--amber)", pts: r.series.map((p) => [p.t, p.bal]), area: true }], { xfmt: (t) => `${Math.round(t)}y`, zero: true })); };
    Object.values(f).forEach((e) => e.addEventListener("input", calc));
    body.append(card("Compound interest", h("div", { class: "grid2" }, field("Start (AUD)", f.p), field("Rate % per year", f.r), field("Years", f.y), field("Monthly add (AUD)", f.m)), out, h("p", { class: "muted" }, "Monthly compounding at an effective annual rate. More options on the Passive income page.")));
    calc();
  },

  more(body) {
    body.append(card("More tools elsewhere", h("ul", { class: "list" },
      h("li", {}, h("a", { href: "#trade" }, "Position-size calculator & liquidation heat table → Trade")),
      h("li", {}, h("a", { href: "#passive" }, "Impermanent loss calculator & income stack → Passive income")),
      h("li", {}, h("a", { href: "#markets" }, "BTC/sats/AUD/USD converter, watchlist & price alerts → Markets")),
      h("li", {}, h("a", { href: "#portfolio" }, "Portfolio rebalancer → Paper portfolio")),
      h("li", {}, h("a", { href: "#whatif" }, "What if I didn't sell")),
      h("li", {}, h("a", { href: "#address" }, "Bitcoin address checker")))));
  },
};
