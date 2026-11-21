# RyanAI Quant Lab — Trading, Forex and South African Research Plan

**Status:** research and implementation contract; proposed strategies are not approved trading signals.  
**Execution boundary:** historical backtests and isolated virtual paper trading only. No broker adapter, wallet custody, deposits, withdrawals, live order routing, leverage, or real-money execution is authorised or implemented by this plan.

## 1. Purpose and current baseline

RyanAI already has a separated Quant Lab and Trading Terminal foundation:

- Authenticated, owner-scoped market-data imports and experiment history.
- A deterministic Python historical engine with close-to-next-open fills, fees, slippage, drawdown and Sharpe reporting.
- A currently narrow SMA-crossover strategy implementation and bounded walk-forward evaluation.
- A distinct paper portfolio/order proposal flow with explicit confirmation, server-side risk limits, emergency stop and account isolation.
- A Forex workspace that lists USD/ZAR, EUR/USD, GBP/USD, XAU/USD and USD/JPY but explicitly has no connected quote feed.

This is not yet a complete FX trading system. In particular, the existing market-data importer is Alpaca daily bars; do not assume it supplies spot FX or USD/ZAR. A displayed market symbol is not a quote, a generated signal is not a fill, and a paper proposal is not an order execution.

## 2. What the reference products contribute

### Rumble Wallet: wallet and custody boundary, not a trading strategy

Rumble describes its wallet as non-custodial crypto infrastructure for tipping and sending/receiving supported crypto assets, with third-party on/off-ramp services. It is not an FX signal engine, quantitative strategy, broker, or substitute for a regulated trading account.

RyanAI may take only these architectural lessons:

- Keep asset custody and wallet ownership separate from strategy research and order execution.
- Make asset, network, destination, fee and transaction provenance explicit in any future wallet design.
- Never ask RyanAI models to handle seed phrases/private keys or move assets.
- Do not connect Rumble Wallet or implement wallet transfers as part of this Quant Lab increment.

Reference: https://rumble.support/help/what-is-rumble-wallet

### Elirox: DCA and GRID as bounded strategy hypotheses

Elirox publicly describes two automated strategy templates:

- **DCA:** staged entries over time or price levels.
- **GRID:** repeated buy/sell levels intended to harvest oscillations in range-bound markets.
- **Preset risk profiles:** convenient parameter bundles, not evidence that parameters are optimal or profitable.

RyanAI should model these as transparent, deterministic research strategies—not copy an external bot, broker connection, subscription model, or opaque AI preset. Both can accumulate adverse inventory: DCA can keep adding into a persistent decline; a grid can build a large one-sided position when price trends beyond its range. Therefore every simulation must have finite order count, maximum inventory/notional, explicit cancellation/exit rules, gap/slippage assumptions, and a portfolio-level kill switch. No martingale sizing, unlimited averaging-down, or hidden leverage.

Reference: https://elirox.com/help-center/common-questions/what-is-elirox-and-how-does-it-work/

## 3. South African research to adapt

These are research methods and institutions, not plug-and-play pretrained trading models. RyanAI must implement its own transparent baselines and independently validate them before any promotion.

### A. Stellenbosch University — heterogeneous strategy ensemble

Koegelenberg and van Vuuren (South African Journal of Industrial Engineering, 2023) study an intraday FX ensemble combining deterministic, probabilistic and machine-learning strategies, explicitly examining the return/risk trade-off.

**RyanAI adaptation:** build an ensemble only after each component has an independent baseline and common, timestamp-aligned inputs. The ensemble must disclose component votes, weights, calibration window and disagreement. Fit weights only on training data; freeze them for each out-of-sample fold. An ensemble must be allowed to abstain when components disagree or data is stale.

Reference: https://sajie.journals.ac.za/pub/article/view/2951  
DOI: https://doi.org/10.7166/34-3-2951

### B. University of South Africa — quantitative finance methods

UNISA's Quantitative Finance Research group describes work spanning stochastic processes, approximation theory, machine learning and control theory, with applications including derivatives pricing, portfolio optimisation and risk management.

**RyanAI adaptation:** prioritise risk and uncertainty models alongside directional signals: volatility forecasting, position sizing under risk constraints, portfolio optimisation and model uncertainty. This is a research direction, not an endorsement of a particular UNISA trading bot.

Reference: https://w2.unisa.ac.za/CW/SITES/CORPORAT/DEFAULT/COLLEGES/ECONOMIC/SCHOOLS_/SCHOOL_O/DEPARTME/RESEARCH.HTM

