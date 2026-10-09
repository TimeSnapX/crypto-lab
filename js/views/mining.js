import { h, card, money, btc, num, pct, cls, badge, field, input, select, val, stat, lineChart, duration, compact, date } from "../ui.js";
import { load, save } from "../store.js";
import { networkStats, btcPrice } from "../api.js";
import { miningEconomics, blockSubsidy, nextHalvingHeight, soloExpectedSeconds, soloChance, rng, expSample, TWO32 } from "../calc.js";

// Example values are ONLY used when every live source fails, and are labelled as such.
const EXAMPLE = { difficulty: 1.3e14, hashrate: 9.5e20, height: 970000, avgFeesBTC: 0.02, avgBlockTimeS: 600, priceAUD: 100000 };
const PRESETS = [
  { label: "Custom", th: null },
  { label: "Antminer S21 (200 TH/s, 3500 W)", th: 200, w: 3500 },
  { label: "Antminer S21 Pro (234 TH/s, 3510 W)", th: 234, w: 3510 },
  { label: "Antminer S19j Pro (104 TH/s, 3068 W)", th: 104, w: 3068 },
  { label: "Bitaxe-class home miner (1.2 TH/s, 18 W)", th: 1.2, w: 18 },
];
const DEF = { th: 200, w: 3500, kwh: 0.32, pool: 2, hw: 5000, growth: 2, useLive: true, difficulty: "", reward: "", price: "" };

