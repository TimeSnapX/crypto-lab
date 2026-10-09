import { h, card, money, num, pct, field, input, select, val, donut, lineChart, stat, compact, download, esc, PALETTE, meter, toast } from "../ui.js";
import { load, save } from "../store.js";
import { vestingSchedule, supplyAt, marketCaps, tokenomicsHealth } from "../calc.js";

export const BUCKETS = [
  { key: "team", label: "Team" }, { key: "investors", label: "Investors" }, { key: "community", label: "Community" },
  { key: "treasury", label: "Treasury" }, { key: "liquidity", label: "Liquidity" },
];
export const DEFAULT_PROJECT = {
  name: "Lab Token", ticker: "LAB", supply: 1_000_000_000, model: "fixed", inflationPct: 5, burnPct: 2, price: 0.05, demandGrowth: 3,
  buckets: [
    { key: "team", pct: 15, tgePct: 0, cliff: 12, vest: 36 },
    { key: "investors", pct: 15, tgePct: 0, cliff: 6, vest: 24 },
    { key: "community", pct: 40, tgePct: 10, cliff: 0, vest: 48 },
    { key: "treasury", pct: 20, tgePct: 5, cliff: 0, vest: 48 },
    { key: "liquidity", pct: 10, tgePct: 100, cliff: 0, vest: 0 },
  ],
};

