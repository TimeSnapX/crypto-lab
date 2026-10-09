// Small DOM + formatting + SVG chart helpers (no libraries).
// append/replaceChildren ignore null/false/undefined (so conditional children never render as "null").
for (const proto of [Element.prototype, DocumentFragment.prototype]) for (const m of ["append", "replaceChildren"]) {
  const orig = proto[m];
  proto[m] = function (...kids) { return orig.apply(this, kids.filter((k) => k != null && k !== false)); };
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const nf = (min, max) => new Intl.NumberFormat("en-AU", { minimumFractionDigits: min, maximumFractionDigits: max });
export function money(v, cur = "AUD", digits) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const d = digits ?? (a >= 1000 ? 0 : a >= 1 || a === 0 ? 2 : a >= 0.01 ? 4 : 8);
  const s = nf(d, d).format(a);
  const sym = cur === "AUD" ? "A$" : cur === "USD" ? "US$" : "";
  return (v < 0 ? "−" : "") + sym + s;
}
export function num(v, d = 2) { if (v == null || !isFinite(v)) return "—"; return nf(0, d).format(v); }
export function pct(v, d = 2, sign = true) { if (v == null || !isFinite(v)) return "—"; return (sign && v > 0 ? "+" : v < 0 ? "−" : "") + nf(d, d).format(Math.abs(v)) + "%"; }
export function btc(v, d = 8) { if (v == null || !isFinite(v)) return "—"; return nf(0, d).format(v) + " BTC"; }
export function compact(v) { if (v == null || !isFinite(v)) return "—"; return new Intl.NumberFormat("en-AU", { notation: "compact", maximumFractionDigits: 2 }).format(v); }
export function time(ms) {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", second: "2-digit", day: "numeric", month: "short", timeZoneName: "short" }).format(new Date(ms));
}
export function date(ms) { return ms ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms)) : "—"; }
export function duration(s) {
  if (!isFinite(s)) return "never";
  const y = s / 31557600; if (y >= 2) return `${num(y, 1)} years`;
  const d = s / 86400; if (d >= 2) return `${num(d, 1)} days`;
  const hh = s / 3600; if (hh >= 2) return `${num(hh, 1)} hours`;
  return `${num(s / 60, 1)} min`;
}
export const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");

/** Source badge: live (green) / last known (amber) / example values (amber) / offline (red). */
export function badge(res, { exampleLabel = "Offline: example values" } = {}) {
  if (res && res.live) return h("p", { class: "src live", "data-live": "1" }, h("span", { class: "dot" }), `Live · ${res.source} · ${time(res.at)}`);
  if (res && res.stale) return h("p", { class: "src stale", "data-live": "0" }, h("span", { class: "dot" }), `Offline · last known from ${res.source} at ${time(res.at)}`);
  return h("p", { class: "src off", "data-live": "0", title: (res?.errors || []).join("\n") }, h("span", { class: "dot" }), exampleLabel);
}

export function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
}
export function input(attrs) { return h("input", { inputmode: attrs.type === "number" || !attrs.type ? "decimal" : undefined, type: "number", step: "any", ...attrs }); }
export function select(attrs, options) {
  const s = h("select", attrs);
  for (const o of options) s.append(h("option", { value: o.value ?? o, selected: (attrs.value ?? null) === (o.value ?? o) }, o.label ?? o));
  return s;
}
export const val = (el) => { const v = parseFloat(el.value); return isFinite(v) ? v : 0; };

