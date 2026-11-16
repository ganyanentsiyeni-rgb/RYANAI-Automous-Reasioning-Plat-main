# RyanAI Quant Engine

A dependency-free Python 3.10+ research engine. It accepts caller-supplied daily OHLCV bars as JSON and runs a deterministic long-only SMA crossover backtest. Signals formed at a bar close execute no earlier than the next bar open. Fees and slippage are configurable and included in fills.

## Safety

- No broker, market-data provider, network, LLM, credential, or real-order integration.
- Historical input only; no synthetic/default market data is generated.
- Maximum 2 MB input and 2,500 bars per run.
- Only the explicitly implemented `sma_crossover` strategy is accepted.
- Results are educational simulations, not investment advice or a prediction.

## Test

`python3 -m unittest discover -s quant-engine/tests -v`

The API wrapper is responsible for authenticated access, durable user-scoped persistence, process timeouts, and input-size limits.


## Supported research strategies

- `sma_crossover`: deterministic long-only moving-average crossover.
- `rsi_mean_reversion`: deterministic long-only Wilder RSI baseline. It enters after a completed close at or below the oversold threshold and exits after a completed close at or above the overbought threshold; fills occur at the next bar open with configured fees and slippage. It does not short, average down, or use leverage.

RSI defaults are period 14, oversold 30 and overbought 70. RSI is supported for single-run historical backtests; walk-forward parameter selection remains SMA-only. Neither strategy is a recommendation or evidence of profitability.


## South African research-informed baseline

- `ar1_trend`: a dependency-free autoregressive AR(1) next-return forecast using completed closes. The forecast becomes a long-only trend signal with an optional return threshold. This is a research baseline, not a production prediction model.

The strategy is informed by South African USD/ZAR research comparing ARIMA/ARIMAX-GARCH, Random Forest, MLP, LSTM and related time-series methods. RyanAI currently implements the dependency-free AR(1) baseline while keeping heavier econometric/ML models as separately benchmarked candidates. No model is assumed profitable without rolling out-of-sample validation.


## Volatility research baseline

The engine exposes a separate `mode: "volatility"` analysis using completed daily closes:
- EWMA volatility with an explicit decay factor (default 0.94).
- Fixed-parameter GARCH(1,1) recursion with bounded alpha/beta parameters (defaults 0.08/0.90 and alpha + beta < 1).
- Daily and annualized next-bar volatility estimates with the full parameter provenance.

This is deliberately a transparent first-stage baseline, not maximum-likelihood-fitted GARCH and not EGARCH. EGARCH's asymmetric shock response, parameter fitting, forecast calibration and volatility-loss evaluation remain separate benchmark work. Volatility output is risk research only and does not create buy/sell instructions.


## EGARCH asymmetric-volatility research baseline

The separate `mode: "egarch"` analysis implements a fixed-parameter EGARCH(1,1) log-variance recursion. Its `egarch_gamma` parameter controls signed-shock asymmetry: a negative gamma makes negative standardized shocks increase forecast log variance more than equal-sized positive shocks. Alpha, beta and gamma are explicitly bounded; the output includes parameter provenance and next-daily-bar volatility.

This is not maximum-likelihood estimation, a calibrated production risk model, or a claim that leverage effects are stable across ZAR pairs or regimes. Parameters must be estimated and compared out of sample before any operational risk use. EGARCH remains a research-only output and does not generate trade instructions.