### C. Wits University — portfolio and fintech research

Wits University's Fintech Hub lists projects in tracking-error optimisation, asset-pricing optimisation, and a fair/transparent multi-asset trading app.

**RyanAI adaptation:** include benchmark-relative risk, tracking error, transparent portfolio constraints and auditability. These methods are more useful as portfolio/risk modules than as standalone buy/sell predictors.

Reference: https://www.wits.ac.za/sef/fintech-hub/strategic-projects/

### D. ZAR/USD volatility research candidate

A 2026 SSRN preprint compares GARCH/EGARCH, stochastic-volatility, LSTM and Random Forest approaches for ZAR/USD daily volatility forecasting. It is an emerging-market research candidate, not a validated production model and not proof that an LSTM will forecast the next move.

**RyanAI adaptation:** treat GARCH/EGARCH as interpretable volatility baselines; compare stochastic volatility and Random Forest/LSTM only under identical rolling out-of-sample splits. Evaluate volatility forecasts (e.g. QLIKE and MSE), calibration and regime stability. Volatility forecasts may scale risk; they must not be misrepresented as directional price predictions.

Reference: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7029358

## 4. Proposed strategy catalogue

All strategies start as `research_only`. No strategy becomes paper-enabled merely because its implementation or backtest passes.

| ID | Strategy | Intended market condition | Minimum controls |
| --- | --- | --- | --- |
| `sma_crossover` | Existing deterministic trend baseline | Persistent trend | Next-bar execution; fees and slippage |
| `rsi_mean_reversion` | RSI threshold with an optional higher-timeframe trend filter | Range / mean reversion | No averaging down; time stop; volatility filter |
| `dca_bounded` | Finite staged entries | Planned gradual exposure | Fixed maximum tranches, maximum notional, expiry and hard stop |
| `grid_bounded` | Finite symmetric or volatility-scaled grid | Range-bound market | Inventory cap, range-break shutdown, max levels and adverse-gap model |
| `garch_volatility` | GARCH/EGARCH volatility estimate | Risk overlay, not directional entry | Rolling fit, residual diagnostics, forecast uncertainty |
| `zar_fx_ensemble` | Deterministic + probabilistic + ML vote | FX research ensemble | Train-only calibration, component attribution, disagreement abstention |
| `zar_volatility_compare` | GARCH/EGARCH vs stochastic volatility vs RF/LSTM | USD/ZAR volatility study | Rolling OOS, QLIKE/MSE, regime splits, pinned model/data versions |

The catalogue is a roadmap, not a claim that these strategies are already implemented. Do not label a model “AI-powered”, “smart”, “South African”, or “profitable” without verifiable provenance and measured results.

## 5. FX and South African market requirements

Before FX backtests or paper sessions are enabled for a pair:

1. Obtain a documented, permitted historical FX dataset with provider, instrument definition, bid/ask or executable-price convention, timezone, sampling interval, coverage, missing-bar policy and retrieval timestamp.
2. Preserve bid and ask separately where available. Mid-price-only simulations must disclose that they omit executable spread.
3. Model spread, commission, slippage, overnight financing/swap, rollover timing, weekend gaps and market holidays. Do not reuse equity fee assumptions as FX costs.
4. Store quote and account currencies explicitly. Convert P&L, exposure and costs to ZAR using a timestamped FX conversion source; never silently mix ZAR, USD and pips.
5. Use correct pair precision, pip size, contract size and lot increments. Reject unknown instrument metadata.
6. Start with USD/ZAR as a research priority, not as a live quote claim. Validate EUR/USD and GBP/USD separately; do not assume their liquidity/cost profile matches USD/ZAR.
7. Add market-regime labels (trend, range, high-volatility, event/gap) using only information available at decision time.

The current Alpaca daily-bar path must not be relabelled as a verified spot-FX feed. A future provider adapter needs its own schema, tests, provenance and rate-limit handling before FX claims can be made.

## 6. Research and validation protocol

Every candidate must pass all applicable gates:

