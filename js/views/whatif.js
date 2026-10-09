import { h, card, money, num, pct, cls, badge, field, input, select, val, meter, stat, toast, date } from "../ui.js";
import { load, save } from "../store.js";
import { COINS, priceOnDay, fxOnDay, tickerUSD, fxUsdAud } from "../api.js";
import { whatIf } from "../calc.js";

// Well-documented stories (amounts as widely reported). Prices are fetched from APIs, never typed in.
const FAMOUS = [
  { title: "Laszlo's two pizzas", btc: 10000, day: "2010-05-22", then: "Paid for two pizzas (reported ~US$41). Too early for API price data.", kind: "spent" },
  { title: "James Howells' binned hard drive", btc: 8000, day: "2013-08-01", then: "Reported lost in a Newport landfill in 2013 (date approximate).", kind: "lost" },
  { title: "Stefan Thomas' locked IronKey", btc: 7002, day: "2011-06-01", then: "Reported locked behind a forgotten password (date approximate).", kind: "lost" },
  { title: "Sold 1 BTC at the Dec 2017 peak", btc: 1, day: "2017-12-17", kind: "sold" },
  { title: "Bought 1 BTC at the Nov 2021 top", btc: 1, day: "2021-11-10", kind: "bought" },
  { title: "Sold 1 BTC near the Nov 2022 low", btc: 1, day: "2022-11-21", kind: "sold" },
];

