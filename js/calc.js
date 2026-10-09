// Crypto Lab: pure maths. No DOM, no network, so it can be unit-tested in Node.
// Every formula here is hand-checked in tests/unit.mjs.

export const TWO32 = 4294967296;
export const HALVING_INTERVAL = 210000;
export const MAX_SUPPLY_BTC = 21e6;

/** Block subsidy (BTC) at a given height: 50 BTC halved every 210,000 blocks. */
export function blockSubsidy(height) {
  const epoch = Math.floor(height / HALVING_INTERVAL);
  if (epoch >= 64) return 0;
  return 50 / 2 ** epoch;
}
export function nextHalvingHeight(height) {
  return (Math.floor(height / HALVING_INTERVAL) + 1) * HALVING_INTERVAL;
}

/**
 * Mining economics.
 * hashrateTH: your TH/s; difficulty: network difficulty; rewardBTC: subsidy + avg fees per block;
 * powerW; priceAUDkWh; poolFeePct; btcPriceAUD; hardwareAUD.
 * Expected BTC/day = H * 86400 * reward / (D * 2^32), less pool fee.
 */
export function miningEconomics({ hashrateTH, powerW, priceAUDkWh, poolFeePct = 0, difficulty, rewardBTC, btcPriceAUD, hardwareAUD = 0 }) {
  const H = hashrateTH * 1e12;
  const grossBtcDay = (H * 86400 * rewardBTC) / (difficulty * TWO32);
  const btcDay = grossBtcDay * (1 - poolFeePct / 100);
  const revenueDay = btcDay * btcPriceAUD;
  const kWhDay = (powerW / 1000) * 24;
  const powerDay = kWhDay * priceAUDkWh;
  const profitDay = revenueDay - powerDay;
  const breakEvenDays = profitDay > 0 ? hardwareAUD / profitDay : Infinity;
  const roiYearPct = hardwareAUD > 0 ? ((profitDay * 365) / hardwareAUD) * 100 : null;
  // Electricity price at which profit is exactly zero.
  const breakEvenPowerPrice = kWhDay > 0 ? revenueDay / kWhDay : Infinity;
  const per = (k) => ({ btc: btcDay * k, revenue: revenueDay * k, power: powerDay * k, profit: profitDay * k });
  return {
    grossBtcDay, btcDay, revenueDay, kWhDay, powerDay, profitDay, breakEvenDays, roiYearPct, breakEvenPowerPrice,
    day: per(1), month: per(30.4375), year: per(365),
    jPerTH: hashrateTH > 0 ? powerW / hashrateTH : 0,
  };
}

/** Expected seconds for a solo miner to find one block: D * 2^32 / H. */
export function soloExpectedSeconds(hashrateTH, difficulty) {
  return (difficulty * TWO32) / (hashrateTH * 1e12);
}
/** Probability of at least one solo block in `days`. Poisson: 1 - e^(-λ). */
export function soloChance(hashrateTH, difficulty, days) {
  const lambda = (days * 86400) / soloExpectedSeconds(hashrateTH, difficulty);
  return 1 - Math.exp(-lambda);
}
/** Network hashrate (H/s) implied by difficulty and average block time (s). */
export function hashrateFromDifficulty(difficulty, blockTimeS = 600) {
  return (difficulty * TWO32) / blockTimeS;
}

/** Seeded PRNG (mulberry32) so simulations are reproducible in tests. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Exponential inter-arrival time with given mean. */
export function expSample(rand, mean) {
  return -Math.log(1 - rand()) * mean;
}

/**
 * Leverage (isolated margin, linear USD-margined perpetual).
 * Liquidation when equity = maintenance margin:
 *   long:  P = E (1 - 1/L) / (1 - mmr)
 *   short: P = E (1 + 1/L) / (1 + mmr)
 */
