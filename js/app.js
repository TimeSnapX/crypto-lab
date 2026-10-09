// Crypto Lab: router, shared market state, in-app price alerts.
import { markets, fxUsdAud, log as apiLog, hostBlocked, ENDPOINTS, clearCache } from "./api.js";
import { $, $$, h, toast, time } from "./ui.js";
import { load, save } from "./store.js";

const ROUTES = {
  home: () => import("./views/home.js"),
  markets: () => import("./views/markets.js"),
  portfolio: () => import("./views/portfolio.js"),
  trade: () => import("./views/trade.js"),
  mining: () => import("./views/mining.js"),
  project: () => import("./views/project.js"),
  address: () => import("./views/address.js"),
  whatif: () => import("./views/whatif.js"),
  passive: () => import("./views/passive.js"),
  learn: () => import("./views/learn.js"),
  tools: () => import("./views/tools.js"),
  more: () => import("./views/more.js"),
  sources: () => import("./views/sources.js"),
  settings: () => import("./views/settings.js"),
};
const TAB_OF = { home: "home", markets: "markets", portfolio: "markets", trade: "trade", mining: "mining" };

const listeners = new Set();
export const ctx = {
  cur: load("cur", "AUD"),
  market: null, fx: null,
  onMarket(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  async refreshMarkets(force) {
    if (!force && ctx.market && Date.now() - ctx.market.at < 60_000 && ctx.market.live) return ctx.market;
    const [m, fx] = await Promise.all([markets(), fxUsdAud()]);
    ctx.market = m; ctx.fx = fx;
    checkAlerts();
    for (const fn of listeners) try { fn(m); } catch (e) { console.warn(e); }
    return m;
  },
  price(id, cur = ctx.cur) {
    const r = ctx.market?.data?.find((x) => x.id === id);
    if (!r) return null;
    return cur === "USD" ? r.usd : r.aud;
  },
};

let cleanup = null;
async function route() {
  const name = (location.hash.slice(1).split("?")[0] || "home");
  const key = ROUTES[name] ? name : "home";
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  $$(".toast").forEach((t) => t.remove());
  $$(".bottom a").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === (TAB_OF[key] || "more") ? "page" : "false"));
  const root = $("#view");
  root.replaceChildren(h("p", { class: "loading" }, "Loading…"));
  root.dataset.route = key;
  try {
    const mod = await ROUTES[key]();
    root.replaceChildren();
    cleanup = (await mod.render(root, ctx)) || null;
  } catch (e) {
    console.warn(e);
    root.replaceChildren(h("section", { class: "card" }, h("h2", {}, "Something went wrong"), h("p", {}, String(e.message || e))));
  }
  window.scrollTo(0, 0);
  document.title = `Crypto Lab · ${key[0].toUpperCase()}${key.slice(1)}`;
}
addEventListener("hashchange", route);

// ---------------------------------------------------------------- alerts (in-app only, no push)
function checkAlerts() {
  const list = load("watch", { ids: ["bitcoin", "ethereum", "solana"], alerts: [] });
  const box = $("#alerts");
  let changed = false;
  for (const a of list.alerts) {
    if (a.fired) continue;
    const p = ctx.price(a.id, a.cur);
    if (p == null || !ctx.market?.live) continue;
    if ((a.dir === "above" && p >= a.price) || (a.dir === "below" && p <= a.price)) {
      a.fired = Date.now(); changed = true;
      box.append(h("div", { class: "alert-banner", role: "alert" },
        h("b", {}, `🔔 ${a.sym} is ${a.dir} ${a.cur} ${a.price.toLocaleString("en-AU")}`),
        h("span", {}, ` now ${p.toLocaleString("en-AU", { maximumFractionDigits: 4 })} · ${time(Date.now())}`),
        h("button", { class: "x", "aria-label": "Dismiss", onclick: (e) => e.target.closest(".alert-banner").remove() }, "×")));
      toast(`🔔 ${a.sym} ${a.dir} ${a.cur} ${a.price.toLocaleString("en-AU")}`, "warn");
    }
  }
  if (changed) save("watch", list);
}

// ---------------------------------------------------------------- shell
$("#cur").value = ctx.cur;
$("#cur").addEventListener("change", (e) => { ctx.cur = e.target.value; save("cur", ctx.cur); route(); });
function net() { const n = $("#net"); n.className = "net " + (navigator.onLine ? "on" : "off"); n.title = navigator.onLine ? "Online" : "Offline: live data unavailable"; }
addEventListener("online", () => { net(); toast("Back online"); ctx.refreshMarkets(true).catch(() => {}); });
addEventListener("offline", () => { net(); toast("Offline: showing last known / example values", "warn"); });
net();

route();
ctx.refreshMarkets().catch(() => {});
// Background refresh only while the app is visible (60 s, matches the API cache).
setInterval(() => { if (document.visibilityState === "visible") ctx.refreshMarkets().catch(() => {}); }, 60_000);
window.__cl = { ctx, apiLog, hostBlocked, ENDPOINTS, clearCache };