export async function render(root) {
  let P = load("project", DEFAULT_PROJECT);
  const form = card("Design your token");
  const res = card("Tokenomics");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Token project designer"), h("p", {}, "Design a token's supply, allocation and vesting, then see how it behaves.")),
    h("p", { class: "note" }, "Sandbox only: this does not deploy a real token or touch any blockchain."), form, res);

  function paintForm() {
    const name = h("input", { value: P.name, "aria-label": "Project name" }), ticker = h("input", { value: P.ticker, maxlength: 8, "aria-label": "Ticker" });
    const supply = input({ value: P.supply, "aria-label": "Total supply" }), price = input({ value: P.price, "aria-label": "Token price USD" });
    const model = select({ value: P.model, "aria-label": "Supply model" }, [{ value: "fixed", label: "Fixed supply" }, { value: "inflationary", label: "Inflationary" }, { value: "deflationary", label: "Deflationary (burn)" }]);
    const infl = input({ value: P.inflationPct }), burn = input({ value: P.burnPct }), demand = input({ value: P.demandGrowth });
    const rows = P.buckets.map((b) => {
      const f = { pct: input({ value: b.pct, "aria-label": `${b.key} %` }), tgePct: input({ value: b.tgePct, "aria-label": `${b.key} TGE %` }), cliff: input({ value: b.cliff, "aria-label": `${b.key} cliff` }), vest: input({ value: b.vest, "aria-label": `${b.key} vesting` }) };
      Object.entries(f).forEach(([k, e]) => e.addEventListener("input", () => { b[k] = val(e); update(); }));
      return h("tr", {}, h("td", {}, BUCKETS.find((x) => x.key === b.key).label), h("td", {}, f.pct), h("td", {}, f.tgePct), h("td", {}, f.cliff), h("td", {}, f.vest));
    });
    const bind = (e, k, numeric = true) => e.addEventListener("input", () => { P[k] = numeric ? val(e) : e.value; update(); });
    bind(name, "name", false); bind(ticker, "ticker", false); bind(supply, "supply"); bind(price, "price"); bind(infl, "inflationPct"); bind(burn, "burnPct"); bind(demand, "demandGrowth");
    model.addEventListener("change", () => { P.model = model.value; update(); paintForm(); });
    form.replaceChildren(h("h2", {}, "Design your token"),
      h("div", { class: "grid2" }, field("Name", name), field("Ticker", ticker), field("Total supply", supply), field("Launch price (USD)", price), field("Supply model", model),
        P.model === "inflationary" ? field("Inflation %/yr", infl) : P.model === "deflationary" ? field("Burn %/yr", burn) : h("span"), field("Demand growth %/month (scenario)", demand)),
      h("h3", {}, "Allocation & vesting"), h("p", { class: "muted" }, "TGE % = unlocked at launch; cliff = months before vesting starts; vesting = months of linear unlock after the cliff (0 = all at cliff)."),
      h("div", { class: "tablewrap" }, h("table", { class: "alloc" }, h("thead", {}, h("tr", {}, h("th", {}, "Bucket"), h("th", {}, "%"), h("th", {}, "TGE %"), h("th", {}, "Cliff mo"), h("th", {}, "Vest mo"))), h("tbody", {}, rows))),
      h("div", { class: "row", style: "margin-top:8px" }, h("button", { onclick: () => { P = structuredClone(DEFAULT_PROJECT); save("project", P); paintForm(); update(); } }, "Reset example"),
        h("button", { onclick: () => { P.buckets = P.buckets.map((b) => ({ ...b, pct: b.key === "team" ? 40 : b.key === "community" ? 10 : b.pct, tgePct: b.key === "team" ? 100 : b.tgePct, vest: b.key === "team" ? 0 : b.vest })); paintForm(); update(); } }, "Load a bad example")));
  }

  function update() {
    save("project", P);
    const sched = vestingSchedule(P.supply, P.buckets, 48);
    const health = tokenomicsHealth({ buckets: P.buckets, model: P.model, inflationPct: P.inflationPct, supply: P.supply });
    const tge = sched[0].circ;
    const caps = marketCaps(P.price, tge, P.supply);
    const colors = Object.fromEntries(BUCKETS.map((b, i) => [b.key, PALETTE[i]]));
    // price scenarios: market cap flat vs demand growth, as circulating supply unlocks (and inflates/burns)
    const flat = [], grow = [], circPts = [], unlockSeries = BUCKETS.map((b) => ({ name: b.label, color: colors[b.key], pts: [] }));
    for (const r of sched) {
      const factor = supplyAt(r.m / 12, { supply: 1, model: P.model, inflationPct: P.inflationPct, burnPct: P.burnPct });
      const circ = r.circ * factor;
      circPts.push([r.m, circ]);
      flat.push([r.m, caps.marketCap / circ]);
      grow.push([r.m, (caps.marketCap * Math.pow(1 + P.demandGrowth / 100, r.m)) / circ]);
      BUCKETS.forEach((b, i) => unlockSeries[i].pts.push([r.m, r.by[b.key] || 0]));
    }
    const emission = []; for (let y = 0; y <= 10; y++) emission.push([y, supplyAt(y, P)]);
    const t = P.ticker || "TOKEN";
    res.replaceChildren(h("h2", {}, `${P.name || "Untitled"} (${t})`),
      h("div", { class: "stats" },
        h("div", { class: "stat", "data-k": "health" }, h("span", {}, "Health score"), h("b", {}, `${health.score}/100`), h("small", {}, health.grade)),
        h("div", { class: "stat", "data-k": "sum" }, h("span", {}, "Allocations"), h("b", { class: Math.abs(health.sum - 100) > 0.01 ? "down" : "" }, pct(health.sum, 1, false))),
        h("div", { class: "stat", "data-k": "mcap" }, h("span", {}, "Market cap at launch"), h("b", {}, money(caps.marketCap, "USD")), h("small", {}, `${compact(tge)} ${t} circulating (${pct(caps.floatPct, 1, false)})`)),
        h("div", { class: "stat", "data-k": "fdv" }, h("span", {}, "FDV"), h("b", {}, money(caps.fdv, "USD")), h("small", {}, `FDV / MC = ${num(caps.fdv / (caps.marketCap || 1), 1)}×`))),
      meter(health.score, { label: health.grade, left: "Red flags", right: "Healthy", invert: true }),
      health.warnings.length ? h("ul", { class: "warnlist" }, health.warnings.map((w) => h("li", {}, "⚠ " + w))) : h("p", { class: "ok" }, "✓ No major warnings."),
      h("h3", {}, "Allocation"), donut(P.buckets.map((b) => ({ label: BUCKETS.find((x) => x.key === b.key).label, value: b.pct, color: colors[b.key] }))),
      h("h3", {}, "Vesting unlocks (tokens unlocked by month)"), lineChart(unlockSeries, { xfmt: (m) => `m${Math.round(m)}`, h: 200 }),
      h("h3", {}, "Price if market cap stays flat vs demand grows"), lineChart([{ name: "Flat market cap", color: "#ff6b6b", pts: flat }, { name: `Demand +${P.demandGrowth}%/mo`, color: "#4fe08a", pts: grow }], { xfmt: (m) => `m${Math.round(m)}`, yfmt: (v) => "$" + (v < 1 ? v.toFixed(4) : compact(v)) }),
      h("p", { class: "muted" }, "As locked tokens unlock, circulating supply grows. If buyers don't grow at least as fast, price falls: that's 'unlock pressure'."),
      h("h3", {}, `Emission curve: total supply over 10 years (${P.model})`), lineChart([{ name: "Total supply", color: "var(--amber)", pts: emission, area: true }], { xfmt: (y) => `${Math.round(y)}y`, legend: true }),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => exportSummary(P, health, caps, sched) }, "Export one-page summary"), h("button", { onclick: () => download(`${t}-tokenomics.json`, JSON.stringify(P, null, 2)) }, "Export JSON")));
  }
  paintForm(); update();
}