export function liquidationPrice(side, entry, leverage, mmrPct = 0.5) {
  const m = mmrPct / 100;
  if (side === "long") return Math.max(0, (entry * (1 - 1 / leverage)) / (1 - m));
  return (entry * (1 + 1 / leverage)) / (1 + m);
}
export function positionFromMargin(margin, leverage, entry) {
  const notional = margin * leverage;
  return { notional, qty: notional / entry };
}
/** Unrealised PnL before fees. */
export function pnl(side, qty, entry, price) {
  return side === "long" ? qty * (price - entry) : qty * (entry - price);
}
/** Full close-out maths with taker fees on open + close and funding paid per 8h interval. */
export function closeTrade({ side, margin, leverage, entry, exit, feePct = 0.05, fundingPct = 0.01, hoursHeld = 0 }) {
  const { notional, qty } = positionFromMargin(margin, leverage, entry);
  const gross = pnl(side, qty, entry, exit);
  const fees = notional * (feePct / 100) + qty * exit * (feePct / 100);
  const intervals = Math.floor(hoursHeld / 8);
  // Longs pay positive funding, shorts receive it.
  const funding = notional * (fundingPct / 100) * intervals * (side === "long" ? 1 : -1);
  const net = gross - fees - funding;
  return { notional, qty, gross, fees, funding, net, roePct: (net / margin) * 100 };
}
/** Distance from price to liquidation as a % of price (risk meter). */
export function liqDistancePct(side, price, liq) {
  return side === "long" ? ((price - liq) / price) * 100 : ((liq - price) / price) * 100;
}
/** Position size from fixed $ risk: qty = risk / |entry - stop|. */
export function positionSize({ account, riskPct, maxRisk = Infinity, entry, stop }) {
  const risk = Math.min((account * riskPct) / 100, maxRisk);
  const perUnit = Math.abs(entry - stop);
  const qty = perUnit > 0 ? risk / perUnit : 0;
  const notional = qty * entry;
  return { risk, qty, notional, minLeverage: account > 0 ? notional / account : 0, stopPct: (perUnit / entry) * 100 };
}

/** Uniswap v2 style impermanent loss for a price ratio r = new/old: 2√r/(1+r) − 1. */
export function impermanentLoss(r) {
  return (2 * Math.sqrt(r)) / (1 + r) - 1;
}
/** Value of an LP vs holding, starting from `value` split 50/50. */
export function lpVsHold(value, r) {
  const hold = (value / 2) * r + value / 2;
  const lp = value * Math.sqrt(r);
  return { hold, lp, diff: lp - hold, ilPct: impermanentLoss(r) * 100 };
}

/**
 * Compound growth with periodic contributions.
 * apyPct is converted to a per-period rate for n compounding periods per year.
 */
export function compound({ principal, apyPct, years, perYear = 12, contribution = 0, contributionPerYear = 12 }) {
  const rate = Math.pow(1 + apyPct / 100, 1 / perYear) - 1; // effective APY preserved
  const totalPeriods = Math.round(years * perYear);
  let bal = principal, contributed = principal;
  const series = [{ t: 0, bal, contributed }];
  const contribEvery = perYear / contributionPerYear;
  for (let i = 1; i <= totalPeriods; i++) {
    bal *= 1 + rate;
    if (contribution && Number.isInteger(i / contribEvery)) { bal += contribution; contributed += contribution; }
    series.push({ t: i / perYear, bal, contributed });
  }
  return { final: bal, contributed, interest: bal - contributed, series };
}
/** APR (simple, n compounds/yr) → APY. */
export function aprToApy(aprPct, n = 365) {
  return (Math.pow(1 + aprPct / 100 / n, n) - 1) * 100;
}

