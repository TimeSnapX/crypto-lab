import { h, card, money, num, pct, field, input, select, val, lineChart, stat } from "../ui.js";
import { load, save } from "../store.js";
import { compound, impermanentLoss, lpVsHold, incomeStack, RISK_HAIRCUT, aprToApy } from "../calc.js";
import { METHODS } from "../passive-data.js";

const range = (m) => m.rangeText || `${m.lo}–${m.hi}%/yr`;
const riskTag = (r) => h("span", { class: `risk r${r}` }, `Risk ${r}/5`);

export async function render(root) {
  const comp = card("Compounding calculator");
  const il = card("Impermanent loss calculator");
  const stack = card("Income stack planner");
  const cmp = card("Side-by-side comparison");
  const methods = card("All the ways to earn with crypto");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Passive income"), h("p", {}, "Every common method, how it works and what can go wrong.")),
    h("p", { class: "note" }, "All yield ranges are illustrative ranges, not guarantees. They change daily and higher yield always means higher risk. Rewards are generally taxable income in Australia."),
    comp, stack, cmp, il, methods);

  // compounding
  const c = load("compound", { principal: 10000, apy: 5, years: 10, perYear: 12, contribution: 200 });
  const cf = { principal: input({ value: c.principal }), apy: input({ value: c.apy }), years: input({ value: c.years }), contribution: input({ value: c.contribution }), perYear: select({ value: String(c.perYear) }, [{ value: "1", label: "Yearly" }, { value: "12", label: "Monthly" }, { value: "52", label: "Weekly" }, { value: "365", label: "Daily" }]) };
  const cout = h("div");
  const ccalc = () => {
    const v = { principal: val(cf.principal), apy: val(cf.apy), years: Math.min(60, val(cf.years)), contribution: val(cf.contribution), perYear: +cf.perYear.value }; save("compound", v);
    const r = compound({ principal: v.principal, apyPct: v.apy, years: v.years, perYear: v.perYear, contribution: v.contribution, contributionPerYear: Math.min(12, v.perYear) });
    cout.replaceChildren(h("div", { class: "stats" }, h("div", { class: "stat", "data-k": "final" }, h("span", {}, "Final balance"), h("b", {}, money(r.final))), stat("You put in", money(r.contributed)), h("div", { class: "stat up", "data-k": "interest" }, h("span", {}, "Earned"), h("b", {}, money(r.interest))), stat("Monthly income at end", money((r.final * v.apy) / 100 / 12))),
      lineChart([{ name: "Balance", color: "var(--amber)", pts: r.series.map((p) => [p.t, p.bal]), area: true }, { name: "Contributed", color: "#7aa2ff", pts: r.series.map((p) => [p.t, p.contributed]) }], { xfmt: (t) => `${Math.round(t)}y`, zero: true }),
      h("small", {}, `APY is the effective yearly rate. ${v.apy}% APR compounded daily = ${num(aprToApy(v.apy, 365), 3)}% APY.`));
  };
  Object.values(cf).forEach((e) => e.addEventListener("input", ccalc));
  comp.append(h("div", { class: "grid2" }, field("Starting amount (AUD)", cf.principal), field("APY %", cf.apy), field("Years", cf.years), field("Add each month (AUD)", cf.contribution), field("Compounding", cf.perYear)), cout);
  ccalc();

  // income stack
  const st = load("stack", { items: [{ id: "staking", amount: 5000, apy: 3.5 }, { id: "stable", amount: 3000, apy: 5 }, { id: "satsback", amount: 1000, apy: 1 }] });
  const sout = h("div"), list = h("div");
  const paintStack = () => {
    save("stack", st);
    list.replaceChildren(...st.items.map((it, i) => {
      const m = METHODS.find((x) => x.id === it.id);
      const sel = select({ value: it.id, "aria-label": "Method" }, METHODS.map((x) => ({ value: x.id, label: x.name })));
      const amt = input({ value: it.amount, "aria-label": "Amount" }), apy = input({ value: it.apy, "aria-label": "APY" });
      sel.addEventListener("change", () => { it.id = sel.value; it.apy = METHODS.find((x) => x.id === sel.value).apy; paintStack(); });
      amt.addEventListener("input", () => { it.amount = val(amt); calcStack(); }); apy.addEventListener("input", () => { it.apy = val(apy); calcStack(); });
      return h("div", { class: "method" }, h("header", {}, sel, riskTag(m.risk)), h("div", { class: "grid2" }, field("Amount (AUD)", amt), field("APY % (your estimate)", apy)), h("button", { class: "small", onclick: () => { st.items.splice(i, 1); paintStack(); } }, "Remove"));
    }));
    calcStack();
  };
  const calcStack = () => {
    save("stack", st);
    const r = incomeStack(st.items.map((it) => ({ amount: it.amount, apyPct: it.apy, risk: METHODS.find((x) => x.id === it.id).risk })));
    sout.replaceChildren(h("div", { class: "stats" }, stat("Capital", money(r.capital)), h("div", { class: "stat", "data-k": "stack-month" }, h("span", {}, "Monthly"), h("b", {}, money(r.monthly)), h("small", {}, `${money(r.yearly)}/yr`)),
      stat("Blended APY", pct(r.blendedApy, 2, false)), h("div", { class: "stat", "data-k": "stack-weighted" }, h("span", {}, "Risk-weighted"), h("b", {}, money(r.weightedMonthly)), h("small", {}, `${money(r.weightedYearly)}/yr`))),
      h("small", {}, `Risk-weighted applies a haircut by risk rating (1→${RISK_HAIRCUT[1] * 100}%, 2→${RISK_HAIRCUT[2] * 100}%, 3→${RISK_HAIRCUT[3] * 100}%, 4→${RISK_HAIRCUT[4] * 100}%, 5→${RISK_HAIRCUT[5] * 100}%) as a rough reminder that risky yield often doesn't arrive. It ignores price changes in the coins themselves.`));
  };
  stack.append(h("p", { class: "muted" }, "Combine methods to see a total. Edit the APYs to what you can actually get."), list, h("button", { onclick: () => { st.items.push({ id: "lending", amount: 1000, apy: 4 }); paintStack(); } }, "＋ Add method"), sout);
  paintStack();

  // comparison table
  cmp.append(h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Method"), h("th", {}, "Illustrative range"), h("th", {}, "Risk"), h("th", {}, "Liquidity"))),
    h("tbody", {}, METHODS.map((m) => h("tr", {}, h("td", {}, m.name), h("td", {}, range(m)), h("td", {}, riskTag(m.risk)), h("td", {}, h("small", {}, m.liquidity))))))),
    h("small", {}, "Illustrative ranges, not guarantees."));

  // IL
  const ilf = { value: input({ value: 10000 }), p0: input({ value: 1 }), p1: input({ value: 2 }), fee: input({ value: 10 }), days: input({ value: 365 }) };
  const ilout = h("div");
  const ilcalc = () => {
    const r = val(ilf.p1) / (val(ilf.p0) || 1);
    const x = lpVsHold(val(ilf.value), r);
    const fees = val(ilf.value) * (val(ilf.fee) / 100) * (val(ilf.days) / 365);
    const pts = []; for (let k = -2; k <= 2.0001; k += 0.05) { const rr = 2 ** k; pts.push([rr, impermanentLoss(rr) * 100]); }
    ilout.replaceChildren(h("div", { class: "stats" }, h("div", { class: "stat down", "data-k": "il" }, h("span", {}, "Impermanent loss"), h("b", {}, pct(x.ilPct, 2))), stat("If held", money(x.hold)), stat("In the pool", money(x.lp)), h("div", { class: `stat ${x.diff + fees >= 0 ? "up" : "down"}` }, h("span", {}, "Pool + fees vs hold"), h("b", {}, money(x.diff + fees)), h("small", {}, `fees ≈ ${money(fees)}`))),
      lineChart([{ name: "IL %", color: "#ff6b6b", pts }], { xfmt: (v) => `${num(v, 2)}×`, yfmt: (v) => `${num(v, 0)}%`, legend: true, marks: [{ x: r, label: "you" }] }),
      h("p", { class: "mono" }, "IL = 2·√r ÷ (1 + r) − 1, r = price change of token A vs token B"));
  };
  Object.values(ilf).forEach((e) => e.addEventListener("input", ilcalc));
  il.append(h("p", { class: "muted" }, "For a 50/50 pool (Uniswap v2 style). Price ratio = how much token A changed relative to token B."), h("div", { class: "grid2" }, field("Deposit (AUD)", ilf.value), field("Token A price at deposit", ilf.p0), field("Token A price now", ilf.p1), field("Fee APR %", ilf.fee), field("Days in pool", ilf.days)), ilout);
  ilcalc();

  // cards
  methods.append(...METHODS.map((m) => h("article", { class: "method", "data-method": m.id }, h("header", {}, h("b", {}, m.name), riskTag(m.risk)),
    h("p", {}, m.how), h("p", {}, h("span", { class: "tag ex" }, `${range(m)} · illustrative, not a guarantee`)), h("p", { class: "muted" }, h("b", {}, "Risks: "), m.risks))));
}