export function card(title, ...kids) { return h("section", { class: "card" }, title ? h("h2", {}, title) : null, ...kids); }
export function stat(label, value, extra, c = "") { return h("div", { class: `stat ${c}` }, h("span", {}, label), h("b", {}, value), extra ? h("small", {}, extra) : null); }
export function toast(msg, kind = "") {
  const t = h("div", { class: `toast ${kind}`, role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 3500);
}
export function download(name, text, type = "application/json") {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------------------------------------------------------------- SVG charts
const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }

export function sparkline(values, { w = 90, hgt = 28, color } = {}) {
  const svg = s("svg", { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, class: "spark", "aria-hidden": "true" });
  if (!values || values.length < 2) return svg;
  const min = Math.min(...values), max = Math.max(...values), r = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(hgt - 2 - ((v - min) / r) * (hgt - 4)).toFixed(1)}`).join(" ");
  svg.append(s("polyline", { points: pts, fill: "none", stroke: color || (values.at(-1) >= values[0] ? "var(--up)" : "var(--down)"), "stroke-width": 1.6, "stroke-linejoin": "round" }));
  return svg;
}

/**
 * Multi-series line chart. series: [{name, color, pts:[[x,y]...], dash?, area?}]
 * opts: { w, h, log, xfmt, yfmt, marks:[{x,label,color}], hlines:[{y,label,color}] }
 */
export function lineChart(series, opts = {}) {
  const W = opts.w || 360, H = opts.h || 200, P = { l: 46, r: 8, t: 10, b: 22 };
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": opts.label || "chart" });
  const all = series.flatMap((x) => x.pts).filter((p) => isFinite(p[1]) && (!opts.log || p[1] > 0));
  if (!all.length) { svg.append(s("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "ax" })).textContent = "No data"; return svg; }
  const tf = opts.log ? Math.log10 : (v) => v;
  let x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  let y0 = Math.min(...all.map((p) => tf(p[1])), ...(opts.hlines || []).map((l) => tf(l.y)));
  let y1 = Math.max(...all.map((p) => tf(p[1])), ...(opts.hlines || []).map((l) => tf(l.y)));
  if (opts.zero && !opts.log) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
  if (y1 === y0) { y1 += 1; y0 -= 1; }
  const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
  if (x1 === x0) x1 = x0 + 1;
  const X = (x) => P.l + ((x - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (y) => P.t + (1 - (tf(y) - y0) / (y1 - y0)) * (H - P.t - P.b);
  const yfmt = opts.yfmt || ((v) => compact(v));
  for (let i = 0; i <= 4; i++) {
    const yv = y0 + ((y1 - y0) * i) / 4, py = P.t + (1 - i / 4) * (H - P.t - P.b);
    svg.append(s("line", { x1: P.l, x2: W - P.r, y1: py, y2: py, class: "grid" }));
    const t = s("text", { x: P.l - 4, y: py + 3, "text-anchor": "end", class: "ax" }); t.textContent = yfmt(opts.log ? 10 ** yv : yv); svg.append(t);
  }
  const xfmt = opts.xfmt || ((v) => num(v, 0));
  for (let i = 0; i <= 3; i++) {
    const xv = x0 + ((x1 - x0) * i) / 3;
    const t = s("text", { x: X(xv), y: H - 6, "text-anchor": i === 0 ? "start" : i === 3 ? "end" : "middle", class: "ax" }); t.textContent = xfmt(xv); svg.append(t);
  }
  for (const m of opts.marks || []) {
    if (m.x < x0 || m.x > x1) continue;
    svg.append(s("line", { x1: X(m.x), x2: X(m.x), y1: P.t, y2: H - P.b, stroke: m.color || "var(--amber)", "stroke-dasharray": "3 3", "stroke-width": 1 }));
    const t = s("text", { x: X(m.x) + 2, y: P.t + 9, class: "ax mark" }); t.textContent = m.label || ""; svg.append(t);
  }
  for (const l of opts.hlines || []) {
    svg.append(s("line", { x1: P.l, x2: W - P.r, y1: Y(l.y), y2: Y(l.y), stroke: l.color || "var(--amber)", "stroke-dasharray": "4 3", "stroke-width": 1.2 }));
    const t = s("text", { x: W - P.r - 2, y: Y(l.y) - 3, "text-anchor": "end", class: "ax mark", fill: l.color || "var(--amber)" }); t.textContent = l.label || ""; svg.append(t);
  }
  for (const se of series) {
    const pts = se.pts.filter((p) => isFinite(p[1]) && (!opts.log || p[1] > 0));
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    if (se.area) svg.append(s("path", { d: `${d}L${X(pts.at(-1)[0]).toFixed(1)},${H - P.b}L${X(pts[0][0]).toFixed(1)},${H - P.b}Z`, fill: se.color, opacity: 0.12 }));
    svg.append(s("path", { d, fill: "none", stroke: se.color, "stroke-width": se.width || 1.8, "stroke-dasharray": se.dash || "", "stroke-linejoin": "round" }));
  }
  const wrap = h("figure", { class: "chartwrap" }, svg);
  if (series.length > 1 || opts.legend) wrap.append(h("figcaption", { class: "legend" }, series.map((se) => h("span", {}, h("i", { style: `background:${se.color}` }), se.name))));
  return wrap;
}

/** Candlestick chart for replay. candles [{t,o,h,l,c}] */
export function candleChart(cs, { w = 360, h: H = 220, hlines = [] } = {}) {
  const P = { l: 52, r: 6, t: 8, b: 8 };
  const svg = s("svg", { viewBox: `0 0 ${w} ${H}`, class: "chart", role: "img", "aria-label": "price candles" });
  if (!cs.length) return svg;
  const lo = Math.min(...cs.map((c) => c.l), ...hlines.map((x) => x.y).filter((y) => y > 0 && isFinite(y)));
  const hi = Math.max(...cs.map((c) => c.h), ...hlines.map((x) => x.y).filter(isFinite));
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const bw = (w - P.l - P.r) / cs.length;
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4; const py = Y(v);
    svg.append(s("line", { x1: P.l, x2: w - P.r, y1: py, y2: py, class: "grid" }));
    const t = s("text", { x: P.l - 4, y: py + 3, "text-anchor": "end", class: "ax" }); t.textContent = compact(v); svg.append(t);
  }
  cs.forEach((c, i) => {
    const x = P.l + i * bw + bw / 2, up = c.c >= c.o, col = up ? "var(--up)" : "var(--down)";
    svg.append(s("line", { x1: x, x2: x, y1: Y(c.h), y2: Y(c.l), stroke: col, "stroke-width": 1 }));
    svg.append(s("rect", { x: x - Math.max(1, bw * 0.35), width: Math.max(2, bw * 0.7), y: Math.min(Y(c.o), Y(c.c)), height: Math.max(1, Math.abs(Y(c.o) - Y(c.c))), fill: col }));
  });
  for (const l of hlines) {
    if (!isFinite(l.y) || l.y < lo || l.y > hi) continue;
    svg.append(s("line", { x1: P.l, x2: w - P.r, y1: Y(l.y), y2: Y(l.y), stroke: l.color, "stroke-dasharray": "4 3", "stroke-width": 1.2 }));
    const t = s("text", { x: w - P.r - 2, y: Y(l.y) - 3, "text-anchor": "end", class: "ax mark", fill: l.color }); t.textContent = l.label; svg.append(t);
  }
  return svg;
}

/** Donut chart. parts [{label, value, color}] */
export function donut(parts, { size = 150, hole = 0.6 } = {}) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  const R = size / 2, r = R * hole;
  const svg = s("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: "donut", role: "img", "aria-label": "allocation" });
  let a0 = -Math.PI / 2;
  for (const p of parts) {
    const frac = Math.max(0, p.value) / total; if (!frac) continue;
    const a1 = a0 + frac * Math.PI * 2;
    if (frac > 0.9999) { svg.append(s("circle", { cx: R, cy: R, r: (R + r) / 2, fill: "none", stroke: p.color, "stroke-width": R - r })); break; }
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const P = (ang, rad) => `${R + rad * Math.cos(ang)},${R + rad * Math.sin(ang)}`;
    svg.append(s("path", { d: `M${P(a0, R)}A${R},${R} 0 ${large} 1 ${P(a1, R)}L${P(a1, r)}A${r},${r} 0 ${large} 0 ${P(a0, r)}Z`, fill: p.color }));
    a0 = a1;
  }
  const legend = h("ul", { class: "legend-list" }, parts.map((p) => h("li", {}, h("i", { style: `background:${p.color}` }), `${p.label} `, h("b", {}, pct((Math.max(0, p.value) / total) * 100, 1, false)))));
  return h("div", { class: "donutwrap" }, svg, legend);
}

/** Horizontal meter 0..100 (risk/regret). */
export function meter(value, { label = "", left = "Low", right = "High", invert = false } = {}) {
  const v = Math.max(0, Math.min(100, value));
  return h("div", { class: "meter" + (invert ? " invert" : "") },
    h("div", { class: "meter-bar" }, h("i", { style: `left:${v}%` })),
    h("div", { class: "meter-labels" }, h("span", {}, left), h("b", {}, label), h("span", {}, right)));
}
export const PALETTE = ["#f7931a", "#7aa2ff", "#9dffb0", "#ff7ab6", "#ffd27a", "#62e3ff", "#c49bff", "#ff8a5c", "#b4b09f", "#5ce0a0"];
