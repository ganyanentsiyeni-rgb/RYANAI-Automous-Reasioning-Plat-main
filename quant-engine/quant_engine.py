#!/usr/bin/env python3
"""Deterministic, dependency-free long-only SMA backtester for RyanAI.

Input and output are JSON on stdin/stdout. This module never fetches market data,
loads credentials, calls an LLM, connects to a broker, or places real orders.
Signals are calculated at close and filled at the following bar's open.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date
from statistics import mean, median, stdev


def _number(value: object, name: str, *, minimum: float = 0.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    result = float(value)
    if not math.isfinite(result) or result < minimum:
        raise ValueError(f"{name} must be finite and at least {minimum}")
    return result


def validate(payload: object) -> tuple[list[dict], dict]:
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object")
    bars = payload.get("bars")
    if not isinstance(bars, list) or not 30 <= len(bars) <= 2500:
        raise ValueError("bars must contain between 30 and 2500 OHLCV rows")
    normalized = []
    previous_date = None
    for index, item in enumerate(bars):
        if not isinstance(item, dict):
            raise ValueError(f"bars[{index}] must be an object")
        try:
            day = date.fromisoformat(item["date"])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"bars[{index}].date must be an ISO date") from None
        if previous_date is not None and day <= previous_date:
            raise ValueError("bar dates must be strictly increasing")
        previous_date = day
        row = {"date": day.isoformat()}
        for field in ("open", "high", "low", "close"):
            row[field] = _number(item.get(field), f"bars[{index}].{field}", minimum=0.000001)
        row["volume"] = _number(item.get("volume", 0), f"bars[{index}].volume")
        if row["high"] < max(row["open"], row["close"], row["low"]):
            raise ValueError(f"bars[{index}].high is inconsistent with OHLC values")
        if row["low"] > min(row["open"], row["close"], row["high"]):
            raise ValueError(f"bars[{index}].low is inconsistent with OHLC values")
        normalized.append(row)

    strategy = payload.get("strategy", "sma_crossover")
    if strategy not in ("sma_crossover", "rsi_mean_reversion", "ar1_trend"):
        raise ValueError("strategy must be sma_crossover, rsi_mean_reversion, or ar1_trend")
    fast = payload.get("fast_window", 5)
    slow = payload.get("slow_window", 20)
    if isinstance(fast, bool) or not isinstance(fast, int) or not 2 <= fast <= 50:
        raise ValueError("fast_window must be an integer between 2 and 50")
    if isinstance(slow, bool) or not isinstance(slow, int) or not fast < slow <= 200:
        raise ValueError("slow_window must be greater than fast_window and at most 200")
    rsi_period = payload.get("rsi_period", 14)
    if isinstance(rsi_period, bool) or not isinstance(rsi_period, int) or not 2 <= rsi_period <= 50:
        raise ValueError("rsi_period must be an integer between 2 and 50")
    ar1_window = payload.get("ar1_window", 60)
    if isinstance(ar1_window, bool) or not isinstance(ar1_window, int) or not 20 <= ar1_window <= 250:
        raise ValueError("ar1_window must be an integer between 20 and 250")
    ar1_signal_bps = _number(payload.get("ar1_signal_bps", 0), "ar1_signal_bps")
    if ar1_signal_bps > 1000:
        raise ValueError("ar1_signal_bps must not exceed 1000")
    rsi_oversold = _number(payload.get("rsi_oversold", 30), "rsi_oversold")
    rsi_overbought = _number(payload.get("rsi_overbought", 70), "rsi_overbought")
    if not 0 < rsi_oversold < rsi_overbought < 100:
        raise ValueError("RSI thresholds must satisfy 0 < rsi_oversold < rsi_overbought < 100")
    config = {
        "strategy": strategy,
        "fast_window": fast,
        "slow_window": slow,
        "rsi_period": rsi_period,
        "rsi_oversold": rsi_oversold,
        "rsi_overbought": rsi_overbought,
        "ar1_window": ar1_window,
        "ar1_signal_bps": ar1_signal_bps,
        "initial_cash": _number(payload.get("initial_cash", 10000), "initial_cash", minimum=1),
        "fee_bps": _number(payload.get("fee_bps", 5), "fee_bps"),
        "slippage_bps": _number(payload.get("slippage_bps", 5), "slippage_bps"),
    }
    if config["fee_bps"] > 1000 or config["slippage_bps"] > 1000:
        raise ValueError("fee_bps and slippage_bps must not exceed 1000")
    return normalized, config


def _wilder_rsi(closes: list[float], period: int) -> float | None:
    """Latest Wilder RSI, calculated exclusively from completed closes."""
    if len(closes) <= period:
        return None
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(change, 0.0) for change in changes]
    losses = [max(-change, 0.0) for change in changes]
    average_gain = mean(gains[:period])
    average_loss = mean(losses[:period])
    for i in range(period, len(gains)):
        average_gain = (average_gain * (period - 1) + gains[i]) / period
        average_loss = (average_loss * (period - 1) + losses[i]) / period
    if average_loss == 0:
        return 100.0 if average_gain > 0 else 50.0
    return 100.0 - 100.0 / (1.0 + average_gain / average_loss)


def _ar1_forecast_return(closes: list[float], window: int) -> float | None:
    """Forecast the next log return with a bounded AR(1) fitted on completed closes."""
    if len(closes) <= window:
        return None
    returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    sample = returns[-window:]
    x = sample[:-1]
    y = sample[1:]
    x_mean = mean(x)
    y_mean = mean(y)
    variance = sum((value - x_mean) ** 2 for value in x)
    phi = 0.0 if variance == 0 else sum((x[i] - x_mean) * (y[i] - y_mean) for i in range(len(x))) / variance
    phi = max(-1.0, min(1.0, phi))
    return y_mean + phi * (sample[-1] - x_mean)


def run_backtest(
    payload: object,
    *,
    start_index: int = 0,
    initial_action: str | None = None,
) -> dict:
    bars, config = validate(payload)
    if isinstance(start_index, bool) or not isinstance(start_index, int) or not 0 <= start_index < len(bars):
        raise ValueError("start_index must be an integer within the validated bar range")
    if initial_action not in (None, "buy"):
        raise ValueError("initial_action must be buy or None")
    closes = [bar["close"] for bar in bars]
    fast, slow = config["fast_window"], config["slow_window"]
    cash = config["initial_cash"]
    quantity = 0.0
    entry_cost = 0.0
    trades = []
    equity_curve = []
    fee_rate = config["fee_bps"] / 10000
    slippage_rate = config["slippage_bps"] / 10000
    peak = cash
    max_drawdown = 0.0
    daily_returns = []
    previous_equity = cash

    # A close-time signal is queued and filled at the following bar's open.
    # The equity curve for each date is marked only after that date's open fills.
    pending_action = None
    for index, bar in enumerate(bars):
        if index == start_index:
            # Align the flat fold portfolio to the trend observed at the final
            # training close; any resulting entry fills at the first test open.
            pending_action = initial_action
        if index >= start_index:
            if pending_action == "buy" and quantity == 0:
                fill_price = bar["open"] * (1 + slippage_rate)
                quantity = cash / (fill_price * (1 + fee_rate))
                fee = quantity * fill_price * fee_rate
                entry_cost = quantity * fill_price + fee
                cash = 0.0
                trades.append({
                    "date": bar["date"], "side": "buy",
                    "price": round(fill_price, 8), "quantity": round(quantity, 8),
                    "fee": round(fee, 8),
                })
            elif pending_action == "sell" and quantity > 0:
                fill_price = bar["open"] * (1 - slippage_rate)
                proceeds = quantity * fill_price
                fee = proceeds * fee_rate
                net_proceeds = proceeds - fee
                trades.append({
                    "date": bar["date"], "side": "sell",
                    "price": round(fill_price, 8), "quantity": round(quantity, 8),
                    "fee": round(fee, 8),
                    "realized_pnl": round(net_proceeds - entry_cost, 8),
                })
                cash = net_proceeds
                quantity = 0.0
                entry_cost = 0.0
            pending_action = None

            equity = cash + quantity * bar["close"]
            if previous_equity > 0:
                daily_returns.append(equity / previous_equity - 1)
            previous_equity = equity
            peak = max(peak, equity)
            if peak > 0:
                max_drawdown = max(max_drawdown, (peak - equity) / peak)
            equity_curve.append({"date": bar["date"], "equity": round(equity, 2)})
        else:
            # Warm-up bars inform indicators but never generate simulated fills.
            pending_action = None

        # Compute the decision only after this bar has closed. It cannot fill
        # until the next iteration, at the next bar's open.
        if index + 1 < len(bars):
            if config["strategy"] == "sma_crossover" and index >= slow:
                fast_now = mean(closes[index - fast + 1:index + 1])
                slow_now = mean(closes[index - slow + 1:index + 1])
                fast_prev = mean(closes[index - fast:index])
                slow_prev = mean(closes[index - slow:index])
                crossed_up = fast_prev <= slow_prev and fast_now > slow_now
                crossed_down = fast_prev >= slow_prev and fast_now < slow_now
                if quantity == 0 and crossed_up:
                    pending_action = "buy"
                elif quantity > 0 and crossed_down:
                    pending_action = "sell"
            elif config["strategy"] == "rsi_mean_reversion" and index >= config["rsi_period"]:
                rsi = _wilder_rsi(closes[:index + 1], config["rsi_period"])
                if rsi is not None:
                    if quantity == 0 and rsi <= config["rsi_oversold"]:
                        pending_action = "buy"
                    elif quantity > 0 and rsi >= config["rsi_overbought"]:
                        pending_action = "sell"
            elif config["strategy"] == "ar1_trend" and index >= config["ar1_window"]:
                forecast = _ar1_forecast_return(closes[:index + 1], config["ar1_window"])
                if forecast is not None:
                    threshold = config["ar1_signal_bps"] / 10000
                    if quantity == 0 and forecast > threshold:
                        pending_action = "buy"
                    elif quantity > 0 and forecast < -threshold:
                        pending_action = "sell"

    final_equity = cash + quantity * bars[-1]["close"]
    total_return = final_equity / config["initial_cash"] - 1
    volatility = stdev(daily_returns) if len(daily_returns) > 1 else 0.0
    sharpe = (mean(daily_returns) / volatility * math.sqrt(252)) if volatility > 0 else 0.0
    closed_trades = [trade for trade in trades if trade["side"] == "sell"]
    wins = sum(1 for trade in closed_trades if trade["realized_pnl"] > 0)

    return {
        "strategy": config["strategy"],
        "config": config,
        "period": {"start": bars[start_index]["date"], "end": bars[-1]["date"], "bars": len(bars) - start_index},
        "metrics": {
            "initial_cash": round(config["initial_cash"], 2),
            "final_equity": round(final_equity, 2),
            "total_return_pct": round(total_return * 100, 4),
            "max_drawdown_pct": round(max_drawdown * 100, 4),
            "annualized_sharpe": round(sharpe, 4),
            "trade_count": len(trades),
            "closed_trade_count": len(closed_trades),
            "win_rate_pct": round(wins / len(closed_trades) * 100, 2) if closed_trades else 0.0,
            "fees_and_slippage_bps": round(config["fee_bps"] + config["slippage_bps"], 2),
        },
        "equity_curve": equity_curve,
        "trades": trades,
        "execution_mode": "historical_simulation_only",
        "disclaimer": "Historical simulation is not a prediction or investment advice. No broker or live orders are connected.",
    }


DEFAULT_PARAMETER_GRID = [
    {"fast_window": 5, "slow_window": 20},
    {"fast_window": 5, "slow_window": 50},
    {"fast_window": 10, "slow_window": 30},
    {"fast_window": 10, "slow_window": 50},
    {"fast_window": 20, "slow_window": 50},
    {"fast_window": 20, "slow_window": 100},
]


def _integer_option(payload: dict, key: str, default: int, minimum: int, maximum: int) -> int:
    value = payload.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{key} must be an integer between {minimum} and {maximum}")
    return value


def run_walk_forward(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object")
    bars, base_config = validate(payload)
    strategy = base_config["strategy"]
    if strategy == "sma_crossover":
        default_grid = DEFAULT_PARAMETER_GRID
        required_keys = {"fast_window", "slow_window"}
    elif strategy == "rsi_mean_reversion":
        default_grid = [
            {"rsi_period": 7, "rsi_oversold": 30, "rsi_overbought": 70},
            {"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70},
            {"rsi_period": 21, "rsi_oversold": 30, "rsi_overbought": 70},
        ]
        required_keys = {"rsi_period", "rsi_oversold", "rsi_overbought"}
    elif strategy == "ar1_trend":
        default_grid = [
            {"ar1_window": 30, "ar1_signal_bps": 0},
            {"ar1_window": 60, "ar1_signal_bps": 0},
            {"ar1_window": 90, "ar1_signal_bps": 5},
        ]
        required_keys = {"ar1_window", "ar1_signal_bps"}
    else:
        raise ValueError("walk_forward supports sma_crossover, rsi_mean_reversion, and ar1_trend only")

    raw_grid = payload.get("parameter_grid", default_grid)
    if not isinstance(raw_grid, list) or not 1 <= len(raw_grid) <= 20:
        raise ValueError("parameter_grid must contain between 1 and 20 candidates")
    parameter_grid = []
    seen = set()
    max_lookback = 0
    for index, candidate in enumerate(raw_grid):
        if not isinstance(candidate, dict) or set(candidate) != required_keys:
            raise ValueError(f"parameter_grid[{index}] must contain exactly {sorted(required_keys)}")
        normalized = dict(candidate)
        if strategy == "sma_crossover":
            fast, slow = candidate["fast_window"], candidate["slow_window"]
            if isinstance(fast, bool) or not isinstance(fast, int) or not 2 <= fast <= 50:
                raise ValueError(f"parameter_grid[{index}].fast_window is invalid")
            if isinstance(slow, bool) or not isinstance(slow, int) or not 3 <= slow <= 200 or fast >= slow:
                raise ValueError(f"parameter_grid[{index}].slow_window must exceed fast_window and be at most 200")
            max_lookback = max(max_lookback, slow)
        elif strategy == "rsi_mean_reversion":
            period = candidate["rsi_period"]
            if isinstance(period, bool) or not isinstance(period, int) or not 2 <= period <= 50:
                raise ValueError(f"parameter_grid[{index}].rsi_period is invalid")
            oversold = _number(candidate["rsi_oversold"], f"parameter_grid[{index}].rsi_oversold")
            overbought = _number(candidate["rsi_overbought"], f"parameter_grid[{index}].rsi_overbought")
            if not 0 < oversold < overbought < 100:
                raise ValueError(f"parameter_grid[{index}] RSI thresholds are invalid")
            normalized.update({"rsi_oversold": oversold, "rsi_overbought": overbought})
            max_lookback = max(max_lookback, period)
        else:
            window = candidate["ar1_window"]
            if isinstance(window, bool) or not isinstance(window, int) or not 20 <= window <= 250:
                raise ValueError(f"parameter_grid[{index}].ar1_window is invalid")
            threshold = _number(candidate["ar1_signal_bps"], f"parameter_grid[{index}].ar1_signal_bps")
            if threshold > 1000:
                raise ValueError(f"parameter_grid[{index}].ar1_signal_bps must not exceed 1000")
            normalized["ar1_signal_bps"] = threshold
            max_lookback = max(max_lookback, window)
        identity = tuple(sorted(normalized.items()))
        if identity in seen:
            raise ValueError("parameter_grid cannot contain duplicate candidates")
        seen.add(identity)
        parameter_grid.append(normalized)

    train_window = _integer_option(payload, "train_window", max(120, max_lookback + 1), max(30, max_lookback + 1), 2000)
    test_window = _integer_option(payload, "test_window", 30, 5, 500)
    step_window = _integer_option(payload, "step_window", test_window, 5, 500)
    max_folds = _integer_option(payload, "max_folds", 10, 1, 20)
    if step_window < test_window:
        raise ValueError("step_window must be at least test_window so out-of-sample folds do not overlap")
    if train_window + test_window > len(bars):
        raise ValueError("bars do not contain enough history for one train/test fold")
    available_folds = 1 + (len(bars) - train_window - test_window) // step_window
    planned_folds = min(max_folds, available_folds)
    if len(parameter_grid) * planned_folds * train_window > 100_000:
        raise ValueError("walk-forward evaluation exceeds the bounded compute budget")

    folds = []
    start = train_window
    while start + test_window <= len(bars) and len(folds) < max_folds:
        end = start + test_window
        training_bars = bars[start - train_window:start]
        fold_bars = bars[start - train_window:end]
        candidates = []
        for candidate in parameter_grid:
            training_result = run_backtest({**payload, "bars": training_bars, **candidate})
            metrics = training_result["metrics"]
            candidates.append({
                "parameters": candidate,
                "score": (metrics["annualized_sharpe"], metrics["total_return_pct"], -metrics["max_drawdown_pct"]),
                "metrics": metrics,
            })
        selected = max(candidates, key=lambda item: item["score"])
        training_closes = [bar["close"] for bar in training_bars]
        params = selected["parameters"]
        if strategy == "sma_crossover":
            fast_value = mean(training_closes[-params["fast_window"]:])
            slow_value = mean(training_closes[-params["slow_window"]:])
            initial_action = "buy" if fast_value > slow_value else None
        elif strategy == "rsi_mean_reversion":
            rsi_value = _wilder_rsi(training_closes, params["rsi_period"])
            initial_action = "buy" if rsi_value is not None and rsi_value <= params["rsi_oversold"] else None
        else:
            forecast = _ar1_forecast_return(training_closes, params["ar1_window"])
            threshold = params["ar1_signal_bps"] / 10000
            initial_action = "buy" if forecast is not None and forecast > threshold else None
        out_of_sample = run_backtest(
            {**payload, "bars": fold_bars, **params},
            start_index=train_window,
            initial_action=initial_action,
        )
        folds.append({
            "fold": len(folds) + 1,
            "training_period": {"start": training_bars[0]["date"], "end": training_bars[-1]["date"], "bars": len(training_bars)},
            "test_period": {"start": bars[start]["date"], "end": bars[end - 1]["date"], "bars": test_window},
            "selected_parameters": params,
            "test_initial_position": "long" if initial_action == "buy" else "flat",
            "training_selection_metrics": {
                "annualized_sharpe": selected["metrics"]["annualized_sharpe"],
                "total_return_pct": selected["metrics"]["total_return_pct"],
                "max_drawdown_pct": selected["metrics"]["max_drawdown_pct"],
            },
            "out_of_sample_metrics": out_of_sample["metrics"],
            "out_of_sample_trades": out_of_sample["trades"],
            "out_of_sample_equity_curve": out_of_sample["equity_curve"],
        })
        start += step_window

    if not folds:
        raise ValueError("No complete walk-forward test folds could be constructed")
    returns = [fold["out_of_sample_metrics"]["total_return_pct"] for fold in folds]
    drawdowns = [fold["out_of_sample_metrics"]["max_drawdown_pct"] for fold in folds]
    closed_trades = [trade for fold in folds for trade in fold["out_of_sample_trades"] if trade["side"] == "sell"]
    wins = sum(1 for trade in closed_trades if trade.get("realized_pnl", 0) > 0)
    total_trades = sum(len(fold["out_of_sample_trades"]) for fold in folds)
    profitable_folds = sum(1 for value in returns if value > 0)
    return {
        "strategy": strategy,
        "evaluation_mode": "walk_forward_out_of_sample",
        "selection_metric": "training_annualized_sharpe_then_return_then_drawdown",
        "parameter_grid_size": len(parameter_grid),
        "config": {
            "train_window": train_window, "test_window": test_window, "step_window": step_window,
            "max_folds": max_folds, "initial_cash": base_config["initial_cash"],
            "fee_bps": base_config["fee_bps"], "slippage_bps": base_config["slippage_bps"],
        },
        "metrics": {
            "fold_count": len(folds), "out_of_sample_bars": len(folds) * test_window,
            "mean_return_pct": round(mean(returns), 4), "median_return_pct": round(median(returns), 4),
            "best_fold_return_pct": round(max(returns), 4), "worst_fold_return_pct": round(min(returns), 4),
            "mean_max_drawdown_pct": round(mean(drawdowns), 4),
            "profitable_fold_pct": round(profitable_folds / len(folds) * 100, 2),
            "trade_count": total_trades, "closed_trade_count": len(closed_trades),
            "win_rate_pct": round(wins / len(closed_trades) * 100, 2) if closed_trades else 0.0,
        },
        "folds": folds, "look_ahead_leakage": False,
        "execution_mode": "historical_simulation_only",
        "disclaimer": "Walk-forward results are historical out-of-sample simulations, not predictions or investment advice. No broker or live orders are connected.",
    }


def run_volatility_forecast(payload: object) -> dict:
    """Estimate one-step daily volatility with EWMA and fixed-parameter GARCH(1,1).

    Parameters are explicit and bounded; this is a transparent research baseline,
    not a fitted or production risk model. Returns use completed daily closes only.
    """
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object")
    bars, _ = validate({"bars": payload.get("bars")})
    if len(bars) < 31:
        raise ValueError("volatility forecast requires at least 31 bars")
    alpha = _number(payload.get("garch_alpha", 0.08), "garch_alpha")
    beta = _number(payload.get("garch_beta", 0.90), "garch_beta")
    decay = _number(payload.get("ewma_decay", 0.94), "ewma_decay")
    annualization = _number(payload.get("annualization_days", 252), "annualization_days", minimum=1)
    if not 0 < alpha < 1 or not 0 < beta < 1 or alpha + beta >= 1:
        raise ValueError("GARCH parameters must satisfy 0 < alpha,beta < 1 and alpha + beta < 1")
    if not 0 < decay < 1:
        raise ValueError("ewma_decay must be between 0 and 1")
    closes = [row["close"] for row in bars]
    returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    sample_variance = sum((value - mean(returns)) ** 2 for value in returns) / max(1, len(returns) - 1)
    if not math.isfinite(sample_variance) or sample_variance <= 0:
        raise ValueError("returns must contain non-zero variance")
    ewma_variance = sample_variance
    garch_variance = sample_variance
    omega = sample_variance * (1 - alpha - beta)
    for value in returns:
        shock = value - mean(returns)
        ewma_variance = decay * ewma_variance + (1 - decay) * shock * shock
        garch_variance = omega + alpha * shock * shock + beta * garch_variance
    forecast = {
        "ewma_daily_volatility_pct": round(math.sqrt(max(ewma_variance, 0)) * 100, 6),
        "garch11_daily_volatility_pct": round(math.sqrt(max(garch_variance, 0)) * 100, 6),
        "ewma_annualized_volatility_pct": round(math.sqrt(max(ewma_variance, 0) * annualization) * 100, 6),
        "garch11_annualized_volatility_pct": round(math.sqrt(max(garch_variance, 0) * annualization) * 100, 6),
    }
    return {
        "model": "ewma_and_fixed_parameter_garch11",
        "forecast_horizon": "next_daily_bar",
        "observations": len(returns),
        "period": {"start": bars[0]["date"], "end": bars[-1]["date"]},
        "parameters": {
            "garch_alpha": alpha, "garch_beta": beta,
            "garch_omega": omega, "ewma_decay": decay,
            "annualization_days": annualization,
        },
        "forecast": forecast,
        "execution_mode": "risk_research_only",
        "disclaimer": "Volatility estimates are historical research outputs, not trading instructions or investment advice. No broker or live orders are connected.",
    }



def run_egarch_forecast(payload: object) -> dict:
    """One-step EGARCH(1,1) forecast with explicit asymmetric shock response."""
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object")
    bars, _ = validate({"bars": payload.get("bars")})
    if len(bars) < 31:
        raise ValueError("EGARCH forecast requires at least 31 bars")
    alpha = _number(payload.get("egarch_alpha", 0.10), "egarch_alpha")
    beta = _number(payload.get("egarch_beta", 0.90), "egarch_beta")
    gamma_value = payload.get("egarch_gamma", -0.10)
    omega = payload.get("egarch_omega")
    if isinstance(gamma_value, bool) or not isinstance(gamma_value, (int, float)) or not math.isfinite(float(gamma_value)):
        raise ValueError("egarch_gamma must be finite")
    gamma = float(gamma_value)
    if isinstance(omega, bool) or (omega is not None and (not isinstance(omega, (int, float)) or not math.isfinite(float(omega)))):
        raise ValueError("egarch_omega must be finite when supplied")
    if not 0 <= alpha <= 2 or not -0.999 < beta < 0.999 or not -2 <= gamma <= 2:
        raise ValueError("EGARCH parameters are outside supported bounds")
    annualization = _number(payload.get("annualization_days", 252), "annualization_days", minimum=1)
    closes = [row["close"] for row in bars]
    returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    center = mean(returns)
    residuals = [value - center for value in returns]
    variance = sum(value * value for value in residuals) / max(1, len(residuals) - 1)
    if not math.isfinite(variance) or variance <= 0:
        raise ValueError("returns must contain non-zero variance")
    # The intercept defaults to the unconditional log-variance level under
    # the configured persistence, with the centred absolute-shock term.
    intercept = float(omega) if omega is not None else (1 - beta) * math.log(variance)
    log_variance = math.log(variance)
    expected_abs_normal = math.sqrt(2 / math.pi)
    for residual in residuals:
        standardized = residual / math.sqrt(math.exp(max(-50.0, min(50.0, log_variance))))
        log_variance = (
            intercept + beta * log_variance
            + alpha * (abs(standardized) - expected_abs_normal)
            + gamma * standardized
        )
        log_variance = max(-50.0, min(50.0, log_variance))
    forecast_variance = math.exp(log_variance)
    return {
        "model": "egarch11_asymmetric_fixed_parameter",
        "forecast_horizon": "next_daily_bar",
        "observations": len(returns),
        "period": {"start": bars[0]["date"], "end": bars[-1]["date"]},
        "parameters": {
            "egarch_omega": intercept, "egarch_alpha": alpha,
            "egarch_beta": beta, "egarch_gamma": gamma,
            "annualization_days": annualization,
        },
        "forecast": {
            "egarch_daily_volatility_pct": round(math.sqrt(forecast_variance) * 100, 6),
            "egarch_annualized_volatility_pct": round(math.sqrt(forecast_variance * annualization) * 100, 6),
        },
        "asymmetry": {
            "interpretation": "negative gamma increases the log-variance response to negative standardized shocks relative to positive shocks of equal magnitude",
            "gamma": gamma,
        },
        "execution_mode": "risk_research_only",
        "disclaimer": "EGARCH output is a fixed-parameter historical research estimate, not a fitted production model, trading instruction or investment advice. No broker or live orders are connected.",
    }


def main() -> int:
    try:
        raw = sys.stdin.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("Request exceeds the 2 MB engine input limit")
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("Request must be a JSON object")
        mode = payload.get("mode", "backtest")
        if mode == "walk_forward":
            result = run_walk_forward(payload)
        elif mode == "volatility":
            result = run_volatility_forecast(payload)
        elif mode == "egarch":
            result = run_egarch_forecast(payload)
        elif mode == "backtest":
            result = run_backtest(payload)
        else:
            raise ValueError("mode must be backtest, walk_forward, volatility, or egarch")
        sys.stdout.write(json.dumps({"ok": True, "result": result}, allow_nan=False))
        return 0
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        sys.stdout.write(json.dumps({"ok": False, "error": str(error)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
