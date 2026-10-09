import { h, card, time } from "../ui.js";
import { log, hostBlocked, ENDPOINTS, getJSON } from "../api.js";
const LIST = [
  ["CoinGecko public", "https://api.coingecko.com/api/v3/ping", "Prices, sparklines, ≤365-day history (primary)"],
  ["Binance public data", "https://data-api.binance.vision/api/v3/ping", "Live ticker, candles, long daily history"],
  ["Coinbase Exchange", "https://api.exchange.coinbase.com/products/BTC-USD/ticker", "Ticker and candle fallback"],
  ["CoinPaprika", "https://api.coinpaprika.com/v1/global", "Market table fallback"],
  ["mempool.space", "https://mempool.space/api/blocks/tip/height", "Difficulty, hashrate, fees, addresses, BTC price history"],
  ["Blockstream Esplora", "https://blockstream.info/api/blocks/tip/height", "Address lookup fallback"],
  ["blockchain.info", "https://blockchain.info/q/getblockcount?cors=true", "Network stats and BTC price fallback"],
  ["Frankfurter (ECB FX)", "https://api.frankfurter.dev/v1/latest?from=USD&to=AUD", "USD→AUD rates, current and historical"],
  ["alternative.me", "https://api.alternative.me/fng/?limit=1", "Fear & Greed index"],
];
export function render(root) {
  const tbody = h("tbody");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Data sources"), h("p", {}, "All keyless and read-only. Responses are cached for 60 seconds; a source that fails or rate-limits is backed off and the next one is used.")),
    card("Status", h("button", { class: "primary", onclick: test }, "Test all sources now"), h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Source"), h("th", {}, "Status"))), tbody))),
    card("Recent requests", h("ul", { class: "list" }, log.slice(0, 20).map((l) => h("li", {}, h("span", { class: l.ok ? "ok" : "down" }, l.ok ? "✓ " : "✗ "), `${l.host} · ${time(l.at)}`, l.err ? h("small", {}, ` ${l.err}`) : null)))));
  function paint(results = {}) {
    tbody.replaceChildren(...LIST.map(([n, u, d]) => h("tr", {}, h("td", {}, h("b", {}, n), h("br"), h("small", {}, d)), h("td", { "data-src": n }, results[n] || (hostBlocked(new URL(u).host) ? "backing off" : "–")))));
  }
  async function test() {
    const r = {};
    await Promise.all(LIST.map(async ([n, u]) => { const t0 = performance.now(); try { await getJSON(u, { ttl: 0, text: /blocks\/tip|getblockcount/.test(u) }); r[n] = `✓ ${Math.round(performance.now() - t0)} ms`; } catch (e) { r[n] = `✗ ${e.message}`; } }));
    paint(r);
  }
  paint();
}
