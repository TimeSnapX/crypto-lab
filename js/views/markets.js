import { h, card, money, pct, cls, badge, sparkline, field, input, select, val, num, toast } from "../ui.js";
import { load, save } from "../store.js";
import { COINS } from "../api.js";

export async function render(root, ctx) {
  const watch = load("watch", { ids: ["bitcoin", "ethereum", "solana"], alerts: [] });
  const tableCard = card("Top coins");
  const watchCard = card("Watchlist & price alerts");
  const conv = card("Converter: BTC · sats · AUD · USD");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Markets"), h("p", {}, "Live prices from public APIs. Tap ☆ to watch a coin.")),
    h("div", { class: "row" }, h("a", { class: "btn primary", href: "#portfolio", role: "button" }, "💼 Paper portfolio"), h("button", { onclick: () => ctx.refreshMarkets(true).catch(() => {}) }, "↻ Refresh")),
    tableCard, watchCard, conv);

  function paintTable(m) {
    tableCard.replaceChildren(h("h2", {}, "Top coins"), badge(m, { exampleLabel: "Offline: no live prices (nothing to show; no example prices are invented)" }));
    if (!m?.data) return;
    const rows = [...m.data].sort((a, b) => (a.rank || 999) - (b.rank || 999));
    tableCard.append(h("div", { class: "tablewrap" }, h("table", { class: "mkt" },
      h("thead", {}, h("tr", {}, h("th", {}, "Coin"), h("th", {}, "AUD"), h("th", {}, "USD"), h("th", {}, "24h"), h("th", {}, "7d"), h("th", {}, ""))),
      h("tbody", {}, rows.map((r) => h("tr", { "data-coin": r.id },
        h("td", {}, h("span", { class: "coin" }, r.image ? h("img", { src: r.image, alt: "", loading: "lazy" }) : null, h("span", {}, h("b", {}, r.sym), h("small", {}, r.name)))),
        h("td", {}, money(r.aud, "AUD")), h("td", {}, money(r.usd, "USD")),
        h("td", { class: cls(r.ch24) }, pct(r.ch24, 1)),
        h("td", {}, r.spark?.length ? sparkline(r.spark.filter((_, i) => i % 3 === 0), { w: 64, hgt: 22 }) : h("small", {}, "—")),
        h("td", {}, h("button", { class: "small ghost", "aria-label": `Watch ${r.sym}`, onclick: () => toggle(r.id) }, watch.ids.includes(r.id) ? "★" : "☆"))))))));
    if (!m.data[0]?.spark?.length) tableCard.append(h("p", { class: "muted" }, "Sparklines need CoinGecko; the fallback source has no 7-day history."));
  }
  function toggle(id) {
    watch.ids = watch.ids.includes(id) ? watch.ids.filter((x) => x !== id) : [...watch.ids, id];
    save("watch", watch); paintTable(ctx.market); paintWatch(ctx.market);
  }
  function paintWatch(m) {
    Object.assign(watch, load("watch", watch)); // alerts may have fired since (app.js marks them)
    const coinSel = select({}, COINS.map((c) => ({ value: c.id, label: c.sym })));
    const dir = select({}, ["above", "below"]);
    const price = input({ placeholder: "Price", "aria-label": "Alert price" });
    const curSel = select({ value: ctx.cur }, ["AUD", "USD"]);
    const by = (id) => m?.data?.find((x) => x.id === id);
    watchCard.replaceChildren(h("h2", {}, "Watchlist & price alerts"),
      h("p", { class: "muted" }, "Alerts show inside the app while it is open (no push notifications, nothing leaves your device)."),
      h("ul", { class: "list" }, watch.ids.map((id) => { const r = by(id); const c = COINS.find((x) => x.id === id); return h("li", { class: "row" }, h("b", {}, c?.sym || id), h("span", {}, r ? money(ctx.cur === "USD" ? r.usd : r.aud, ctx.cur) : "—"), h("span", { class: cls(r?.ch24) }, r ? pct(r.ch24, 1) : "")); })),
      h("h3", {}, "New alert"),
      h("div", { class: "grid2" }, coinSel, dir, price, curSel),
      h("button", { class: "primary", style: "margin-top:8px;width:100%", onclick: () => {
        const p = val(price); if (!(p > 0)) return toast("Enter a price", "warn");
        const c = COINS.find((x) => x.id === coinSel.value);
        watch.alerts.push({ id: c.id, sym: c.sym, dir: dir.value, price: p, cur: curSel.value, created: Date.now() });
        if (!watch.ids.includes(c.id)) watch.ids.push(c.id);
        save("watch", watch); toast("Alert saved"); paintWatch(ctx.market); ctx.refreshMarkets(true).catch(() => {});
      } }, "Add alert"),
      h("ul", { class: "list" }, watch.alerts.map((a, i) => h("li", { class: "row" }, h("span", {}, `${a.sym} ${a.dir} ${a.cur} ${num(a.price, 4)}`), h("small", {}, a.fired ? "🔔 triggered" : "waiting"),
        h("button", { class: "small", onclick: () => { watch.alerts.splice(i, 1); save("watch", watch); paintWatch(ctx.market); } }, "Delete")))));
  }
  function paintConv(m) {
    const b = m?.data?.find((x) => x.id === "bitcoin");
    const fields = { btc: input({ value: 0.01 }), sats: input({}), aud: input({}), usd: input({}) };
    const manual = input({ value: b?.aud ? Math.round(b.aud) : "", "aria-label": "BTC price in AUD" });
    const sync = (from) => {
      const pa = val(manual) || 0; const pu = b?.usd && b?.aud ? pa * (b.usd / b.aud) : ctx.fx?.data ? pa / ctx.fx.data : 0;
      let x = 0;
      if (from === "btc") x = val(fields.btc); if (from === "sats") x = val(fields.sats) / 1e8; if (from === "aud") x = pa ? val(fields.aud) / pa : 0; if (from === "usd") x = pu ? val(fields.usd) / pu : 0;
      if (from !== "btc") fields.btc.value = +x.toFixed(8);
      if (from !== "sats") fields.sats.value = Math.round(x * 1e8);
      if (from !== "aud") fields.aud.value = +(x * pa).toFixed(2);
      if (from !== "usd") fields.usd.value = pu ? +(x * pu).toFixed(2) : "";
    };
    for (const [k, el] of Object.entries(fields)) el.addEventListener("input", () => sync(k));
    manual.addEventListener("input", () => sync("btc"));
    conv.replaceChildren(h("h2", {}, "Converter: BTC · sats · AUD · USD"), badge(m, { exampleLabel: "Offline: type a BTC price below" }),
      h("div", { class: "grid2" }, field("BTC", fields.btc), field("Satoshis", fields.sats), field("AUD", fields.aud), field("USD", fields.usd)),
      field("BTC price (AUD), editable", manual, b ? "Filled from the live price" : "Enter manually"),
      h("p", { class: "muted" }, "1 BTC = 100,000,000 satoshis (sats)."));
    sync("btc");
  }
  const paint = (m) => { paintTable(m); paintWatch(m); const st = String(!!m?.live); if (conv.dataset.state !== st) { conv.dataset.state = st; paintConv(m); } };
  paint(ctx.market);
  const off = ctx.onMarket(paint);
  ctx.refreshMarkets().catch(() => {});
  return off;
}