function exportSummary(P, health, caps, sched) {
  const at = (m) => sched[Math.min(m, sched.length - 1)].circ;
  const rows = P.buckets.map((b) => `<tr><td>${esc(BUCKETS.find((x) => x.key === b.key).label)}</td><td>${b.pct}%</td><td>${b.tgePct}%</td><td>${b.cliff}</td><td>${b.vest}</td></tr>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(P.name)} tokenomics</title>
<style>body{font:14px system-ui;max-width:720px;margin:24px auto;padding:0 16px;color:#111}h1{margin:0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:right}td:first-child,th:first-child{text-align:left}.warn{color:#a40}small{color:#666}</style>
<h1>${esc(P.name)} (${esc(P.ticker)})</h1><p><small>Sandbox design from Crypto Lab, ${new Date().toLocaleString("en-AU")}. Not a real token. Educational only, not financial advice.</small></p>
<p><b>Total supply:</b> ${Number(P.supply).toLocaleString("en-AU")} · <b>Model:</b> ${esc(P.model)}${P.model === "inflationary" ? ` (${P.inflationPct}%/yr)` : P.model === "deflationary" ? ` (burn ${P.burnPct}%/yr)` : ""} · <b>Launch price:</b> US$${P.price}</p>
<p><b>Market cap at launch:</b> US$${Math.round(caps.marketCap).toLocaleString("en-AU")} · <b>FDV:</b> US$${Math.round(caps.fdv).toLocaleString("en-AU")} · <b>Float at launch:</b> ${caps.floatPct.toFixed(1)}%</p>
<p><b>Circulating:</b> month 0 ${Math.round(at(0)).toLocaleString("en-AU")} · month 12 ${Math.round(at(12)).toLocaleString("en-AU")} · month 24 ${Math.round(at(24)).toLocaleString("en-AU")} · month 48 ${Math.round(at(48)).toLocaleString("en-AU")}</p>
<table><tr><th>Bucket</th><th>%</th><th>TGE</th><th>Cliff (mo)</th><th>Vest (mo)</th></tr>${rows}</table>
<h2>Health score: ${health.score}/100 (${esc(health.grade)})</h2><ul>${health.warnings.map((w) => `<li class="warn">${esc(w)}</li>`).join("") || "<li>No major warnings</li>"}</ul>`;
  download(`${(P.ticker || "token").replace(/[^\w-]/g, "")}-summary.html`, html, "text/html");
  toast("Summary downloaded (open it and print to PDF if you like)");
}