/** Tokenomics: fraction of a bucket unlocked at month m. */
export function unlockedFraction(m, { tgePct = 0, cliff = 0, vest = 0 }) {
  const tge = tgePct / 100;
  if (m < cliff) return tge;
  if (vest <= 0) return 1;
  return tge + (1 - tge) * Math.min(1, (m - cliff) / vest);
}
export function vestingSchedule(totalSupply, buckets, months = 48) {
  const rows = [];
  for (let m = 0; m <= months; m++) {
    const by = {};
    let circ = 0;
    for (const b of buckets) {
      const amt = totalSupply * (b.pct / 100) * unlockedFraction(m, b);
      by[b.key] = amt; circ += amt;
    }
    rows.push({ m, circ, by });
  }
  return rows;
}
/** Supply after `years` under fixed / inflationary / deflationary models. */
export function supplyAt(years, { supply, model = "fixed", inflationPct = 0, burnPct = 0 }) {
  if (model === "inflationary") return supply * Math.pow(1 + inflationPct / 100, years);
  if (model === "deflationary") return supply * Math.pow(1 - burnPct / 100, years);
  return supply;
}
export function marketCaps(price, circulating, totalSupply) {
  return { marketCap: price * circulating, fdv: price * totalSupply, floatPct: totalSupply ? (circulating / totalSupply) * 100 : 0 };
}
/** Tokenomics health score (0-100) with human warnings. */
export function tokenomicsHealth({ buckets, model, inflationPct = 0, supply }) {
  const warn = [];
  let score = 100;
  const get = (k) => buckets.find((b) => b.key === k) || { pct: 0, tgePct: 0, cliff: 0, vest: 0 };
  const sum = buckets.reduce((s, b) => s + Number(b.pct || 0), 0);
  if (Math.abs(sum - 100) > 0.01) { score -= 30; warn.push(`Allocations add up to ${round(sum, 2)}%, not 100%.`); }
  const team = get("team"), inv = get("investors"), comm = get("community"), liq = get("liquidity");
  if (team.pct > 20) { score -= 20; warn.push(`Team holds ${team.pct}% (over 20% is a common red flag).`); }
  if (team.pct > 0 && team.vest <= 0) { score -= 20; warn.push("Team tokens have no vesting."); }
  else if (team.pct > 0 && team.cliff < 6) { score -= 10; warn.push("Team cliff is under 6 months."); }
  if (inv.pct > 0 && inv.vest <= 0) { score -= 15; warn.push("Investor tokens have no vesting."); }
  const tge = vestingSchedule(supply || 1, buckets, 0)[0].circ / (supply || 1) * 100;
  if (tge > 50) { score -= 15; warn.push(`${round(tge, 1)}% of supply is unlocked at launch (huge unlocked supply).`); }
  if (tge < 5) { score -= 10; warn.push(`Only ${round(tge, 1)}% circulates at launch: low float, high FDV, heavy future unlock pressure.`); }
  if (liq.pct < 5) { score -= 10; warn.push("Liquidity under 5%: trading will be thin and slippage high."); }
  if (comm.pct < 20) { score -= 5; warn.push("Community allocation under 20%."); }
  if (model === "inflationary" && inflationPct > 10) { score -= 10; warn.push(`Inflation of ${inflationPct}%/yr dilutes holders fast.`); }
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 80 ? "Healthy" : score >= 60 ? "Some concerns" : score >= 40 ? "Risky" : "Red flags";
  return { score, grade, warnings: warn, sum, tgePct: tge };
}

/** "What if I didn't sell": compare what was sold vs holding to today. */
export function whatIf({ amount, buyPrice, sellPrice, nowPrice }) {
  const cost = amount * buyPrice;
  const sold = amount * sellPrice;
  const now = amount * nowPrice;
  return {
    cost, sold, now,
    realised: sold - cost,
    realisedPct: cost ? ((sold - cost) / cost) * 100 : 0,
    ifHeld: now - cost,
    ifHeldPct: cost ? ((now - cost) / cost) * 100 : 0,
    missed: now - sold, // positive = regret (would have more if held)
    missedPct: sold ? ((now - sold) / sold) * 100 : 0,
  };
}

/** Australian CGT: 50% discount if the asset is held at least 12 months (excluding buy and sell days). */
export function cgtDiscountEligible(buyDate, sellDate) {
  const b = new Date(buyDate + "T00:00:00Z"), s = new Date(sellDate + "T00:00:00Z");
  const threshold = new Date(Date.UTC(b.getUTCFullYear() + 1, b.getUTCMonth(), b.getUTCDate() + 1));
  return s >= threshold;
}
export function cgt({ cost, costFees = 0, proceeds, saleFees = 0, buyDate, sellDate, priorLosses = 0, individual = true }) {
  const costBase = cost + costFees;
  const capital = proceeds - saleFees;
  const gross = capital - costBase;
  if (gross <= 0) return { costBase, capital, gross, afterLosses: gross, eligible: cgtDiscountEligible(buyDate, sellDate), discount: 0, net: 0, lossCarried: -gross + priorLosses };
  const afterLosses = Math.max(0, gross - priorLosses);
  const lossCarried = Math.max(0, priorLosses - gross);
  const eligible = individual && cgtDiscountEligible(buyDate, sellDate);
  const discount = eligible ? afterLosses * 0.5 : 0;
  return { costBase, capital, gross, afterLosses, eligible, discount, net: afterLosses - discount, lossCarried };
}
/** Resident individual tax brackets (excluding Medicare levy). Edit if the law changes. */
export const TAX_TABLES = {
  "2024-25": [[18200, 0], [45000, 0.16], [135000, 0.30], [190000, 0.37], [Infinity, 0.45]],
  "2025-26": [[18200, 0], [45000, 0.16], [135000, 0.30], [190000, 0.37], [Infinity, 0.45]],
  "2026-27": [[18200, 0], [45000, 0.15], [135000, 0.30], [190000, 0.37], [Infinity, 0.45]],
};
export function incomeTax(income, table) {
  let tax = 0, prev = 0;
  for (const [top, rate] of table) {
    if (income > prev) tax += (Math.min(income, top) - prev) * rate;
    prev = top;
  }
  return tax;
}

