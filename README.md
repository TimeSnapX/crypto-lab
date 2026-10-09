# Crypto Lab

An all-in-one, phone-first crypto **learning** app: real prices, paper money.
Live: https://timesnapx.github.io/crypto-lab/ (installable as a Chrome app).

**Educational only. Not financial advice.** Crypto Lab never connects to wallets, never asks for seed
phrases or private keys and never places real trades. Every trade and investment is paper money.
A Content-Security-Policy limits network access to the read-only APIs below.

## Sections
- **Home**: live BTC price, Fear & Greed, halving countdown, links to everything.
- **Markets**: top coins in AUD and USD with 24h change and 7-day sparklines, watchlist, in-app price alerts, BTC/sats/AUD/USD converter.
- **Paper portfolio**: A$100k paper cash, buy/sell at live prices, P&L, allocation donut, history, rebalancer, JSON export/import.
- **Trade (leverage sim)**: paper USD-margined perpetuals, long/short 1-100x, isolated margin, liquidation price, fees and funding (editable), SL/TP, live P&L on 10 s price refreshes, trade history and win rate, risk meter, liquidation heat table, position-size calculator (max $ risk rule), **replay mode** on historical 1h candles.
- **Mining**: calculator (hashrate, power, AUD/kWh, pool fee, hardware) with live difficulty, fees and price; day/month/year BTC, revenue, power, profit, break-even, ROI, halving effect, 24-month projection; Poisson block-finding simulation (solo vs pool, difficulty retargets, halvings, speed controls).
- **Token designer**: supply models (fixed/inflationary/deflationary), allocation pie, vesting (TGE/cliff/linear), emission curve, market cap/FDV, health score with warnings, price-vs-unlock scenarios, one-page HTML summary export. Sandbox only.
- **BTC addresses**: format validation (P2PKH, P2SH, P2WPKH, P2WSH, Taproot; checksums verified locally), balance/tx lookup, watch-only address book, famous examples, address types explained. Refuses pasted private keys/seed phrases.
- **What if I didn't sell**: historical prices (daily close × ECB AUD rate), live price now, regret meter, pick a past paper trade, famous examples.
- **Passive income**: 18 methods with how/risks/illustrative ranges/risk rating, comparison table, compounding calculator, income-stack planner (risk-weighted), impermanent-loss calculator.
- **Learn**: 10-lesson beginner path, 15-question quiz (saved), 50+ term glossary, trusted links.
- **Tools**: DCA vs lump sum (real history), Australian CGT calculator (12-month discount, losses, FY tax brackets), fees & slippage, scam checklist + token risk scorer, P&L, halving countdown + cycle chart, Fear & Greed, sats value + equal-share "rich list" comparison, compound interest.

## Data (keyless, read-only, cached 60 s with back-off and fallbacks)
| Use | Primary | Fallbacks |
| --- | --- | --- |
| Market table | CoinGecko `/coins/markets` | CoinPaprika `/tickers`, Binance public data 24h × Frankfurter FX |
| Live ticker (Trade) | Binance public data (`data-api.binance.vision`) | Coinbase Exchange |
| Candles / daily history | Binance public data | Coinbase Exchange, CoinGecko (≤365 d), mempool.space (BTC since 2010) |
| USD→AUD | Frankfurter (ECB) | CoinGecko, Coinbase |
| Network (difficulty, hashrate, fees, height) | mempool.space | blockchain.info |
| BTC price (light) | mempool.space | blockchain.info, CoinGecko |
| Address lookups | mempool.space | Blockstream Esplora |
| Fear & Greed | alternative.me | none |

Every live value shows its source and time. When all sources fail the app shows the last known
copy (labelled with its time) or, for the mining calculator only, clearly labelled example values.
Market prices are never invented.

## Develop / test
```
node tests/server.mjs 4180          # http://127.0.0.1:4180/crypto-lab/
node tests/unit.mjs                 # hand-checked maths
node tests/e2e.mjs                  # Playwright 412x915, mocked APIs, screenshots → test-results/
BASE=https://timesnapx.github.io/crypto-lab/ node tests/live.mjs   # live smoke test
```
No build step, no dependencies in the app (vanilla ES modules, inline SVG/canvas charts).
