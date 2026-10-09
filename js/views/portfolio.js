import { h, card, money, pct, cls, badge, donut, field, input, select, val, num, toast, download, PALETTE, lineChart, date } from "../ui.js";
import { load, save } from "../store.js";
import { rebalance } from "../calc.js";

const START = 100000;
const fresh = () => ({ cash: START, holdings: {}, history: [], created: Date.now() });

export async function render(root, ctx) {
  let pf = load("portfolio", fresh());
  const trade = card("Buy / sell (paper AUD)");
  const summary = card("Portfolio");
  const hist = card("History");
  const reb = card("Rebalancer");
  const io = card("Export / import");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Paper portfolio"), h("p", {}, `Start with A$${START.toLocaleString("en-AU")} of paper money and trade at real prices. Saved on this device.`)), summary, trade, reb, hist, io);

  const persist = () => { save("portfolio", pf); paint(ctx.market); };
  function priceOf(id) { const r = ctx.market?.data?.find((x) => x.id === id); return r?.aud ?? null; }

  function paintTrade(m) {
    const coins = (m?.data || []).filter((r) => r.aud);
    const prevCoin = trade.querySelector("select")?.value, prevAmt = trade.querySelector("input")?.value;
    const coin = select({ "aria-label": "Coin", value: prevCoin }, coins.map((r) => ({ value: r.id, label: `${r.sym} · ${money(r.aud)}` })));
    const amt = input({ placeholder: "Amount in AUD", value: prevAmt ?? 1000, "aria-label": "Amount AUD" });
    const live = !!m?.live;
    const go = (side) => {
      if (!live) return toast("Paper trades need a live price. Try again when online.", "warn");
      const id = coin.value, p = priceOf(id), a = val(amt);
      if (!(a > 0) || !p) return toast("Enter an amount", "warn");
      const sym = coins.find((r) => r.id === id).sym;
      const hd = pf.holdings[id] || { qty: 0, cost: 0, sym };
      if (side === "buy") {
        if (a > pf.cash + 1e-9) return toast("Not enough paper cash", "bad");
        const q = a / p; hd.qty += q; hd.cost += a; pf.cash -= a; pf.holdings[id] = hd;
        pf.history.unshift({ t: Date.now(), side, id, sym, qty: q, price: p, aud: a, source: m.source });
      } else {
        const q = Math.min(hd.qty, a / p); if (!(q > 0)) return toast(`You hold no ${sym}`, "bad");
        const avg = hd.cost / hd.qty; const proceeds = q * p;
        hd.cost -= avg * q; hd.qty -= q; pf.cash += proceeds;
        if (hd.qty < 1e-12) delete pf.holdings[id]; else pf.holdings[id] = hd;
        pf.history.unshift({ t: Date.now(), side, id, sym, qty: q, price: p, aud: proceeds, realised: proceeds - avg * q, source: m.source });
      }
      toast(`${side === "buy" ? "Bought" : "Sold"} ${num(a / p, 6)} ${sym} (paper)`); persist();
    };
    trade.replaceChildren(h("h2", {}, "Buy / sell (paper AUD)"), badge(m, { exampleLabel: "Offline: trading disabled (needs a live price)" }),
      h("div", { class: "grid2" }, field("Coin", coin), field("Amount (AUD)", amt)),
      h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "long", disabled: !live, onclick: () => go("buy") }, "Buy"), h("button", { class: "short", disabled: !live, onclick: () => go("sell") }, "Sell"),
        h("button", { class: "small", onclick: () => { const id = coin.value; const hd = pf.holdings[id]; if (hd) amt.value = (hd.qty * priceOf(id)).toFixed(2); } }, "Max sell")),
      h("p", { class: "muted" }, `Paper cash: ${money(pf.cash)}. No fees are charged here; see Tools → Fees for real-world costs.`));
  }
  function paintSummary(m) {
    const rows = Object.entries(pf.holdings).map(([id, hd]) => { const p = priceOf(id); const value = p ? hd.qty * p : null; return { id, ...hd, p, value, pnl: value != null ? value - hd.cost : null }; });
    const invested = rows.reduce((s, r) => s + (r.value ?? r.cost), 0);
    const total = pf.cash + invested;
    const realised = pf.history.reduce((s, x) => s + (x.realised || 0), 0);
    summary.replaceChildren(h("h2", {}, "Portfolio"), badge(m, { exampleLabel: "Offline: values at cost (no live price)" }),
      h("div", { class: "stats" },
        h("div", { class: "stat", "data-k": "total" }, h("span", {}, "Total value"), h("b", {}, money(total))),
        h("div", { class: `stat ${cls(total - START)}`, "data-k": "pnl" }, h("span", {}, "Total P&L"), h("b", {}, money(total - START)), h("small", {}, pct(((total - START) / START) * 100))),
        h("div", { class: "stat" }, h("span", {}, "Cash"), h("b", {}, money(pf.cash))),
        h("div", { class: `stat ${cls(realised)}` }, h("span", {}, "Realised"), h("b", {}, money(realised)))),
      rows.length ? h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Coin"), h("th", {}, "Qty"), h("th", {}, "Avg"), h("th", {}, "Value"), h("th", {}, "P&L"))),
        h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, h("b", {}, r.sym)), h("td", {}, num(r.qty, 6)), h("td", {}, money(r.cost / r.qty)), h("td", {}, money(r.value)), h("td", { class: cls(r.pnl) }, money(r.pnl), h("br"), h("small", {}, pct((r.pnl / r.cost) * 100, 1)))))))) : h("p", { class: "muted" }, "No holdings yet. Buy something below."),
      h("h3", {}, "Allocation"), donut([{ label: "Cash", value: pf.cash, color: "#555a6e" }, ...rows.map((r, i) => ({ label: r.sym, value: r.value ?? r.cost, color: PALETTE[i % PALETTE.length] }))]));
    const pts = []; let cashFlow = 0;
    // invested-capital curve from history (cost basis over time)
    for (const x of [...pf.history].reverse()) { cashFlow += x.side === "buy" ? x.aud : -(x.aud - (x.realised || 0)); pts.push([x.t, cashFlow]); }
    if (pts.length > 1) summary.append(h("h3", {}, "Capital deployed over time"), lineChart([{ name: "Cost basis (AUD)", color: "var(--amber)", pts }], { xfmt: (t) => date(t), h: 150 }));
    return rows;
  }
  function paintHist() {
    const wins = pf.history.filter((x) => x.side === "sell");
    hist.replaceChildren(h("h2", {}, "History"), h("p", { class: "muted" }, `${pf.history.length} trades · ${wins.filter((x) => x.realised > 0).length}/${wins.length} profitable sells`),
      h("ul", { class: "list" }, pf.history.slice(0, 50).map((x) => h("li", {}, h("b", { class: x.side === "buy" ? "up" : "down" }, x.side.toUpperCase()), ` ${num(x.qty, 6)} ${x.sym} @ ${money(x.price)} = ${money(x.aud)}`, x.realised != null ? h("span", { class: cls(x.realised) }, ` (${money(x.realised)})`) : null, h("br"), h("small", {}, `${new Date(x.t).toLocaleString("en-AU")} · price from ${x.source}`)))));
  }
  function paintReb(rows) {
    const keys = [{ key: "cash", sym: "Cash", value: pf.cash }, ...rows.map((r) => ({ key: r.id, sym: r.sym, value: r.value ?? r.cost }))];
    const targets = load("rebTargets", {});
    const ins = keys.map((k) => input({ value: targets[k.key] ?? Math.round((k.value / keys.reduce((s, x) => s + x.value, 0)) * 100), "aria-label": `Target ${k.sym}` }));
    const out = h("div");
    const calc = () => {
      const t = {}; keys.forEach((k, i) => (t[k.key] = val(ins[i]))); save("rebTargets", t);
      const res = rebalance(keys, t);
      out.replaceChildren(h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Asset"), h("th", {}, "Now"), h("th", {}, "Target"), h("th", {}, "Trade"))),
        h("tbody", {}, res.map((r, i) => h("tr", {}, h("td", {}, keys[i].sym), h("td", {}, pct(r.nowPct, 1, false)), h("td", {}, pct(r.targetPct, 1, false)), h("td", { class: cls(r.trade) }, Math.abs(r.trade) < 1 ? "—" : `${r.trade > 0 ? "Buy" : "Sell"} ${money(Math.abs(r.trade))}`))))));
    };
    ins.forEach((i) => i.addEventListener("input", calc));
    reb.replaceChildren(h("h2", {}, "Rebalancer"), h("p", { class: "muted" }, "Set target weights (%). Shows the paper trades needed to get back to target. Weights are normalised if they don't add to 100."),
      h("div", { class: "grid3" }, keys.map((k, i) => field(k.sym, ins[i]))), out);
    calc();
  }
  function paintIO() {
    const file = h("input", { type: "file", accept: ".json,application/json" });
    file.addEventListener("change", async () => {
      try { const d = JSON.parse(await file.files[0].text()); if (d.app !== "crypto-lab-portfolio" || typeof d.portfolio?.cash !== "number") throw new Error("Not a Crypto Lab portfolio file"); pf = d.portfolio; persist(); toast("Portfolio imported"); }
      catch (e) { toast(e.message, "bad"); }
    });
    io.replaceChildren(h("h2", {}, "Export / import"),
      h("div", { class: "row" }, h("button", { onclick: () => download("crypto-lab-portfolio.json", JSON.stringify({ app: "crypto-lab-portfolio", version: 1, exportedAt: new Date().toISOString(), portfolio: pf }, null, 2)) }, "Export JSON"),
        h("button", { onclick: () => { if (confirm("Reset paper portfolio to A$100,000 cash?")) { pf = fresh(); persist(); } } }, "Reset")),
      field("Import JSON", file));
  }
  function paint(m) { paintTrade(m); const rows = paintSummary(m); paintHist(); paintReb(rows); paintIO(); }
  paint(ctx.market);
  const off = ctx.onMarket(paint);
  ctx.refreshMarkets().catch(() => {});
  return off;
}