- **Deterministic definition:** entry, exit, sizing, rebalance, stop, expiry and abstention rules can be independently reproduced on a small fixture.
- **No look-ahead:** signal time and fill time are distinct; indicators use only completed data; fills occur no earlier than the next executable bar.
- **Chronological validation:** rolling walk-forward train/validation/test windows; no random shuffle of time series; purge overlapping labels where relevant.
- **Selection-bias controls:** report every tested configuration; use a holdout untouched by tuning; estimate probability of backtest overfitting or deflated Sharpe when the search is large.
- **Realistic costs:** spread, commissions, slippage, financing, rollover, gaps and rejected/partial fills where the data supports them.
- **Risk:** max drawdown, daily loss, expected shortfall/CVaR, volatility, concentration, gross/net exposure, turnover and tail/regime stress.
- **Robustness:** parameter sensitivity, bootstrap/Monte Carlo trade resampling, crisis/event periods, subperiods, and benchmark comparison.
- **Economic honesty:** show gross and net results, cost contribution, trade count, confidence intervals and negative results. A high Sharpe from a tiny sample is not evidence of an edge.
- **Reproducibility:** pin source data digest, strategy version, parameters, engine version, timezone, costs and random seeds (where used).
- **ZAR economics:** show estimated cost per accepted research run and paper outcome in ZAR; no paid data provider or infrastructure upgrade is implied.

Paper forward-testing is a separate gate after historical validation. Require a minimum predeclared observation window and sample size; report drift and failed/abstained signals. Paper results never prove live profitability.

## 7. AI role and ensemble safety

NVIDIA, Qwen, Logic and any future specialist model may help explain data, generate research hypotheses, summarise regime evidence or compare model reports. They must not:

- invent prices, candles, broker responses or fills;
- write directly to the paper ledger outside the validated application service;
- change risk limits, disable the emergency stop, or authorise themselves;
- access broker credentials, wallet secrets, seed phrases or payment rails;
- convert a generated recommendation into an order without the existing explicit user confirmation flow.

All numerical signal calculations, sizing, risk checks and simulated fills remain deterministic and server-enforced. LLM explanations are advisory and must cite the exact experiment/data provenance.

## 8. Regulatory and operational boundary

South African regulatory status must be checked for the exact provider, product and service before any future broker integration. Verify the entity and relevant permissions against the FSCA register; a marketing claim, affiliate relationship, influencer endorsement or “AI” label is not verification. Obtain appropriate legal/compliance review for derivatives, CFDs, forex, crypto and cross-border flows. Do not infer that crypto-wallet availability authorises forex dealing or investment advice.

SARB's published FAQ notes that crypto assets are not legal tender and highlights exchange-control restrictions, including restrictions on using crypto assets to externalise capital. Any future wallet/crypto or cross-border workflow therefore requires separate, current legal and regulatory review; it is outside this Quant Lab scope.

References:
- FSCA: https://www.fsca.co.za/
- SARB Financial Surveillance FAQ: https://www.reservebank.co.za/en/home/what-we-do/financial-surveillance/FinSurvFAQ

## 9. Implementation sequence

1. **Baseline audit:** inspect the exact main SHA, existing Quant Lab routes, Python engine, paper proposal flow, risk policy, schema and tests. Keep current paper-only boundary.
2. **Engine expansion:** add one strategy at a time (first RSI mean-reversion, then bounded DCA and bounded GRID), each with deterministic fixtures and no new external dependencies unless separately justified.
3. **FX data contract:** design provider-neutral FX bars/quotes with bid/ask, provenance, timestamp and pair metadata. Do not activate an unverified provider or add credentials.
4. **ZAR risk layer:** currency conversion, pip/lot precision, spread and financing models, portfolio exposure and daily-loss controls.
5. **South African research models:** implement interpretable volatility baselines, then the heterogeneous ensemble and optional ML comparators with pinned dependencies and offline evaluation.
6. **Terminal integration:** surface data freshness, model provenance, strategy state, cost assumptions, risk blocks, proposal review and audit history; distinguish research, paper and unavailable states.
7. **End-to-end acceptance:** exact-head tests, security scans, owner isolation, paper ledger reconciliation, emergency-stop tests and UI/API journeys.

Each increment should be a separate reviewed PR when it is independently coherent. Do not combine a broad “complete trading” claim with unimplemented data feeds or unverified model performance.

## 10. Acceptance criteria for this research increment

- [ ] The named reference products are described accurately and their boundaries are preserved.
- [ ] South African academic research is represented as methods to evaluate, not as downloadable or endorsed trading bots.
- [ ] Proposed strategy identifiers and risk requirements are documented.
- [ ] FX-specific market-data and ZAR accounting gaps are explicit.
- [ ] No live broker, real-money order, wallet custody, deposit/withdrawal, secret, production migration or deployment path is added.
- [ ] A future implementation PR includes strategy-level deterministic tests, exact-head CI/security evidence and human review.

**Current result:** this document is a research and architecture increment. It does not complete the Quant Lab, add FX quotes, implement the proposed strategies, or certify any model as profitable.
