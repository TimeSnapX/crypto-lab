// Crypto Lab: keyless public APIs only. Read-only GET requests, no keys, no wallets.
// - Every response is cached in memory for 60 s (TTL configurable per call) and the last good
//   copy is kept in localStorage so the UI can show "last known" data, clearly labelled, offline.
// - Hosts that fail or rate-limit (HTTP 429/5xx) are backed off exponentially (30 s .. 10 min)
//   and the next source in the fallback chain is tried.
// The service worker never touches these cross-origin requests.

const mem = new Map();      // url -> { t, data }
const inflight = new Map(); // url -> promise
const backoff = new Map();  // host -> { until, n }
const LS_PREFIX = "cl.cache.";
export const DEFAULT_TTL = 60_000;
export const log = []; // recent request outcomes for the Sources panel

function host(url) { return new URL(url).host; }
function note(entry) { log.unshift({ ...entry, at: Date.now() }); log.length = Math.min(log.length, 60); }

export function hostBlocked(h) { const b = backoff.get(h); return b && b.until > Date.now() ? b.until : 0; }

export async function getJSON(url, { ttl = DEFAULT_TTL, text = false, timeout = 12000 } = {}) {
  const hit = mem.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.data;
  if (inflight.has(url)) return inflight.get(url);
  const h = host(url);
  const blocked = hostBlocked(h);
  if (blocked) throw new Error(`${h} backing off for ${Math.ceil((blocked - Date.now()) / 1000)} s`);
  const p = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: text ? "text/plain,*/*" : "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) bump(h, res.headers.get("retry-after"));
        throw new Error(`${h} HTTP ${res.status}`);
      }
      const data = text ? (await res.text()).trim() : await res.json();
      backoff.delete(h);
      mem.set(url, { t: Date.now(), data });
      note({ host: h, ok: true });
      return data;
    } catch (e) {
      if (e.name === "AbortError") { bump(h); e = new Error(`${h} timed out`); }
      else if (!String(e.message).includes("HTTP")) bump(h);
      note({ host: h, ok: false, err: e.message });
      throw e;
    } finally { clearTimeout(timer); inflight.delete(url); }
  })();
  inflight.set(url, p);
  return p;
}
function bump(h, retryAfter) {
  const b = backoff.get(h) || { n: 0 };
  b.n++;
  const ra = Number(retryAfter) * 1000;
  b.until = Date.now() + (ra > 0 ? ra : Math.min(600_000, 30_000 * 2 ** (b.n - 1)));
  backoff.set(h, b);
}

/** Try each source in order; returns { data, source, at, live:true } or the last stored copy (live:false). */
export async function firstOf(key, sources, opts) {
  const errors = [];
  for (const s of sources) {
    try {
      const data = await s.run(opts);
      const out = { data, source: s.name, url: s.url, at: Date.now(), live: true };
      try { const j = JSON.stringify(out); if (j.length < 250_000) localStorage.setItem(LS_PREFIX + key, j); } catch {}
      return out;
    } catch (e) { errors.push(`${s.name}: ${e.message}`); }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(LS_PREFIX + key) || "null");
    if (saved) return { ...saved, live: false, stale: true, errors };
  } catch {}
  return { data: null, live: false, errors };
}