export async function render(root, ctx) {
  const s = load("mining", DEF);
  let net = null, px = null;
  const inputs = card("Your miner");
  const netCard = card("Network (live)");
  const out = card("Results");
  const proj = card("24-month projection");
  const sim = card("Mining simulation");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Bitcoin mining"), h("p", {}, "Calculator with live network data, plus a block-finding simulation. Educational only; real results vary.")), inputs, netCard, out, proj, sim);

  const f = {
    preset: select({ "aria-label": "Hardware preset" }, PRESETS.map((p, i) => ({ value: String(i), label: p.label }))),
    th: input({ value: s.th }), w: input({ value: s.w }), kwh: input({ value: s.kwh }), pool: input({ value: s.pool }), hw: input({ value: s.hw }), growth: input({ value: s.growth }),
    difficulty: input({ value: s.difficulty, placeholder: "live" }), reward: input({ value: s.reward, placeholder: "live" }), price: input({ value: s.price, placeholder: "live" }),
  };
  f.preset.addEventListener("change", () => { const p = PRESETS[+f.preset.value]; if (p.th) { f.th.value = p.th; f.w.value = p.w; recalc(); } });
  inputs.append(field("Hardware preset (approx. manufacturer specs)", f.preset),
    h("div", { class: "grid2" }, field("Hashrate (TH/s)", f.th), field("Power draw (W)", f.w),
      field("Electricity (AUD/kWh)", f.kwh, "Default 0.32 ≈ SEQ residential flat rate; check your bill"), field("Pool fee %", f.pool),
      field("Hardware cost (AUD)", f.hw, "Example; enter what you paid"), field("Difficulty growth %/month", f.growth, "Assumption for projections")));
  Object.entries(f).forEach(([k, e]) => k !== "preset" && e.addEventListener("input", recalc));

  function current() {
    const live = !!(net?.data);
    const d = net?.data || EXAMPLE;
    const priceAUD = val(f.price) || px?.data?.aud || (ctx.price("bitcoin", "AUD")) || EXAMPLE.priceAUD;
    const priceLive = !val(f.price) && !!(px?.data?.aud || ctx.price("bitcoin", "AUD"));
    const subsidy = blockSubsidy(d.height);
    const reward = val(f.reward) || subsidy + (d.avgFeesBTC ?? 0);
    const difficulty = val(f.difficulty) || d.difficulty;
    return { live, d, priceAUD, priceLive, subsidy, reward, difficulty };
  }

  function paintNet() {
    const c = current();
    netCard.replaceChildren(h("h2", {}, "Network"), badge(net, { exampleLabel: "Offline: example values (edit below)" }),
      h("div", { class: "stats" },
        stat("Difficulty", compact(c.d.difficulty), c.live ? "" : "example value"), stat("Hashrate", `${num(c.d.hashrate / 1e18, 0)} EH/s`, c.live ? "" : "example value"),
        stat("Block height", c.d.height.toLocaleString("en-AU"), `subsidy ${c.subsidy} BTC${c.live ? "" : " · example"}`), stat("Avg fees/block", c.d.avgFeesBTC != null ? btc(c.d.avgFeesBTC, 4) : "—", c.live ? (c.d.avgFeesBTC != null ? "last 144 blocks" : "not provided by this source") : "example value"),
        stat("BTC price", money(c.priceAUD), c.priceLive ? `live · ${px?.source || "market"}` : "example / manual"),
        stat("Next retarget", c.d.difficultyChangePct != null ? pct(c.d.difficultyChangePct, 2) : "—", c.d.remainingBlocks ? `in ${c.d.remainingBlocks} blocks (estimate)` : "")),
      h("details", {}, h("summary", {}, "Override network values"), h("div", { class: "grid3" }, field("Difficulty", f.difficulty), field("Reward/block (BTC)", f.reward), field("BTC price (AUD)", f.price)), h("small", {}, "Leave blank to use live data.")));
  }

  function recalc() {
    const v = Object.fromEntries(["th", "w", "kwh", "pool", "hw", "growth"].map((k) => [k, val(f[k])]));
    save("mining", { ...v, difficulty: f.difficulty.value, reward: f.reward.value, price: f.price.value });
    const c = current();
    const e = miningEconomics({ hashrateTH: v.th, powerW: v.w, priceAUDkWh: v.kwh, poolFeePct: v.pool, difficulty: c.difficulty, rewardBTC: c.reward, btcPriceAUD: c.priceAUD, hardwareAUD: v.hw });
    const nh = nextHalvingHeight(c.d.height);
    const afterReward = blockSubsidy(nh) + (c.reward - c.subsidy);
    const eh = miningEconomics({ hashrateTH: v.th, powerW: v.w, priceAUDkWh: v.kwh, poolFeePct: v.pool, difficulty: c.difficulty, rewardBTC: afterReward, btcPriceAUD: c.priceAUD, hardwareAUD: v.hw });
    const row = (n, p) => h("tr", {}, h("td", {}, n), h("td", {}, btc(p.btc, 6)), h("td", {}, money(p.revenue)), h("td", {}, money(p.power)), h("td", { class: cls(p.profit) }, money(p.profit)));
    out.replaceChildren(h("h2", {}, "Results"), c.live && c.priceLive ? h("p", { class: "src live" }, h("span", { class: "dot" }), "Using live difficulty, fees and price") : h("p", { class: "src off" }, h("span", { class: "dot" }), "Some inputs are example values"),
      h("div", { class: "tablewrap" }, h("table", { "data-k": "mining-table" }, h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "BTC"), h("th", {}, "Revenue"), h("th", {}, "Power"), h("th", {}, "Profit"))),
        h("tbody", {}, row("Day", e.day), row("Month", e.month), row("Year", e.year)))),
      h("div", { class: "stats" },
        h("div", { class: "stat", "data-k": "breakeven" }, h("span", {}, "Break-even"), h("b", {}, isFinite(e.breakEvenDays) ? `${num(e.breakEvenDays, 0)} days` : "Never"), h("small", {}, "at today's numbers")),
        h("div", { class: `stat ${cls(e.roiYearPct)}`, "data-k": "roi" }, h("span", {}, "ROI / year"), h("b", {}, e.roiYearPct == null ? "—" : pct(e.roiYearPct, 1))),
        stat("Efficiency", `${num(e.jPerTH, 1)} J/TH`), stat("Break-even power price", `${money(e.breakEvenPowerPrice, "AUD", 3)}/kWh`)),
      h("h3", {}, `Halving effect (block ${nh.toLocaleString("en-AU")})`),
      h("p", {}, `Subsidy drops from ${c.subsidy} to ${blockSubsidy(nh)} BTC. Same difficulty and price: profit/day ${money(e.profitDay)} → `, h("b", { class: cls(eh.profitDay) }, money(eh.profitDay)), `. Break-even ${isFinite(eh.breakEvenDays) ? num(eh.breakEvenDays, 0) + " days" : "never"}.`),
      e.profitDay < 0 ? h("p", { class: "note bad" }, "This setup loses money on electricity alone at these numbers. Home mining in Australia usually does: power is expensive and difficulty keeps rising.") : null,
      h("p", { class: "note" }, "Solo odds: ", `expected time to find a block alone ≈ ${duration(soloExpectedSeconds(v.th, c.difficulty))}; chance in a year ${pct(soloChance(v.th, c.difficulty, 365) * 100, 4, false)}.`));
    paintProjection(v, c);
    paintNet();
  }

  function paintProjection(v, c) {
    // Month-by-month with difficulty growth and the halving on its estimated date.
    const months = 24, pts = [], hw = [];
    let cum = -v.hw, height = c.d.height, D = c.difficulty;
    const nh = nextHalvingHeight(height);
    const blocksPerMonth = 30.4375 * 86400 / (c.d.avgBlockTimeS || 600);
    let halvMonth = null;
    for (let m = 0; m <= months; m++) {
      pts.push([m, cum]);
      const subsidy = blockSubsidy(height), fees = c.reward - c.subsidy;
      const e = miningEconomics({ hashrateTH: v.th, powerW: v.w, priceAUDkWh: v.kwh, poolFeePct: v.pool, difficulty: D, rewardBTC: subsidy + fees, btcPriceAUD: c.priceAUD });
      cum += e.month.profit;
      if (halvMonth == null && height + blocksPerMonth >= nh) halvMonth = m + (nh - height) / blocksPerMonth;
      height += blocksPerMonth; D *= 1 + v.growth / 100;
    }
    proj.replaceChildren(h("h2", {}, "24-month projection"), h("p", { class: "muted" }, `Cumulative profit after hardware cost. Assumes BTC stays at ${money(c.priceAUD)} and difficulty grows ${v.growth}%/month (both will change).`),
      lineChart([{ name: "Cumulative profit (AUD)", color: "var(--amber)", pts, area: true }], { xfmt: (m) => `${Math.round(m)} mo`, hlines: [{ y: 0, label: "break-even", color: "#a6a3b3" }], marks: halvMonth != null ? [{ x: halvMonth, label: "halving" }] : [], zero: true }));
  }

  // ---------------------------------------------------------------- simulation
  const canvas = h("canvas", { class: "sim", width: 720, height: 380, "aria-label": "Mining simulation chart" });
  const simStats = h("div", { class: "stats" });
  const speed = select({ "aria-label": "Simulation speed" }, [{ value: "3600", label: "1 hour / sec" }, { value: "86400", label: "1 day / sec" }, { value: "604800", label: "1 week / sec" }, { value: "2629800", label: "1 month / sec" }]);
  speed.value = "86400";
  const share = input({ value: 1, "aria-label": "Hashrate multiplier" });
  let S = null, raf = null, last = 0, running = false;
  const playBtn = h("button", { class: "primary", onclick: () => (running ? pause() : play()) }, "▶ Start");
  sim.append(h("p", { class: "muted" }, "Blocks arrive randomly (a Poisson process: exponential gaps averaging 10 minutes at the current difficulty). Each block, you win it solo with probability = your share of network hashrate. In a pool you get that share of every block, minus the fee: smooth but smaller. Difficulty retargets every 2,016 blocks; the subsidy halves every 210,000."),
    h("div", { class: "row" }, playBtn, h("button", { onclick: () => { reset(); draw(); } }, "↺ Reset"), speed),
    field("Hashrate multiplier (try 1,000,000× to see solo blocks)", share), canvas, simStats);

  function reset() {
    const c = current(); const v = { th: val(f.th) * (val(share) || 1), pool: val(f.pool), growth: val(f.growth) };
    S = { t: 0, height: c.d.height, D: c.difficulty, N: c.d.hashrate || (c.difficulty * TWO32) / 600, H: v.th * 1e12, fee: v.pool / 100, growth: v.growth / 100, fees: c.reward - c.subsidy,
      epochStartT: 0, epochStartH: c.d.height - (c.d.height % 2016), solo: 0, soloBlocks: 0, pool: 0, nextBlock: 0, rand: rng(42), series: [[0, 0, 0]], marks: [], retargets: 0, blocks: 0 };
    S.epochStartT = -((c.d.height % 2016) * 600);
    S.nextBlock = expSample(S.rand, (S.D * TWO32) / S.N);
  }
  function step(dt) {
    const end = S.t + dt;
    while (S.nextBlock <= end) {
      S.t = S.nextBlock; S.height++; S.blocks++;
      // network hashrate grows continuously at `growth` per month
      S.N *= Math.pow(1 + S.growth, (S.t - (S.lastT || 0)) / 2629800); S.lastT = S.t;
      const reward = blockSubsidy(S.height) + S.fees;
      const p = S.H / (S.N + S.H);
      if (S.rand() < p) { S.solo += reward; S.soloBlocks++; S.marks.push({ t: S.t, kind: "solo" }); }
      S.pool += p * reward * (1 - S.fee);
      if (S.height % 210000 === 0) S.marks.push({ t: S.t, kind: "halving" });
      if (S.height % 2016 === 0) {
        const actual = S.t - S.epochStartT; const ratio = Math.max(0.25, Math.min(4, 1209600 / actual));
        S.D *= ratio; S.epochStartT = S.t; S.retargets++; S.lastRetarget = (ratio - 1) * 100; S.marks.push({ t: S.t, kind: "retarget" });
      }
      S.series.push([S.t, S.solo, S.pool]);
      S.nextBlock = S.t + expSample(S.rand, (S.D * TWO32) / (S.N + S.H));
    }
    S.t = end; S.series.push([S.t, S.solo, S.pool]);
    if (S.series.length > 4000) S.series = S.series.filter((_, i) => i % 2 === 0);
  }
  function draw() {
    const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const pts = S.series, tMax = Math.max(S.t, 86400), yMax = Math.max(1e-12, ...pts.map((p) => Math.max(p[1], p[2])));
    const X = (t) => 50 + (t / tMax) * (W - 60), Y = (y) => H - 30 - (y / yMax) * (H - 50);
    g.strokeStyle = "rgba(242,239,232,0.1)"; g.fillStyle = "#a6a3b3"; g.font = "18px system-ui";
    for (let i = 0; i <= 4; i++) { const y = Y((yMax * i) / 4); g.beginPath(); g.moveTo(50, y); g.lineTo(W - 10, y); g.stroke(); const v = (yMax * i) / 4; g.fillText(v === 0 ? "0" : v < 0.001 ? (v * 1e8).toFixed(0) + " sat" : v < 10 ? v.toFixed(4) + " BTC" : v.toFixed(1) + " BTC", 2, y - 3); }
    g.fillText(`${duration(tMax)} simulated`, W - 220, H - 6);
    for (const m of S.marks) {
      if (m.kind === "solo") continue;
      g.strokeStyle = m.kind === "halving" ? "#f7931a" : "rgba(122,162,255,0.35)"; g.lineWidth = m.kind === "halving" ? 3 : 1;
      g.beginPath(); g.moveTo(X(m.t), 10); g.lineTo(X(m.t), H - 30); g.stroke();
    }
    const line = (idx, col) => { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[idx])) : g.moveTo(X(p[0]), Y(p[idx])))); g.stroke(); };
    line(2, "#7aa2ff"); line(1, "#f7931a");
    g.fillStyle = "#f7931a"; for (const m of S.marks) if (m.kind === "solo") { g.beginPath(); g.arc(X(m.t), Y(S.series.find((p) => p[0] >= m.t)?.[1] || 0), 6, 0, 7); g.fill(); }
    g.fillStyle = "#f7931a"; g.fillText("■ solo", 60, 26); g.fillStyle = "#7aa2ff"; g.fillText("■ pool", 140, 26); g.fillStyle = "rgba(122,162,255,0.8)"; g.fillText("| retarget", 220, 26); g.fillStyle = "#f7931a"; g.fillText("| halving", 330, 26);
    const nh = nextHalvingHeight(S.height);
    simStats.replaceChildren(stat("Simulated", duration(S.t)), stat("Height", S.height.toLocaleString("en-AU"), `${S.blocks} network blocks`),
      stat("Solo", btc(S.solo, 8), `${S.soloBlocks} blocks found`), stat("Pool", btc(S.pool, 8), "steady payouts"),
      stat("Difficulty", compact(S.D), S.retargets ? `${S.retargets} retargets, last ${pct(S.lastRetarget, 2)}` : "no retarget yet"), stat("Next halving", `${(nh - S.height).toLocaleString("en-AU")} blocks`));
  }
  function frame(ts) {
    if (!running) return;
    const dt = Math.min(0.1, (ts - (last || ts)) / 1000); last = ts;
    step(dt * +speed.value);
    draw();
    raf = requestAnimationFrame(frame);
  }
  function play() { running = true; last = 0; playBtn.textContent = "⏸ Pause"; raf = requestAnimationFrame(frame); }
  function pause() { running = false; cancelAnimationFrame(raf); playBtn.textContent = "▶ Resume"; }
  share.addEventListener("change", () => { reset(); draw(); });

  recalc(); reset(); draw();
  const [n, p] = await Promise.all([networkStats(), btcPrice()]);
  net = n; px = p;
  recalc(); reset(); draw();
  return () => { running = false; cancelAnimationFrame(raf); };
}