export async function render(root, ctx) {
  const s = load("whatif", { coin: "bitcoin", amount: 1, buyDay: "2020-03-13", sellDay: "2021-04-14", buy: "", sell: "" });
  const form = card("Your trade");
  const out = card("Result");
  const fam = card("Famous examples");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "What if I didn't sell?"), h("p", {}, "Compare what you sold for with what you'd have now. Prices: historical daily close in USD converted to AUD at that day's ECB rate; today from the live price.")), form, out, fam);

  const coin = select({ value: s.coin, "aria-label": "Coin" }, COINS.filter((c) => !c.stable).map((c) => ({ value: c.id, label: `${c.sym} · ${c.name}` })));
  const amount = input({ value: s.amount, "aria-label": "Amount of coins" });
  const buyDay = h("input", { type: "date", value: s.buyDay, max: new Date().toISOString().slice(0, 10), "aria-label": "Buy date" });
  const sellDay = h("input", { type: "date", value: s.sellDay, max: new Date().toISOString().slice(0, 10), "aria-label": "Sell date" });
  const buy = input({ value: s.buy, placeholder: "auto", "aria-label": "Buy price AUD" });
  const sell = input({ value: s.sell, placeholder: "auto", "aria-label": "Sell price AUD" });
  const srcNote = h("div");
  const pf = load("portfolio", { history: [] });
  const sells = pf.history.filter((x) => x.side === "sell");
  const pick = select({ "aria-label": "Pick a past paper trade" }, [{ value: "", label: sells.length ? "Pick a past paper sell…" : "No paper sells yet" }, ...sells.map((x, i) => ({ value: String(i), label: `${x.sym} ${num(x.qty, 4)} @ ${money(x.price)} · ${new Date(x.t).toLocaleDateString("en-AU")}` }))]);
  pick.addEventListener("change", () => { const x = sells[+pick.value]; if (!x) return; coin.value = x.id; amount.value = x.qty; sellDay.value = new Date(x.t).toISOString().slice(0, 10); sell.value = x.price.toFixed(2); });

  async function histAUD(id, day) {
    const [p, fx] = await Promise.all([priceOnDay(id, day), fxOnDay(day)]);
    if (!p.data || !fx.data) return { ok: false, p, fx };
    return { ok: true, aud: p.data.usd * fx.data, usd: p.data.usd, fx: fx.data, day: p.data.day, source: `${p.source} × ${fx.source}`, live: p.live };
  }
  async function nowAUD(id) {
    const m = ctx.market?.data?.find((x) => x.id === id);
    if (m && ctx.market.live) return { aud: m.aud, source: ctx.market.source, at: ctx.market.at };
    const [t, fx] = await Promise.all([tickerUSD(id), fxUsdAud()]);
    if (t.live && fx.data) return { aud: t.data * fx.data, source: `${t.source} × ${fx.source}`, at: t.at };
    return null;
  }

  async function run() {
    save("whatif", { coin: coin.value, amount: amount.value, buyDay: buyDay.value, sellDay: sellDay.value, buy: buy.value, sell: sell.value });
    out.replaceChildren(h("h2", {}, "Result"), h("p", { class: "muted" }, "Fetching prices…"));
    const notes = [];
    let bp = val(buy), sp = val(sell);
    if (!bp && buyDay.value) { const r = await histAUD(coin.value, buyDay.value); if (r.ok) { bp = r.aud; buy.placeholder = r.aud.toFixed(2); notes.push(`Buy ${r.day}: US$${num(r.usd, 4)} × ${r.fx} AUD/USD = ${money(r.aud)} (${r.source})`); } else notes.push(`Buy price for ${buyDay.value} not found: enter it manually.`); }
    if (!sp && sellDay.value) { const r = await histAUD(coin.value, sellDay.value); if (r.ok) { sp = r.aud; sell.placeholder = r.aud.toFixed(2); notes.push(`Sell ${r.day}: US$${num(r.usd, 4)} × ${r.fx} AUD/USD = ${money(r.aud)} (${r.source})`); } else notes.push(`Sell price for ${sellDay.value} not found: enter it manually.`); }
    const now = await nowAUD(coin.value);
    srcNote.replaceChildren(...notes.map((n) => h("small", { style: "display:block" }, n)), now ? h("small", { style: "display:block" }, `Now: ${money(now.aud)} (${now.source}, live)`) : h("small", { class: "down" }, "No live price right now."));
    if (!bp || !sp || !now) return out.replaceChildren(h("h2", {}, "Result"), h("p", { class: "note bad" }, "Missing a price. Enter buy/sell prices manually (AUD) or try again online."), srcNote);
    const w = whatIf({ amount: val(amount), buyPrice: bp, sellPrice: sp, nowPrice: now.aud });
    const regret = 50 + Math.max(-50, Math.min(50, (Math.sign(w.missedPct) * Math.log10(1 + Math.abs(w.missedPct)) / 3) * 50));
    out.replaceChildren(h("h2", {}, "Result"),
      h("div", { class: "stats" }, stat("You paid", money(w.cost)), h("div", { class: `stat ${cls(w.realised)}`, "data-k": "sold" }, h("span", {}, "You sold for"), h("b", {}, money(w.sold)), h("small", {}, pct(w.realisedPct, 1))),
        h("div", { class: `stat ${cls(w.ifHeld)}`, "data-k": "now" }, h("span", {}, "Worth now"), h("b", {}, money(w.now)), h("small", {}, pct(w.ifHeldPct, 1))),
        h("div", { class: `stat ${cls(-w.missed)}`, "data-k": "missed" }, h("span", {}, w.missed >= 0 ? "Missed by selling" : "Saved by selling"), h("b", {}, money(Math.abs(w.missed))), h("small", {}, pct(w.missedPct, 1)))),
      meter(regret, { label: w.missed > 0 ? "Regret" : w.missed < 0 ? "Good call" : "Even", left: "Good call 😎", right: "Regret 😭" }),
      h("p", {}, w.missed > 0 ? `Holding would be worth ${money(w.missed)} more than you sold for. Hindsight is 20/20: nobody knows the future, and plenty of coins went to zero.` : `Selling was the better move: the position is worth ${money(-w.missed)} less now.`), srcNote);
  }
  form.append(field("Pick a past trade (optional)", pick), h("div", { class: "grid2" }, field("Coin", coin), field("Amount (coins)", amount), field("Buy date", buyDay), field("Buy price AUD (blank = auto)", buy), field("Sell date", sellDay), field("Sell price AUD (blank = auto)", sell)),
    h("button", { class: "primary", style: "width:100%;margin-top:8px", onclick: run }, "Calculate"),
    h("p", { class: "muted" }, "History sources: Binance public daily candles (from Aug 2017), Coinbase Exchange, mempool.space (BTC back to 2010) and CoinGecko (last 365 days). If a date isn't covered, type the price."));

  // Famous examples
  const tbody = h("tbody");
  fam.append(h("p", { class: "muted" }, "Coin amounts as widely reported; prices fetched live from the APIs."), h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Story"), h("th", {}, "BTC"), h("th", {}, "Then (AUD)"), h("th", {}, "Now (AUD)"))), tbody)));
  async function paintFamous() {
    const now = await nowAUD("bitcoin");
    const rows = await Promise.all(FAMOUS.map(async (f) => ({ f, then: await histAUD("bitcoin", f.day) })));
    tbody.replaceChildren(...rows.map(({ f, then }) => h("tr", {}, h("td", {}, h("b", {}, f.title), h("br"), h("small", {}, `${date(Date.parse(f.day))}. ${f.then || ""}`)), h("td", {}, num(f.btc, 0)),
      h("td", {}, then.ok ? money(f.btc * then.aud) : h("small", {}, "no data")), h("td", { class: "up" }, now ? money(f.btc * now.aud) : "—"))));
    fam.append(h("small", {}, now ? `Now from ${now.source}. Then = daily close in USD × ECB AUD rate on that day.` : "Live price unavailable."));
  }
  paintFamous();
  run();
}
