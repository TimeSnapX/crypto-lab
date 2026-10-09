import { h, card, stat, money, pct, cls, badge, sparkline } from "../ui.js";
import { networkStats, fearGreed } from "../api.js";
import { nextHalvingHeight } from "../calc.js";
import { load } from "../store.js";

export const FEATURES = [
  ["learn", "🎓", "Start here", "Beginner path, lessons, glossary and quiz"],
  ["markets", "📈", "Markets", "Live prices in AUD/USD, watchlist, alerts, converter"],
  ["portfolio", "💼", "Paper portfolio", "A$100k of paper money at real prices"],
  ["trade", "⚖️", "Leverage sim", "Paper futures, liquidation, replay mode"],
  ["mining", "⛏️", "Mining", "Profit calculator and block-finding simulation"],
  ["project", "🧪", "Token designer", "Supply, allocation, vesting, health score"],
  ["address", "🔎", "BTC addresses", "Validate and look up any address (read-only)"],
  ["whatif", "🤔", "What if I didn't sell", "Regret meter with real history"],
  ["passive", "🌱", "Passive income", "Every method, compounding, income stack"],
  ["tools", "🧰", "Tools", "DCA, tax, fees, IL, risk, halving, F&G and more"],
];

export async function render(root, ctx) {
  const progress = load("learn", { done: [], quiz: null });
  root.append(
    h("div", { class: "pagehead" }, h("h2", {}, "Learn crypto by doing, with paper money"), h("p", {}, "Real prices, fake money. Nothing here can touch a wallet or place a real trade.")),
  );
  const prices = card("Bitcoin right now");
  const fng = h("div");
  const halv = h("div");
  root.append(prices,
    card("Your path", h("p", {}, `Lessons done: ${progress.done.length} · Quiz best: ${progress.quiz ? progress.quiz.best + "/" + progress.quiz.total : "not taken"}`),
      h("div", { class: "row" }, h("a", { class: "btn primary", href: "#learn", role: "button" }, "Start here →"), h("a", { class: "btn", href: "#learn?quiz", role: "button" }, "Take the quiz"))),
    card("Sentiment & cycle", fng, halv),
    card("Everything in Crypto Lab", h("div", { class: "tiles" }, FEATURES.map(([r, ico, t, d]) => h("a", { class: "tile", href: `#${r}` }, h("span", { class: "ico" }, ico), h("b", {}, t), h("small", {}, d))))));

  const paint = (m) => {
    const b = m?.data?.find((x) => x.id === "bitcoin");
    prices.replaceChildren(h("h2", {}, "Bitcoin right now"), badge(m, { exampleLabel: "Offline: no live price yet" }));
    if (!b) return prices.append(h("p", { class: "muted" }, "Live prices unavailable. Calculators still work with numbers you type in."));
    prices.append(h("div", { class: "row" }, h("div", {}, h("div", { class: "big" }, money(ctx.cur === "USD" ? b.usd : b.aud, ctx.cur)), h("span", { class: cls(b.ch24) }, `${pct(b.ch24)} 24h`)), sparkline(b.spark, { w: 140, hgt: 44 })),
      h("p", { class: "muted" }, `1 sat = ${money((ctx.cur === "USD" ? b.usd : b.aud) / 1e8, ctx.cur, 6)}`));
  };
  paint(ctx.market);
  const off = ctx.onMarket(paint);
  ctx.refreshMarkets().catch(() => {});

  fearGreed().then((r) => {
    fng.replaceChildren(h("h3", {}, "Fear & Greed index"), badge(r, { exampleLabel: "Fear & Greed unavailable" }));
    if (r.data) fng.append(h("p", {}, h("b", { class: "big" }, r.data[0].value), ` ${r.data[0].value_classification}`), sparkline(r.data.map((d) => +d.value).reverse(), { w: 200, hgt: 32, color: "var(--amber)" }), h("small", {}, " last 30 days"));
  });
  networkStats().then((r) => {
    halv.replaceChildren(h("h3", {}, "Next halving"), badge(r, { exampleLabel: "Block height unavailable" }));
    if (!r.data) return;
    const next = nextHalvingHeight(r.data.height), left = next - r.data.height;
    const eta = Date.now() + left * (r.data.avgBlockTimeS || 600) * 1000;
    halv.append(h("div", { class: "stats" }, stat("Blocks left", left.toLocaleString("en-AU")), stat("Est. date", new Date(eta).toLocaleDateString("en-AU", { month: "short", year: "numeric" }), `block ${next.toLocaleString("en-AU")}`)), h("a", { href: "#tools?halving" }, "Halving countdown & cycle chart →"));
  });
  return off;
}
