// Hand-checked maths. Run: node tests/unit.mjs
import * as C from "../js/calc.js";
import { validateAddress, sha256 } from "../js/btcaddr.js";
let fails = 0, n = 0;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
function eq(name, got, want, tol) { n++; const ok = got === want || (typeof want === "number" && near(got, want, tol)); if (!ok) fails++; console.log(`${ok ? "✓" : "✗"} ${name}: ${got}${ok ? "" : ` (want ${want})`}`); }

// --- Mining. 100 TH/s, difficulty 1e14, reward 3.125 BTC:
// BTC/day = 1e14 H/s * 86400 * 3.125 / (1e14 * 2^32) = 270000 / 4294967296 = 6.28643e-5
const m = C.miningEconomics({ hashrateTH: 100, powerW: 3000, priceAUDkWh: 0.3, poolFeePct: 0, difficulty: 1e14, rewardBTC: 3.125, btcPriceAUD: 100000, hardwareAUD: 3000 });
eq("mining BTC/day", m.btcDay, 270000 / 4294967296);
eq("mining revenue/day (A$6.2864)", m.revenueDay, 6.286427378654480);
eq("mining power cost/day = 3kW*24h*0.30 = A$21.60", m.powerDay, 21.6);
eq("mining profit/day", m.profitDay, 6.28642737865448 - 21.6);
eq("mining break-even never (loss)", m.breakEvenDays, Infinity);
const m2 = C.miningEconomics({ hashrateTH: 100, powerW: 1000, priceAUDkWh: 0.1, poolFeePct: 2, difficulty: 1e14, rewardBTC: 3.125, btcPriceAUD: 200000, hardwareAUD: 1000 });
// btc/day net = 6.28643e-5 * 0.98 = 6.16070e-5; revenue = 12.32141; power = 2.4; profit = 9.92141; break-even = 100.79 days
eq("mining pool fee 2% BTC/day", m2.btcDay, (270000 / 4294967296) * 0.98);
eq("mining break-even days", m2.breakEvenDays, 1000 / ((270000 / 4294967296) * 0.98 * 200000 - 2.4));
eq("mining yearly profit = 365 × daily", m2.year.profit, m2.profitDay * 365);
eq("block subsidy h=970615", C.blockSubsidy(970615), 3.125);
eq("block subsidy after halving h=1,050,000", C.blockSubsidy(1050000), 1.5625);
eq("block subsidy genesis", C.blockSubsidy(0), 50);
eq("next halving from 970615", C.nextHalvingHeight(970615), 1050000);
eq("solo expected seconds 1 TH/s @ D=1e12 = 2^32 s", C.soloExpectedSeconds(1, 1e12), 4294967296);

// --- Leverage. Long 10x at 100k, MMR 0.5%: 100000*0.9/0.995 = 90452.2613; short: 110000/1.005 = 109452.7363
eq("liq long 10x", C.liquidationPrice("long", 100000, 10, 0.5), 90452.26130653266);
eq("liq short 10x", C.liquidationPrice("short", 100000, 10, 0.5), 109452.73631840796);
eq("liq long 100x (MMR 0)", C.liquidationPrice("long", 100000, 100, 0), 99000);
eq("liq long 1x (MMR 0) = 0", C.liquidationPrice("long", 100000, 1, 0), 0);
// Long $100 margin 10x at 100k → qty 0.01; exit 110k → gross +100; fees 0.05%: 1000*0.0005 + 0.01*110000*0.0005 = 0.5 + 0.55 = 1.05; funding 0.01% × 2 intervals (17h) = 0.2
const t = C.closeTrade({ side: "long", margin: 100, leverage: 10, entry: 100000, exit: 110000, feePct: 0.05, fundingPct: 0.01, hoursHeld: 17 });
eq("trade qty", t.qty, 0.01); eq("trade gross P&L", t.gross, 100); eq("trade fees", t.fees, 1.05); eq("trade funding", t.funding, 0.2); eq("trade net", t.net, 98.75); eq("trade ROE %", t.roePct, 98.75);
eq("short P&L at 95k (qty 0.02)", C.pnl("short", 0.02, 100000, 95000), 100);
const ps = C.positionSize({ account: 10000, riskPct: 2, maxRisk: 100, entry: 100000, stop: 98000 });
eq("position size: risk capped at $100", ps.risk, 100); eq("position size qty = 100/2000", ps.qty, 0.05); eq("position size notional", ps.notional, 5000);

