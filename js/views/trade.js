import { h, card, money, pct, cls, badge, field, input, select, val, num, toast, meter, candleChart, stat, time } from "../ui.js";
import { load, save } from "../store.js";
import { COINS, tickerUSD, candles } from "../api.js";
import { liquidationPrice, positionFromMargin, pnl, closeTrade, liqDistancePct, positionSize } from "../calc.js";

const fresh = () => ({ balance: 10000, positions: [], history: [] });
const DEFAULT_SET = { feePct: 0.05, fundingPct: 0.01, mmrPct: 0.5 };
const TRADABLE = COINS.filter((c) => c.bn || c.cb).filter((c) => !c.stable);

export async function render(root, ctx) {
  let acct = load("lev", fresh());
  let set = load("levSettings", DEFAULT_SET);
  let mode = "live", coinId = "bitcoin";
  let price = null, priceRes = null;
  let orderPreview = () => {};
  let replay = { cs: [], i: 0, playing: false, speed: 4, timer: null, start: "" };

  const priceCard = card("Price");
  const orderCard = card("Open a paper position");
  const posCard = card("Open positions");
  const histCard = card("Trade history");
  const learnCard = card("How liquidation works");
  const sizeCard = card("Position size (risk rule)");
  const heatCard = card("Liquidation heat table");
  const setCard = card("Settings");
  const modeSeg = h("div", { class: "seg", role: "group", "aria-label": "Mode" },
    h("button", { "aria-pressed": "true", "data-mode": "live", onclick: () => setMode("live") }, "Live prices"),
    h("button", { "aria-pressed": "false", "data-mode": "replay", onclick: () => setMode("replay") }, "Replay history"));
  const coinSel = select({ "aria-label": "Market" }, TRADABLE.map((c) => ({ value: c.id, label: `${c.sym}-PERP (USD)` })));
  coinSel.addEventListener("change", () => { coinId = coinSel.value; price = null; if (mode === "live") tick(); else loadReplay(); paintAll(); });

  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Leverage simulator"), h("p", {}, "Paper futures (USD-margined perpetual, isolated margin). Paper balance in USD. Nothing here is a real order.")),
    h("div", { class: "card" }, modeSeg, h("div", { style: "margin-top:8px" }, coinSel)), priceCard, orderCard, posCard, learnCard, sizeCard, heatCard, histCard, setCard);

  const persist = () => save("lev", acct);
  const mine = () => acct.positions.filter((p) => p.mode === mode);
  const nowT = () => (mode === "replay" ? replay.cs[replay.i]?.t + 3600_000 : Date.now());

  // ---------------------------------------------------------------- price feeds
  async function tick() {
    if (mode !== "live") return;
    priceRes = await tickerUSD(coinId);
    const first = !price;
    price = priceRes.live ? priceRes.data : null;
    if (price) checkPositions({ h: price, l: price, c: price });
    paintPrice(); paintPositions();
    if (first) { paintOrder(); paintHeat(); } else orderPreview();
  }
  const liveTimer = setInterval(() => { if (document.visibilityState === "visible") tick().catch(() => {}); }, 10_000);

  async function loadReplay() {
    stopReplay();
    const startInput = replay.start;
    let startMs = startInput ? Date.parse(startInput + "T00:00:00Z") : null;
    if (!startMs) { const min = Date.parse("2018-01-01"), max = Date.now() - 60 * 86400_000; startMs = Math.floor((min + Math.random() * (max - min)) / 3600_000) * 3600_000; }
    priceCard.querySelector(".replay-status")?.replaceChildren("Loading candles…");
    const r = await candles(coinId, "1h", { startMs, limit: 500 });
    priceRes = r;
    replay.cs = r.data || []; replay.i = Math.min(48, replay.cs.length - 1);
    price = replay.cs[replay.i]?.c ?? null;
    paintAll();
  }
  function stepReplay() {
    if (replay.i >= replay.cs.length - 1) { stopReplay(); toast("Replay finished"); return; }
    replay.i++;
    const c = replay.cs[replay.i]; price = c.c;
    checkPositions(c);
    paintPrice(); paintPositions(); orderPreview();
  }
  function stopReplay() { replay.playing = false; clearInterval(replay.timer); replay.timer = null; }
  function playReplay() { stopReplay(); replay.playing = true; replay.timer = setInterval(stepReplay, 1000 / replay.speed); paintPrice(); }

  function setMode(m) {
    mode = m; stopReplay();
    modeSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    price = null; priceRes = null;
    if (m === "live") tick(); else loadReplay();
    paintAll();
  }

  // ---------------------------------------------------------------- engine
  function openPos(side, margin, lev, sl, tp) {
    if (!price) return toast(mode === "live" ? "Waiting for a live price" : "Load replay candles first", "warn");
    const fee = margin * lev * (set.feePct / 100);
    if (margin <= 0) return toast("Enter margin", "warn");
    if (margin + fee > acct.balance + 1e-9) return toast("Not enough paper balance", "bad");
    const liq = liquidationPrice(side, price, lev, set.mmrPct);
    if (sl && ((side === "long" && sl >= price) || (side === "short" && sl <= price))) return toast("Stop-loss must be on the losing side of entry", "warn");
    if (tp && ((side === "long" && tp <= price) || (side === "short" && tp >= price))) return toast("Take-profit must be on the winning side of entry", "warn");
    const { notional, qty } = positionFromMargin(margin, lev, price);
    acct.balance -= margin + fee;
    acct.positions.push({ id: Date.now() + Math.random(), mode, coinId, sym: TRADABLE.find((c) => c.id === coinId).sym, side, margin, lev, entry: price, qty, notional, liq, sl: sl || null, tp: tp || null, openedAt: nowT(), openFee: fee });
    persist(); toast(`${side.toUpperCase()} ${lev}x opened at ${money(price, "USD")} (paper)`); paintAll();
  }
  function closePos(p, exit, reason) {
    const hours = (nowT() - p.openedAt) / 3600_000;
    const r = closeTrade({ side: p.side, margin: p.margin, leverage: p.lev, entry: p.entry, exit, feePct: set.feePct, fundingPct: set.fundingPct, hoursHeld: hours });
    let net = r.net;
    if (reason === "liquidated") { net = -p.margin - p.openFee; }
    else acct.balance += p.margin + r.gross - (r.fees - p.openFee) - r.funding;
    acct.positions = acct.positions.filter((x) => x !== p);
    acct.history.unshift({ ...p, exit, reason, closedAt: nowT(), net, gross: r.gross, fees: reason === "liquidated" ? p.openFee : r.fees, funding: reason === "liquidated" ? 0 : r.funding, roe: (net / p.margin) * 100 });
    persist();
  }
  /** Check liquidation / SL / TP against a candle (live ticks use h = l = c). Worst case first. */
  function checkPositions(c) {
    let changed = false;
    for (const p of mine().filter((x) => x.coinId === coinId)) {
      const hitLow = (lvl) => lvl && c.l <= lvl, hitHigh = (lvl) => lvl && c.h >= lvl;
      if (p.side === "long") {
        if (hitLow(p.liq)) { closePos(p, p.liq, "liquidated"); toast(`💥 ${p.sym} long liquidated at ${money(p.liq, "USD")}`, "bad"); changed = true; }
        else if (hitLow(p.sl)) { closePos(p, p.sl, "stop-loss"); toast(`Stop-loss hit at ${money(p.sl, "USD")}`, "warn"); changed = true; }
        else if (hitHigh(p.tp)) { closePos(p, p.tp, "take-profit"); toast(`Take-profit hit at ${money(p.tp, "USD")}`); changed = true; }
      } else {
        if (hitHigh(p.liq)) { closePos(p, p.liq, "liquidated"); toast(`💥 ${p.sym} short liquidated at ${money(p.liq, "USD")}`, "bad"); changed = true; }
        else if (hitHigh(p.sl)) { closePos(p, p.sl, "stop-loss"); toast(`Stop-loss hit at ${money(p.sl, "USD")}`, "warn"); changed = true; }
        else if (hitLow(p.tp)) { closePos(p, p.tp, "take-profit"); toast(`Take-profit hit at ${money(p.tp, "USD")}`); changed = true; }
      }
    }
    if (changed) { paintHistory(); paintOrder(); }
  }

  // ---------------------------------------------------------------- painting
  function paintPrice() {
    const kids = [h("h2", {}, mode === "live" ? "Live price" : "Replay (1h candles)")];
    if (mode === "live") {
      kids.push(badge(priceRes, { exampleLabel: priceRes ? "Offline: no live price, trading paused" : "Fetching…" }),
        h("div", { class: "big", "data-price": price ?? "" }, price ? money(price, "USD") : "—"),
        h("p", { class: "muted" }, `Refreshes every 10 s while this tab is open. ${ctx.fx?.data && price ? "≈ " + money(price * ctx.fx.data, "AUD") : ""}`));
    } else {
      const c = replay.cs[replay.i];
      const date = input({ type: "date", value: replay.start, "aria-label": "Replay start date", min: "2017-09-01" });
      date.addEventListener("change", () => { replay.start = date.value; loadReplay(); });
      const speed = select({ "aria-label": "Speed", value: String(replay.speed) }, [1, 2, 4, 8, 16].map((s) => ({ value: String(s), label: `${s} candles/s` })));
      speed.addEventListener("change", () => { replay.speed = +speed.value; if (replay.playing) playReplay(); });
      const p = mine().filter((x) => x.coinId === coinId);
      const lines = p.flatMap((x) => [{ y: x.entry, label: "entry", color: "#7aa2ff" }, { y: x.liq, label: "liq", color: "#ff6b6b" }, x.sl && { y: x.sl, label: "SL", color: "#ffd27a" }, x.tp && { y: x.tp, label: "TP", color: "#4fe08a" }].filter(Boolean));
      kids.push(badge(priceRes, { exampleLabel: priceRes ? "Candles unavailable (offline?)" : "Loading candles…" }),
        h("p", { class: "replay-status muted" }, c ? `${new Date(c.t).toLocaleString("en-AU", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC · candle ${replay.i + 1}/${replay.cs.length}` : ""),
        h("div", { class: "big", "data-price": price ?? "" }, price ? money(price, "USD") : "—"),
        candleChart(replay.cs.slice(Math.max(0, replay.i - 59), replay.i + 1), { hlines: lines }),
        h("div", { class: "row" },
          h("button", { class: "primary", onclick: () => (replay.playing ? (stopReplay(), paintPrice()) : playReplay()), disabled: !replay.cs.length }, replay.playing ? "⏸ Pause" : "▶ Play"),
          h("button", { onclick: () => stepReplay(), disabled: !replay.cs.length }, "Step ⏭"), speed),
        h("div", { class: "grid2", style: "margin-top:8px" }, field("Start date (blank = random)", date), h("button", { onclick: () => { replay.start = ""; loadReplay(); } }, "🎲 Random period")));
    }
    priceCard.replaceChildren(...kids);
  }

  function paintOrder() {
    const side = { v: orderCard.dataset.side || "long" };
    const margin = input({ value: orderCard.dataset.margin || 100, "aria-label": "Margin USD" });
    const lev = h("input", { type: "range", min: 1, max: 100, step: 1, value: orderCard.dataset.lev || 10, "aria-label": "Leverage" });
    const levN = input({ value: lev.value, "aria-label": "Leverage number", min: 1, max: 100 });
    const sl = input({ placeholder: "optional", "aria-label": "Stop-loss price" });
    const tp = input({ placeholder: "optional", "aria-label": "Take-profit price" });
    const prev = h("div");
    const sideSeg = h("div", { class: "seg" }, h("button", { "aria-pressed": String(side.v === "long"), onclick: () => setSide("long") }, "Long ↑"), h("button", { "aria-pressed": String(side.v === "short"), onclick: () => setSide("short") }, "Short ↓"));
    function setSide(s) { side.v = s; orderCard.dataset.side = s; sideSeg.children[0].setAttribute("aria-pressed", String(s === "long")); sideSeg.children[1].setAttribute("aria-pressed", String(s === "short")); preview(); }
    lev.addEventListener("input", () => { levN.value = lev.value; orderCard.dataset.lev = lev.value; preview(); });
    levN.addEventListener("input", () => { const v = Math.max(1, Math.min(100, Math.round(val(levN)) || 1)); lev.value = v; orderCard.dataset.lev = v; preview(); });
    margin.addEventListener("input", () => { orderCard.dataset.margin = margin.value; preview(); });
    sl.addEventListener("input", preview); tp.addEventListener("input", preview);
    orderPreview = preview;
    function preview() {
      const btn = orderCard.querySelector("[data-open]");
      if (btn) { btn.disabled = !price; btn.className = side.v === "long" ? "long" : "short"; btn.textContent = price ? `Open paper ${side.v} at ${money(price, "USD")}` : "Waiting for price"; }
      if (!price) return prev.replaceChildren(h("p", { class: "muted" }, "Waiting for a price…"));
      const L = +lev.value, M = val(margin);
      const liq = liquidationPrice(side.v, price, L, set.mmrPct);
      const { notional, qty } = positionFromMargin(M, L, price);
      const dist = liqDistancePct(side.v, price, liq);
      const slv = val(sl), tpv = val(tp);
      const atSL = slv ? closeTrade({ side: side.v, margin: M, leverage: L, entry: price, exit: slv, feePct: set.feePct, fundingPct: 0 }).net : null;
      const atTP = tpv ? closeTrade({ side: side.v, margin: M, leverage: L, entry: price, exit: tpv, feePct: set.feePct, fundingPct: 0 }).net : null;
      const slBeyondLiq = slv && ((side.v === "long" && slv <= liq) || (side.v === "short" && slv >= liq));
      prev.replaceChildren(
        h("div", { class: "stats" }, stat("Position size", money(notional, "USD"), `${num(qty, 6)} ${TRADABLE.find((c) => c.id === coinId).sym}`), h("div", { class: "stat down", "data-k": "liq" }, h("span", {}, "Liquidation"), h("b", {}, money(liq, "USD")), h("small", {}, `${pct(-dist, 2)} away`)),
          stat("Open fee", money(notional * set.feePct / 100, "USD")), stat("Loss at SL / gain at TP", `${atSL != null ? money(atSL, "USD") : "—"} / ${atTP != null ? money(atTP, "USD") : "—"}`)),
        h("p", {}, "Risk meter: how small a move wipes you out"),
        meter(100 - Math.min(100, dist * 2), { label: `${num(dist, 2)}% to liquidation`, left: "Safe", right: "Danger" }),
        slBeyondLiq ? h("p", { class: "note bad" }, "Your stop-loss is beyond the liquidation price: you'd be liquidated before it triggers.") : null,
        atSL != null && atSL < -100 ? h("p", { class: "note bad" }, `Loss at stop is ${money(-atSL, "USD")}, above your $100 max-risk rule.`) : null,
        L >= 25 ? h("p", { class: "note bad" }, `At ${L}x, a ${num(dist, 2)}% move against you liquidates the position. Normal hourly volatility can do that.`) : null);
    }
    orderCard.replaceChildren(h("h2", {}, "Open a paper position"), h("p", { class: "muted" }, `Paper balance: ${money(acct.balance, "USD")}`), sideSeg,
      h("div", { class: "grid2", style: "margin-top:8px" }, field("Margin (USD)", margin), field("Leverage (x)", levN)), lev,
      h("div", { class: "grid2" }, field("Stop-loss", sl), field("Take-profit", tp)), prev,
      h("button", { class: side.v === "long" ? "long" : "short", style: "width:100%;margin-top:8px", "data-open": "1", disabled: !price, onclick: () => openPos(side.v, val(margin), +lev.value, val(sl) || null, val(tp) || null) }, price ? `Open paper ${side.v} at ${money(price, "USD")}` : "Waiting for price"));
    preview();
  }

  function paintPositions() {
    const ps = mine();
    posCard.replaceChildren(h("h2", {}, `Open positions (${mode})`), ps.length ? null : h("p", { class: "muted" }, "None."));
    for (const p of ps) {
      const px = p.coinId === coinId ? price : null;
      const g = px ? pnl(p.side, p.qty, p.entry, px) : null;
      const hours = (nowT() - p.openedAt) / 3600_000;
      const fundingSoFar = p.notional * (set.fundingPct / 100) * Math.floor(hours / 8) * (p.side === "long" ? 1 : -1);
      const dist = px ? liqDistancePct(p.side, px, p.liq) : null;
      posCard.append(h("div", { class: "method", "data-pos": "1" },
        h("header", {}, h("b", { class: p.side === "long" ? "up" : "down" }, `${p.sym} ${p.side.toUpperCase()} ${p.lev}x`), h("button", { class: "small", disabled: !px, onclick: () => { closePos(p, px, "manual"); toast("Closed (paper)"); paintAll(); } }, "Close")),
        h("div", { class: "stats" }, stat("Entry", money(p.entry, "USD")), stat("Liq.", money(p.liq, "USD"), dist != null ? `${num(dist, 2)}% away` : ""),
          h("div", { class: `stat ${cls(g)}`, "data-k": "upnl" }, h("span", {}, "Unrealised P&L"), h("b", {}, g != null ? money(g, "USD") : "—"), h("small", {}, g != null ? `ROE ${pct((g / p.margin) * 100, 1)}` : "")),
          stat("Margin · funding", money(p.margin, "USD"), `funding ${money(-fundingSoFar, "USD")}`)),
        dist != null ? meter(100 - Math.min(100, dist * 2), { label: "liquidation risk", left: "Safe", right: "Danger" }) : null,
        h("small", {}, `SL ${p.sl ? money(p.sl, "USD") : "none"} · TP ${p.tp ? money(p.tp, "USD") : "none"} · opened ${new Date(p.openedAt).toLocaleString("en-AU")}`)));
    }
  }

  function paintHistory() {
    const hs = acct.history;
    const wins = hs.filter((x) => x.net > 0).length;
    const total = hs.reduce((s, x) => s + x.net, 0);
    histCard.replaceChildren(h("h2", {}, "Trade history"),
      h("div", { class: "stats" }, h("div", { class: "stat", "data-k": "winrate" }, h("span", {}, "Win rate"), h("b", {}, hs.length ? pct((wins / hs.length) * 100, 0, false) : "—"), h("small", {}, `${wins}/${hs.length} trades`)),
        h("div", { class: `stat ${cls(total)}` }, h("span", {}, "Net P&L"), h("b", {}, money(total, "USD"))), stat("Liquidations", String(hs.filter((x) => x.reason === "liquidated").length)), stat("Balance", money(acct.balance, "USD"))),
      h("ul", { class: "list" }, hs.slice(0, 40).map((x) => h("li", {}, h("b", { class: cls(x.net) }, money(x.net, "USD")), ` ${x.sym} ${x.side} ${x.lev}x · ${money(x.entry, "USD")} → ${money(x.exit, "USD")} · ${x.reason} · ${x.mode}`, h("br"), h("small", {}, `fees ${money(x.fees, "USD")} · funding ${money(-x.funding, "USD")} · ROE ${pct(x.roe, 1)}`)))),
      h("button", { onclick: () => { if (confirm("Reset the paper trading account to US$10,000?")) { acct = fresh(); persist(); paintAll(); } } }, "Reset account"));
  }

  function paintLearn() {
    const E = 100000;
    learnCard.replaceChildren(h("h2", {}, "How liquidation works"),
      h("p", {}, "With leverage you borrow to make a bigger position. Your margin is the only buffer. When losses eat the margin down to the maintenance margin, the exchange force-closes (liquidates) you and keeps the margin."),
      h("p", { class: "mono" }, "Long liq = Entry × (1 − 1/L) ÷ (1 − MMR)\nShort liq = Entry × (1 + 1/L) ÷ (1 + MMR)"),
      h("p", { class: "muted" }, `Example: long at ${money(E, "USD")}, 10x, MMR ${set.mmrPct}% → liquidation ${money(liquidationPrice("long", E, 10, set.mmrPct), "USD")}. A ~9.5% drop wipes the whole margin.`),
      h("p", {}, "Funding: perpetuals have no expiry, so longs and shorts pay each other a funding rate every 8 hours (positive rate: longs pay shorts). Fees are charged on the full position size, not your margin, so high leverage makes fees a big share of your margin."));
  }
  function paintHeat() {
    const p = price || 100000;
    const levs = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100];
    heatCard.replaceChildren(h("h2", {}, "Liquidation heat table"), h("p", { class: "muted" }, `How far price must move to liquidate, from ${price ? "the current price" : "an example price of US$100,000"} (MMR ${set.mmrPct}%).`),
      h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Lev."), h("th", {}, "Long liq"), h("th", {}, "Move"), h("th", {}, "Short liq"), h("th", {}, "Move"))),
        h("tbody", {}, levs.map((L) => { const lq = liquidationPrice("long", p, L, set.mmrPct), sq = liquidationPrice("short", p, L, set.mmrPct); const d = (lq / p - 1) * 100;
          return h("tr", { style: `background: rgba(255,107,107,${Math.min(0.45, (L / 100) * 0.45)})` }, h("td", {}, `${L}x`), h("td", {}, L === 1 && lq === 0 ? "none" : money(lq, "USD")), h("td", {}, pct(d, 1)), h("td", {}, money(sq, "USD")), h("td", {}, pct((sq / p - 1) * 100, 1))); })))));
  }
  function paintSize() {
    const s = load("sizeCalc", { account: acct.balance, riskPct: 1, maxRisk: 100, entry: "", stop: "" });
    const f = { account: input({ value: s.account }), riskPct: input({ value: s.riskPct }), maxRisk: input({ value: s.maxRisk }), entry: input({ value: s.entry || (price ? +price.toFixed(2) : "") }), stop: input({ value: s.stop }) };
    const out = h("div");
    const calc = () => {
      const v = Object.fromEntries(Object.entries(f).map(([k, e]) => [k, val(e)])); save("sizeCalc", v);
      if (!(v.entry > 0 && v.stop > 0)) return out.replaceChildren(h("p", { class: "muted" }, "Enter entry and stop prices."));
      const r = positionSize(v);
      out.replaceChildren(h("div", { class: "stats" }, h("div", { class: "stat", "data-k": "risk" }, h("span", {}, "Risk"), h("b", {}, money(r.risk, "USD"))), h("div", { class: "stat", "data-k": "qty" }, h("span", {}, "Size"), h("b", {}, num(r.qty, 6)), h("small", {}, money(r.notional, "USD"))), stat("Stop distance", pct(r.stopPct, 2, false)), stat("Leverage needed", `${num(r.minLeverage, 2)}x`)),
        h("p", { class: "muted" }, "Size = risk ÷ |entry − stop|. Your rule: never risk more than $100 on one trade; set the max risk field to enforce it."));
    };
    Object.values(f).forEach((e) => e.addEventListener("input", calc));
    sizeCard.replaceChildren(h("h2", {}, "Position size (risk rule)"), h("div", { class: "grid2" }, field("Account (USD)", f.account), field("Risk per trade %", f.riskPct), field("Max risk $ (your rule)", f.maxRisk), field("Entry", f.entry), field("Stop", f.stop)), out);
    calc();
  }
  function paintSettings() {
    const f = { feePct: input({ value: set.feePct }), fundingPct: input({ value: set.fundingPct }), mmrPct: input({ value: set.mmrPct }) };
    Object.entries(f).forEach(([k, e]) => e.addEventListener("change", () => { set[k] = val(e); save("levSettings", set); paintOrder(); paintLearn(); paintHeat(); }));
    setCard.replaceChildren(h("h2", {}, "Settings"), h("div", { class: "grid3" }, field("Taker fee %", f.feePct), field("Funding % / 8h", f.fundingPct), field("Maint. margin %", f.mmrPct)), h("p", { class: "muted" }, "Defaults are typical of large exchanges; edit to match yours."));
  }
  function paintAll() { paintPrice(); paintOrder(); paintPositions(); paintHistory(); paintLearn(); paintHeat(); paintSize(); paintSettings(); }
  paintAll();
  tick().catch(() => {});
  ctx.refreshMarkets().catch(() => {});
  return () => { clearInterval(liveTimer); stopReplay(); };
}