// ------------------------------------------------------------------ coins
// One table maps our coin ids to each provider's symbol.
export const COINS = [
  { id: "bitcoin", sym: "BTC", name: "Bitcoin", bn: "BTCUSDT", cb: "BTC-USD" },
  { id: "ethereum", sym: "ETH", name: "Ethereum", bn: "ETHUSDT", cb: "ETH-USD" },
  { id: "solana", sym: "SOL", name: "Solana", bn: "SOLUSDT", cb: "SOL-USD" },
  { id: "binancecoin", sym: "BNB", name: "BNB", bn: "BNBUSDT", cb: null },
  { id: "ripple", sym: "XRP", name: "XRP", bn: "XRPUSDT", cb: "XRP-USD" },
  { id: "cardano", sym: "ADA", name: "Cardano", bn: "ADAUSDT", cb: "ADA-USD" },
  { id: "dogecoin", sym: "DOGE", name: "Dogecoin", bn: "DOGEUSDT", cb: "DOGE-USD" },
  { id: "tron", sym: "TRX", name: "TRON", bn: "TRXUSDT", cb: null },
  { id: "avalanche-2", sym: "AVAX", name: "Avalanche", bn: "AVAXUSDT", cb: "AVAX-USD" },
  { id: "chainlink", sym: "LINK", name: "Chainlink", bn: "LINKUSDT", cb: "LINK-USD" },
  { id: "polkadot", sym: "DOT", name: "Polkadot", bn: "DOTUSDT", cb: "DOT-USD" },
  { id: "litecoin", sym: "LTC", name: "Litecoin", bn: "LTCUSDT", cb: "LTC-USD" },
  { id: "bitcoin-cash", sym: "BCH", name: "Bitcoin Cash", bn: "BCHUSDT", cb: "BCH-USD" },
  { id: "uniswap", sym: "UNI", name: "Uniswap", bn: "UNIUSDT", cb: "UNI-USD" },
  { id: "near", sym: "NEAR", name: "NEAR", bn: "NEARUSDT", cb: "NEAR-USD" },
  { id: "tether", sym: "USDT", name: "Tether", bn: null, cb: "USDT-USD", stable: true },
  { id: "usd-coin", sym: "USDC", name: "USD Coin", bn: null, cb: null, stable: true },
];
export const coinById = (id) => COINS.find((c) => c.id === id);

const CG = "https://api.coingecko.com/api/v3";
const BN = "https://data-api.binance.vision/api/v3";
const CB = "https://api.exchange.coinbase.com";
// Kraken's public API works from the box but does not send CORS headers to browsers, so it isn't used.
const MP = "https://mempool.space/api";
const BS = "https://blockstream.info/api";
const BC = "https://blockchain.info";
const PP = "https://api.coinpaprika.com/v1";
const FX = "https://api.frankfurter.dev/v1";
const FNG = "https://api.alternative.me/fng/";
export const ENDPOINTS = { CG, BN, CB, MP, BS, BC, PP, FX, FNG };
export function clearCache() { mem.clear(); backoff.clear(); }

/** USD→AUD rate. */
export function fxUsdAud() {
  return firstOf("fx", [
    { name: "Frankfurter (ECB)", url: FX, run: async () => { const d = await getJSON(`${FX}/latest?from=USD&to=AUD`, { ttl: 3600_000 }); return d.rates.AUD; } },
    { name: "CoinGecko (USDT AUD/USD)", url: CG, run: async () => { const d = await getJSON(`${CG}/simple/price?ids=tether&vs_currencies=aud,usd`); return d.tether.aud / d.tether.usd; } },
    { name: "Coinbase", url: "https://api.coinbase.com", run: async () => { const d = await getJSON(`https://api.coinbase.com/v2/exchange-rates?currency=USD`); return Number(d.data.rates.AUD); } },
  ]);
}

/**
 * Market table: [{id, sym, name, image?, aud, usd, ch24, spark:[usd...], mcapAud?}].
 * Primary: CoinGecko /coins/markets (USD with 7d sparkline) × AUD price via second call.
 * Fallback: CoinPaprika tickers (USD + AUD, no sparkline). Fallback 2: Binance public 24h ticker (USDT) × FX.
 */
export function markets() {
  const ids = COINS.map((c) => c.id).join(",");
  return firstOf("markets", [
    { name: "CoinGecko", url: CG, run: async () => {
      const [usd, aud] = await Promise.all([
        getJSON(`${CG}/coins/markets?vs_currency=usd&ids=${ids}&sparkline=true&price_change_percentage=24h`),
        getJSON(`${CG}/coins/markets?vs_currency=aud&ids=${ids}&sparkline=false`),
      ]);
      const audBy = Object.fromEntries(aud.map((r) => [r.id, r]));
      return usd.map((r) => ({
        id: r.id, sym: r.symbol.toUpperCase(), name: r.name, image: r.image,
        usd: r.current_price, aud: audBy[r.id]?.current_price ?? null, ch24: r.price_change_percentage_24h,
        mcapAud: audBy[r.id]?.market_cap ?? null, rank: r.market_cap_rank,
        spark: r.sparkline_in_7d?.price || [],
      })).filter((r) => r.aud != null);
    } },
    { name: "CoinPaprika", url: PP, run: async () => {
      const rows = await getJSON(`${PP}/tickers?quotes=USD,AUD&limit=60`);
      const want = new Set(COINS.map((c) => c.sym));
      return rows.filter((r) => want.has(r.symbol)).map((r) => {
        const c = COINS.find((x) => x.sym === r.symbol);
        return { id: c.id, sym: r.symbol, name: r.name, usd: r.quotes.USD.price, aud: r.quotes.AUD.price, ch24: r.quotes.USD.percent_change_24h, mcapAud: r.quotes.AUD.market_cap, rank: r.rank, spark: [] };
      });
    } },
    { name: "Binance public data + Frankfurter FX", url: BN, run: async () => {
      const syms = COINS.filter((c) => c.bn).map((c) => c.bn);
      const [rows, fx] = await Promise.all([getJSON(`${BN}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(syms))}`), fxUsdAud()]);
      if (!fx.data) throw new Error("no FX");
      return rows.map((r) => { const c = COINS.find((x) => x.bn === r.symbol); const usd = Number(r.lastPrice); return { id: c.id, sym: c.sym, name: c.name, usd, aud: usd * fx.data, ch24: Number(r.priceChangePercent), spark: [] }; });
    } },
  ]);
}