// --- Tokenomics
const B = [{ key: "team", pct: 20, tgePct: 0, cliff: 12, vest: 24 }, { key: "community", pct: 50, tgePct: 10, cliff: 0, vest: 10 }, { key: "liquidity", pct: 30, tgePct: 100, cliff: 0, vest: 0 }];
const vs = C.vestingSchedule(1000, B, 48);
// m0: team 0, community 50, liquidity 300 → 350. m5: community 50 + 450*0.5 = 275 → 575. m12: team 0 (cliff), comm 500 → 800. m24: team 200*0.5=100 → 900. m36: 1000
eq("vesting m0", vs[0].circ, 350); eq("vesting m5", vs[5].circ, 575); eq("vesting m12", vs[12].circ, 800); eq("vesting m24", vs[24].circ, 900); eq("vesting m36", vs[36].circ, 1000); eq("vesting m48", vs[48].circ, 1000);
eq("unlocked fraction before cliff", C.unlockedFraction(11, { tgePct: 0, cliff: 12, vest: 24 }), 0);
const hl = C.tokenomicsHealth({ buckets: B, model: "fixed", supply: 1000 });
eq("tokenomics sum = 100", hl.sum, 100);
eq("tokenomics TGE % = 35", hl.tgePct, 35);
const bad = C.tokenomicsHealth({ buckets: [{ key: "team", pct: 40, tgePct: 100, cliff: 0, vest: 0 }, { key: "community", pct: 50, tgePct: 0, cliff: 0, vest: 10 }], model: "fixed", supply: 1 });
// sum 90 (−30), team>20 (−20), no vesting (−20), tge 40% (no), liquidity<5 (−10) → 20
eq("bad tokenomics score", bad.score, 20);
eq("FDV", C.marketCaps(0.05, 350e6, 1e9).fdv, 5e7); eq("market cap", C.marketCaps(0.05, 350e6, 1e9).marketCap, 1.75e7);
eq("inflation 5% for 2y", C.supplyAt(2, { supply: 100, model: "inflationary", inflationPct: 5 }), 110.25);
eq("burn 2% for 1y", C.supplyAt(1, { supply: 100, model: "deflationary", burnPct: 2 }), 98);

// --- What if: 2 coins bought 10k, sold 30k, now 60k
const w = C.whatIf({ amount: 2, buyPrice: 10000, sellPrice: 30000, nowPrice: 60000 });
eq("whatif sold", w.sold, 60000); eq("whatif now", w.now, 120000); eq("whatif missed", w.missed, 60000); eq("whatif missed %", w.missedPct, 100); eq("whatif if-held %", w.ifHeldPct, 500);

// --- Compounding: 1000 at 10% APY yearly for 2 years = 1210; monthly compounding at effective 10% APY also = 1210
eq("compound yearly", C.compound({ principal: 1000, apyPct: 10, years: 2, perYear: 1 }).final, 1210);
eq("compound monthly (effective APY)", C.compound({ principal: 1000, apyPct: 10, years: 2, perYear: 12 }).final, 1210, 1e-9);
// 0% with 100/month for 1 year = 1200 contributed
eq("compound contributions", C.compound({ principal: 0, apyPct: 0, years: 1, perYear: 12, contribution: 100 }).final, 1200);
eq("APR 12% monthly → APY", C.aprToApy(12, 12), 12.682503013196977);