/** DCA vs lump sum on a price series [{t, price}]. */
export function dcaVsLump(series, { total, every = 7 }) {
  if (!series.length) return null;
  const buys = series.filter((_, i) => i % every === 0);
  const each = total / buys.length;
  let units = 0;
  for (const b of buys) units += each / b.price;
  const last = series[series.length - 1].price;
  const lumpUnits = total / series[0].price;
  return {
    buys: buys.length, each, dcaUnits: units, dcaValue: units * last, dcaAvgPrice: total / units,
    lumpUnits, lumpValue: lumpUnits * last, lastPrice: last,
    dcaPct: ((units * last - total) / total) * 100, lumpPct: ((lumpUnits * last - total) / total) * 100,
  };
}

/** Effective cost of a trade with fee, spread and slippage, plus a flat network fee (all AUD). */
export function tradeCost({ amount, feePct = 0, spreadPct = 0, slippagePct = 0, flatFee = 0, price }) {
  const fee = amount * feePct / 100;
  const spread = amount * spreadPct / 200; // half the spread paid on one side
  const slip = amount * slippagePct / 100;
  const total = fee + spread + slip + flatFee;
  const effectivePrice = price ? price * (amount / (amount - total)) : null;
  return { fee, spread, slip, flatFee, total, pct: (total / amount) * 100, received: amount - total, effectivePrice };
}

/** Simple P&L with fees. */
export function profitLoss({ qty, buy, sell, feePct = 0 }) {
  const cost = qty * buy * (1 + feePct / 100);
  const proceeds = qty * sell * (1 - feePct / 100);
  return { cost, proceeds, pnl: proceeds - cost, pct: cost ? ((proceeds - cost) / cost) * 100 : 0 };
}

/** Rebalance: trades (in value) to reach target weights. */
export function rebalance(holdings, targets) {
  const total = holdings.reduce((s, h) => s + h.value, 0);
  const tsum = Object.values(targets).reduce((s, v) => s + Number(v || 0), 0) || 1;
  return holdings.map((h) => {
    const want = total * (Number(targets[h.key] || 0) / tsum);
    return { key: h.key, value: h.value, nowPct: total ? (h.value / total) * 100 : 0, targetPct: (Number(targets[h.key] || 0) / tsum) * 100, trade: want - h.value };
  });
}

/** Risk-weighted income: haircut by risk rating 1..5. */
export const RISK_HAIRCUT = { 1: 0.05, 2: 0.15, 3: 0.3, 4: 0.5, 5: 0.7 };
export function incomeStack(items) {
  let yearly = 0, weighted = 0, capital = 0;
  for (const it of items) {
    const y = it.amount * (it.apyPct / 100);
    yearly += y; capital += it.amount;
    weighted += y * (1 - (RISK_HAIRCUT[it.risk] ?? 0.5));
  }
  return { capital, yearly, monthly: yearly / 12, weightedYearly: weighted, weightedMonthly: weighted / 12, blendedApy: capital ? (yearly / capital) * 100 : 0 };
}

/** Token risk scorer: 0 (low) .. 100 (very high). */
export function tokenRisk(f) {
  let r = 0; const why = [];
  const add = (pts, msg) => { r += pts; why.push(msg); };
  if (!f.liquidityLocked) add(20, "Liquidity not locked: the team can pull it (rug pull).");
  if (!f.verified) add(10, "Contract source not verified.");
  if (f.canMint) add(15, "Owner can mint new tokens.");
  if (f.sellTax > 10) add(15, `Sell tax ${f.sellTax}% (possible honeypot).`);
  if (f.top10 > 50) add(15, `Top 10 wallets hold ${f.top10}%.`);
  if (f.anonTeam) add(5, "Anonymous team.");
  if (!f.audit) add(5, "No audit from a known firm.");
  if (f.ageDays < 30) add(10, "Token is under 30 days old.");
  if (f.liquidityUSD < 50000) add(5, "Liquidity under US$50k.");
  return { score: Math.min(100, r), why, level: r >= 60 ? "Very high" : r >= 35 ? "High" : r >= 15 ? "Medium" : "Lower" };
}

export function round(x, d = 2) { const k = 10 ** d; return Math.round(x * k) / k; }