/** Single live USD price, fast path for the leverage simulator (10 s cache). */
export function tickerUSD(coinId) {
  const c = coinById(coinId);
  return firstOf(`tick.${coinId}`, [
    c.bn && { name: "Binance public data", url: BN, run: async () => Number((await getJSON(`${BN}/ticker/price?symbol=${c.bn}`, { ttl: 8000 })).price) },
    c.cb && { name: "Coinbase Exchange", url: CB, run: async () => Number((await getJSON(`${CB}/products/${c.cb}/ticker`, { ttl: 8000 })).price) },
  ].filter(Boolean));
}

/**
 * Candles [{t, o, h, l, c}] in USD. interval: '1h' | '1d' | '1w'.
 * Primary Binance public data (from Aug 2017 for BTC), fallback Coinbase Exchange (max 300 candles).
 */
export function candles(coinId, interval = "1h", { startMs, limit = 500 } = {}) {
  const c = coinById(coinId);
  const key = `candles.${coinId}.${interval}.${startMs || "latest"}.${limit}`;
  return firstOf(key, [
    c.bn && { name: "Binance public data", url: BN, run: async () => {
      const q = `${BN}/klines?symbol=${c.bn}&interval=${interval}&limit=${Math.min(limit, 1000)}${startMs ? `&startTime=${startMs}` : ""}`;
      const rows = await getJSON(q, { ttl: 300_000 });
      if (!rows.length) throw new Error("no candles");
      return rows.map((r) => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
    } },
    c.cb && { name: "Coinbase Exchange", url: CB, run: async () => {
      const g = interval === "1h" ? 3600 : 86400;
      const n = Math.min(limit, 300);
      let q = `${CB}/products/${c.cb}/candles?granularity=${g}`;
      if (startMs) q += `&start=${new Date(startMs).toISOString()}&end=${new Date(startMs + n * g * 1000).toISOString()}`;
      const rows = await getJSON(q, { ttl: 300_000 });
      if (!rows.length) throw new Error("no candles");
      return rows.map((r) => ({ t: r[0] * 1000, l: r[1], h: r[2], o: r[3], c: r[4] })).sort((a, b) => a.t - b.t);
    } },
  ].filter(Boolean));
}

/** Daily USD close series between two dates (ms). Uses Binance daily klines in 1000-day pages. */
export async function dailyUSD(coinId, fromMs, toMs) {
  const c = coinById(coinId);
  const key = `daily.${coinId}.${dayKey(fromMs)}.${dayKey(toMs)}`;
  return firstOf(key, [
    c.bn && { name: "Binance public data", url: BN, run: async () => {
      let out = [], start = fromMs;
      for (let i = 0; i < 6 && start < toMs; i++) {
        const rows = await getJSON(`${BN}/klines?symbol=${c.bn}&interval=1d&limit=1000&startTime=${start}&endTime=${toMs}`, { ttl: 3600_000 });
        if (!rows.length) break;
        out = out.concat(rows.map((r) => ({ t: r[0], price: +r[4] })));
        start = rows[rows.length - 1][0] + 86400_000;
        if (rows.length < 1000) break;
      }
      if (!out.length) throw new Error("no history in range");
      return out;
    } },
    c.id !== "bitcoin" && { name: "CoinGecko (≤365 days)", url: CG, run: async () => {
      if (Date.now() - fromMs > 364 * 86400_000) throw new Error("CoinGecko public history is limited to 365 days");
      const d = await getJSON(`${CG}/coins/${c.id}/market_chart?vs_currency=usd&days=365&interval=daily`, { ttl: 3600_000 });
      return d.prices.filter(([t]) => t >= fromMs && t <= toMs).map(([t, price]) => ({ t, price }));
    } },
    c.id === "bitcoin" && { name: "mempool.space price history", url: MP, run: async () => {
      const d = await getJSON(`${MP}/v1/historical-price?currency=USD`, { ttl: 3600_000 });
      const pts = d.prices.filter((p) => p.time * 1000 >= fromMs - 86400_000 && p.time * 1000 <= toMs + 86400_000 && p.USD > 0).map((p) => ({ t: p.time * 1000, price: p.USD })).sort((a, b) => a.t - b.t);
      // collapse to one point per UTC day
      const by = new Map(); for (const p of pts) by.set(dayKey(p.t), p);
      return [...by.values()];
    } },
  ].filter(Boolean));
}
export function dayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

/** USD price of a coin on a given day (YYYY-MM-DD). */
export function priceOnDay(coinId, day) {
  const c = coinById(coinId);
  const ms = Date.parse(day + "T00:00:00Z");
  return firstOf(`pday.${coinId}.${day}`, [
    c.bn && { name: "Binance public data (daily close)", url: BN, run: async () => {
      const r = await getJSON(`${BN}/klines?symbol=${c.bn}&interval=1d&limit=1&startTime=${ms}`, { ttl: 3600_000 });
      if (!r.length || r[0][0] - ms > 2 * 86400_000) throw new Error("date not covered");
      return { usd: +r[0][4], day: dayKey(r[0][0]) };
    } },
    c.cb && { name: "Coinbase Exchange (daily close)", url: CB, run: async () => {
      const r = await getJSON(`${CB}/products/${c.cb}/candles?granularity=86400&start=${day}T00:00:00Z&end=${dayKey(ms + 2 * 86400_000)}T00:00:00Z`, { ttl: 3600_000 });
      if (!r.length) throw new Error("date not covered");
      const last = r.sort((a, b) => a[0] - b[0])[0];
      return { usd: last[4], day: dayKey(last[0] * 1000) };
    } },
    c.id === "bitcoin" && { name: "mempool.space historical price", url: MP, run: async () => {
      const d = await getJSON(`${MP}/v1/historical-price?currency=USD&timestamp=${Math.floor(ms / 1000)}`, { ttl: 3600_000 });
      const p = d.prices?.[0];
      if (!p || !(p.USD > 0)) throw new Error("date not covered");
      return { usd: p.USD, day: dayKey(p.time * 1000) };
    } },
    { name: "CoinGecko (≤365 days)", url: CG, run: async () => {
      if (Date.now() - ms > 364 * 86400_000) throw new Error("public API limited to 365 days");
      const d = await getJSON(`${CG}/coins/${c.id}/market_chart?vs_currency=usd&days=365&interval=daily`, { ttl: 3600_000 });
      let best = null; for (const [t, p] of d.prices) if (!best || Math.abs(t - ms) < Math.abs(best[0] - ms)) best = [t, p];
      if (!best || Math.abs(best[0] - ms) > 2 * 86400_000) throw new Error("date not covered");
      return { usd: best[1], day: dayKey(best[0]) };
    } },
  ].filter(Boolean));
}

/** Historical USD→AUD (ECB reference rate via Frankfurter). */
export function fxOnDay(day) {
  return firstOf(`fx.${day}`, [
    { name: "Frankfurter (ECB)", url: FX, run: async () => (await getJSON(`${FX}/${day}?from=USD&to=AUD`, { ttl: 86400_000 })).rates.AUD },
  ]);
}
export function fxSeries(fromDay, toDay) {
  return firstOf(`fxs.${fromDay}.${toDay}`, [
    { name: "Frankfurter (ECB)", url: FX, run: async () => (await getJSON(`${FX}/${fromDay}..${toDay}?from=USD&to=AUD`, { ttl: 86400_000 })).rates },
  ]);
}

// ------------------------------------------------------------------ Bitcoin network
export function networkStats() {
  return firstOf("network", [
    { name: "mempool.space", url: MP, run: async () => {
      const [hr, adj, height, rew] = await Promise.all([
        getJSON(`${MP}/v1/mining/hashrate/3d`), getJSON(`${MP}/v1/difficulty-adjustment`),
        getJSON(`${MP}/blocks/tip/height`, { text: true }), getJSON(`${MP}/v1/mining/reward-stats/144`),
      ]);
      const h = Number(height);
      const blocks = Number(rew.endBlock) - Number(rew.startBlock) + 1;
      return {
        height: h, difficulty: hr.currentDifficulty, hashrate: hr.currentHashrate,
        avgFeesBTC: Number(rew.totalFee) / 1e8 / blocks, avgBlockTimeS: adj.timeAvg / 1000,
        nextRetargetHeight: adj.nextRetargetHeight, difficultyChangePct: adj.difficultyChange,
        remainingBlocks: adj.remainingBlocks, estimatedRetargetDate: adj.estimatedRetargetDate,
      };
    } },
    { name: "blockchain.info", url: BC, run: async () => {
      const [d, hr, h] = await Promise.all([
        getJSON(`${BC}/q/getdifficulty?cors=true`, { text: true }), getJSON(`${BC}/q/hashrate?cors=true`, { text: true }), getJSON(`${BC}/q/getblockcount?cors=true`, { text: true }),
      ]);
      // q/hashrate is GH/s
      return { height: Number(h), difficulty: Number(d), hashrate: Number(hr) * 1e9, avgFeesBTC: null, avgBlockTimeS: 600 };
    } },
  ]);
}

/** BTC price in AUD + USD (light): mempool.space → blockchain.info → CoinGecko. */
export function btcPrice() {
  return firstOf("btcprice", [
    { name: "mempool.space", url: MP, run: async () => { const d = await getJSON(`${MP}/v1/prices`); return { aud: d.AUD, usd: d.USD }; } },
    { name: "blockchain.info", url: BC, run: async () => { const d = await getJSON(`${BC}/ticker?cors=true`); return { aud: d.AUD.last, usd: d.USD.last }; } },
    { name: "CoinGecko", url: CG, run: async () => { const d = await getJSON(`${CG}/simple/price?ids=bitcoin&vs_currencies=aud,usd`); return d.bitcoin; } },
  ]);
}

// ------------------------------------------------------------------ addresses (read-only)
export function addressInfo(addr) {
  const shape = (base, name) => ({ name, url: base, run: async () => {
    const [info, txs] = await Promise.all([getJSON(`${base}/address/${addr}`), getJSON(`${base}/address/${addr}/txs`)]);
    const c = info.chain_stats, m = info.mempool_stats;
    return {
      balanceSat: c.funded_txo_sum - c.spent_txo_sum, pendingSat: m.funded_txo_sum - m.spent_txo_sum,
      txCount: c.tx_count, mempoolTx: m.tx_count, received: c.funded_txo_sum,
      txs: txs.slice(0, 10).map((t) => ({
        txid: t.txid, time: t.status?.block_time ? t.status.block_time * 1000 : null, confirmed: !!t.status?.confirmed,
        delta: t.vout.filter((o) => o.scriptpubkey_address === addr).reduce((s, o) => s + o.value, 0) - t.vin.filter((i) => i.prevout?.scriptpubkey_address === addr).reduce((s, i) => s + i.prevout.value, 0),
      })),
    };
  } });
  return firstOf(`addr.${addr}`, [shape(MP, "mempool.space"), shape(BS, "Blockstream Esplora")]);
}

export function fearGreed() {
  return firstOf("fng", [{ name: "alternative.me", url: FNG, run: async () => (await getJSON(`${FNG}?limit=30`, { ttl: 600_000 })).data }]);
}

/** Long BTC/USD history for the cycle chart (mempool.space, hourly → downsampled weekly). */
export function btcHistory() {
  return firstOf("btchistory", [{ name: "mempool.space price history", url: MP, run: async () => {
    const d = await getJSON(`${MP}/v1/historical-price?currency=USD`, { ttl: 3600_000 });
    const pts = d.prices.filter((p) => p.USD > 0).sort((a, b) => a.time - b.time);
    const out = []; let lastWeek = -1;
    for (const p of pts) { const w = Math.floor(p.time / 604800); if (w !== lastWeek) { out.push({ t: p.time * 1000, price: p.USD }); lastWeek = w; } }
    return out;
  } }]);
}