// --- CGT: cost 10,000 + fees, proceeds 25,000; held > 12 months
eq("CGT discount: bought 2023-07-01, sold 2024-07-01 → NOT eligible", C.cgtDiscountEligible("2023-07-01", "2024-07-01"), false);
eq("CGT discount: sold 2024-07-02 → eligible", C.cgtDiscountEligible("2023-07-01", "2024-07-02"), true);
const g = C.cgt({ cost: 10000, proceeds: 25000, buyDate: "2023-07-01", sellDate: "2024-07-02" });
eq("CGT gross gain", g.gross, 15000); eq("CGT discount", g.discount, 7500); eq("CGT net", g.net, 7500);
const g2 = C.cgt({ cost: 10000, costFees: 100, proceeds: 25000, saleFees: 100, buyDate: "2024-01-01", sellDate: "2024-06-01", priorLosses: 4800 });
eq("CGT short-term with fees and losses: net", g2.net, 10000);
const g3 = C.cgt({ cost: 10000, proceeds: 25000, buyDate: "2020-01-01", sellDate: "2024-01-01", priorLosses: 5000 });
eq("CGT losses before discount: (15000-5000)/2", g3.net, 5000);
eq("income tax 2026-27 on $85,000", C.incomeTax(85000, C.TAX_TABLES["2026-27"]), (45000 - 18200) * 0.15 + (85000 - 45000) * 0.30);
eq("income tax 2024-25 on $200,000", C.incomeTax(200000, C.TAX_TABLES["2024-25"]), 26800 * 0.16 + 90000 * 0.3 + 55000 * 0.37 + 10000 * 0.45);

// --- Impermanent loss: r=4 → 2*2/5-1 = -0.2 ; r=2 → 2*1.41421356/3-1 = -0.0571909584 ; r=1 → 0
eq("IL r=4", C.impermanentLoss(4), -0.2); eq("IL r=2", C.impermanentLoss(2), -0.05719095841793653); eq("IL r=1", C.impermanentLoss(1), 0); eq("IL r=0.25", C.impermanentLoss(0.25), -0.2);
const lp = C.lpVsHold(1000, 4); eq("LP value r=4 = 1000*2", lp.lp, 2000); eq("hold value r=4 = 500*4+500", lp.hold, 2500);

// --- DCA vs lump: prices 100, 50, 100 every 1 → DCA 300 total, units 1+2+1 = 4 → 400; lump 3 units → 300
const d = C.dcaVsLump([{ t: 0, price: 100 }, { t: 1, price: 50 }, { t: 2, price: 100 }], { total: 300, every: 1 });
eq("DCA value", d.dcaValue, 400); eq("lump value", d.lumpValue, 300); eq("DCA avg price", d.dcaAvgPrice, 75);
// --- Fees: 1000, 0.5% fee, 1% spread, 0.1% slip, $2 flat → 5 + 5 + 1 + 2 = 13
eq("trade cost total", C.tradeCost({ amount: 1000, feePct: 0.5, spreadPct: 1, slippagePct: 0.1, flatFee: 2 }).total, 13);
eq("P&L with fees", C.profitLoss({ qty: 1, buy: 100, sell: 200, feePct: 1 }).pnl, 198 - 101);
// --- Rebalance: 75/25 → 50/50 of 1000: sell 250 A, buy 250 B
const rb = C.rebalance([{ key: "a", value: 750 }, { key: "b", value: 250 }], { a: 50, b: 50 });
eq("rebalance A trade", rb[0].trade, -250); eq("rebalance B trade", rb[1].trade, 250);
const is = C.incomeStack([{ amount: 10000, apyPct: 5, risk: 1 }, { amount: 10000, apyPct: 10, risk: 5 }]);
eq("income stack yearly", is.yearly, 1500); eq("income stack monthly", is.monthly, 125); eq("income stack risk-weighted yearly", is.weightedYearly, 500 * 0.95 + 1000 * 0.3);
eq("token risk worst-case", C.tokenRisk({ liquidityLocked: false, verified: false, canMint: true, sellTax: 20, top10: 80, anonTeam: true, audit: false, ageDays: 1, liquidityUSD: 100 }).score, 100);

// --- Addresses
eq("sha256('abc')", Buffer.from(sha256(new TextEncoder().encode("abc"))).toString("hex"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
for (const [a, ty] of [["1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "p2pkh"], ["34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo", "p2sh"], ["bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "p2wpkh"], ["bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", "p2wsh"], ["bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", "p2tr"]])
  eq(`address ${a.slice(0, 10)}… type`, validateAddress(a).type, ty);
eq("bad checksum rejected", validateAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb").valid, false);
eq("bech32m-for-v0 rejected", validateAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5").valid, false);
eq("testnet rejected", validateAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx").valid, false);
eq("WIF private key flagged", validateAddress("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ").danger, true);
eq("seed phrase flagged", validateAddress("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about").danger, true);
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
