import unittest
import math
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quant_engine import run_backtest, run_egarch_forecast, run_volatility_forecast, run_walk_forward, validate


def bars(count=80):
    result = []
    price = 100.0
    for index in range(count):
        # Deterministic uptrend followed by a downtrend to exercise both sides.
        price += -1.0 if index < 20 else 1.4 if index < 50 else -1.6
        result.append({
            "date": (date(2026, 1, 1) + timedelta(days=index)).isoformat(),
            "open": price - 0.2, "high": price + 0.5,
            "low": price - 0.5, "close": price, "volume": 1000,
        })
    return result


class QuantEngineTests(unittest.TestCase):
    def test_backtest_is_deterministic_and_long_only(self):
        payload = {"bars": bars(), "fast_window": 3, "slow_window": 8}
        first = run_backtest(payload)
        second = run_backtest(payload)
        self.assertEqual(first, second)
        self.assertEqual(first["execution_mode"], "historical_simulation_only")
        self.assertGreaterEqual(first["metrics"]["max_drawdown_pct"], 0)
        sides = {trade["side"] for trade in first["trades"]}
        self.assertEqual(sides, {"buy", "sell"})
        self.assertEqual(first["period"]["bars"], 80)

    def test_fills_signal_on_the_following_bar_open(self):
        sample = bars()
        result = run_backtest({"bars": sample, "fast_window": 3, "slow_window": 8})
        first_buy = next(trade for trade in result["trades"] if trade["side"] == "buy")
        self.assertEqual(first_buy["date"], sample[23]["date"])
        self.assertAlmostEqual(first_buy["price"], sample[23]["open"] * 1.0005, places=7)


    def test_walk_forward_is_deterministic_and_trades_only_in_out_of_sample_windows(self):
        sample = bars(80)
        payload = {
            "bars": sample,
            "train_window": 30,
            "test_window": 10,
            "step_window": 10,
            "max_folds": 4,
            "parameter_grid": [
                {"fast_window": 3, "slow_window": 8},
                {"fast_window": 5, "slow_window": 12},
            ],
            "fee_bps": 5,
            "slippage_bps": 5,
        }
        first = run_walk_forward(payload)
        second = run_walk_forward(payload)
        self.assertEqual(first, second)
        self.assertEqual(first["metrics"]["fold_count"], 4)
        self.assertFalse(first["look_ahead_leakage"])
        self.assertEqual(first["folds"][0]["test_initial_position"], "long")
        self.assertEqual(first["folds"][0]["out_of_sample_trades"][0]["date"], first["folds"][0]["test_period"]["start"])
        for fold in first["folds"]:
            self.assertGreater(fold["test_period"]["start"], fold["training_period"]["end"])
            for trade in fold["out_of_sample_trades"]:
                self.assertGreaterEqual(trade["date"], fold["test_period"]["start"])

    def test_walk_forward_parameter_selection_cannot_see_test_bars(self):
        sample = bars(80)
        payload = {
            "bars": sample,
            "train_window": 30,
            "test_window": 10,
            "step_window": 10,
            "max_folds": 1,
            "parameter_grid": [
                {"fast_window": 3, "slow_window": 8},
                {"fast_window": 5, "slow_window": 12},
            ],
        }
        baseline = run_walk_forward(payload)
        changed = [dict(item) for item in sample]
        test_closes = [95.0, 90.0, 85.0, 80.0, 75.0, 85.0, 95.0, 105.0, 115.0, 125.0]
        for index, close in enumerate(test_closes, start=30):
            changed[index].update({
                "open": close - 0.2, "high": close + 0.5,
                "low": close - 0.5, "close": close,
            })
        altered = run_walk_forward({**payload, "bars": changed})
        self.assertEqual(
            baseline["folds"][0]["selected_parameters"],
            altered["folds"][0]["selected_parameters"],
        )
        self.assertNotEqual(
            baseline["folds"][0]["out_of_sample_metrics"],
            altered["folds"][0]["out_of_sample_metrics"],
        )

    def test_walk_forward_rejects_overlapping_folds_and_invalid_grids(self):
        payload = {
            "bars": bars(80),
            "train_window": 30,
            "test_window": 10,
            "step_window": 5,
            "parameter_grid": [{"fast_window": 3, "slow_window": 8}],
        }
        with self.assertRaisesRegex(ValueError, "must be at least test_window"):
            run_walk_forward(payload)
        with self.assertRaisesRegex(ValueError, "duplicate candidates"):
            run_walk_forward({
                **payload,
                "step_window": 10,
                "parameter_grid": [
                    {"fast_window": 3, "slow_window": 8},
                    {"fast_window": 3, "slow_window": 8},
                ],
            })


    def test_walk_forward_enforces_a_bounded_compute_budget(self):
        large_sample = []
        for index in range(1000):
            close = 100.0 + (index % 20)
            large_sample.append({
                "date": (date(2020, 1, 1) + timedelta(days=index)).isoformat(),
                "open": close - 0.2, "high": close + 0.5,
                "low": close - 0.5, "close": close, "volume": 1000,
            })
        grid = [
            {"fast_window": fast, "slow_window": fast + 1}
            for fast in range(2, 22)
        ]
        with self.assertRaisesRegex(ValueError, "bounded compute budget"):
            run_walk_forward({
                "bars": large_sample,
                "train_window": 500,
                "test_window": 5,
                "step_window": 5,
                "max_folds": 20,
                "parameter_grid": grid,
            })

    def test_backtest_warmup_does_not_execute_training_period_trades(self):
        sample = bars(80)
        result = run_backtest({"bars": sample, "fast_window": 3, "slow_window": 8}, start_index=30)
        self.assertTrue(all(trade["date"] >= sample[30]["date"] for trade in result["trades"]))
        self.assertEqual(result["period"]["start"], sample[30]["date"])
        self.assertEqual(result["period"]["bars"], 50)

    def test_rejects_non_monotonic_dates(self):
        sample = bars()
        sample[3]["date"] = sample[2]["date"]
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            validate({"bars": sample, "fast_window": 3, "slow_window": 8})

    def test_rejects_lookahead_unsafe_strategy(self):
        with self.assertRaisesRegex(ValueError, "strategy must be"):
            run_backtest({"bars": bars(), "strategy": "llm_magic", "fast_window": 3, "slow_window": 8})

    def test_ar1_trend_is_deterministic_and_long_only(self):
        sample = []
        price = 100.0
        changes = [0.2] * 25 + [1.0, 1.2, 1.4, 1.1, 1.3] * 12 + [-0.2] * 20
        for index, change in enumerate(changes):
            price *= 1 + change / 100
            sample.append({
                "date": (date(2026, 1, 1) + timedelta(days=index)).isoformat(),
                "open": price * 0.999, "high": price * 1.005,
                "low": price * 0.995, "close": price, "volume": 1000,
            })
        payload = {"bars": sample, "strategy": "ar1_trend", "ar1_window": 20}
        first = run_backtest(payload)
        self.assertEqual(first, run_backtest(payload))
        self.assertEqual(first["strategy"], "ar1_trend")
        self.assertEqual(first["execution_mode"], "historical_simulation_only")
        self.assertTrue(all(trade["side"] in ("buy", "sell") for trade in first["trades"]))

    def test_ar1_rejects_invalid_window(self):
        with self.assertRaisesRegex(ValueError, "ar1_window"):
            run_backtest({"bars": bars(80), "strategy": "ar1_trend", "ar1_window": 10})

    def test_rsi_mean_reversion_is_deterministic_and_long_only(self):
        sample = []
        price = 100.0
        changes = [-2.0] * 18 + [1.0] * 12 + [2.0] * 18 + [-1.0] * 12 + [1.5] * 20
        for index, change in enumerate(changes):
            price += change
            sample.append({
                "date": (date(2026, 1, 1) + timedelta(days=index)).isoformat(),
                "open": price - 0.1, "high": price + 0.5,
                "low": price - 0.5, "close": price, "volume": 1000,
            })
        payload = {"bars": sample, "strategy": "rsi_mean_reversion", "rsi_period": 5}
        first = run_backtest(payload)
        self.assertEqual(first, run_backtest(payload))
        self.assertEqual(first["strategy"], "rsi_mean_reversion")
        self.assertEqual(first["execution_mode"], "historical_simulation_only")
        self.assertGreater(first["metrics"]["trade_count"], 0)
        self.assertTrue(all(trade["side"] in ("buy", "sell") for trade in first["trades"]))

    def test_rsi_rejects_invalid_thresholds_and_periods(self):
        payload = {"bars": bars(), "strategy": "rsi_mean_reversion"}
        with self.assertRaisesRegex(ValueError, "thresholds"):
            run_backtest({**payload, "rsi_oversold": 75, "rsi_overbought": 70})
        with self.assertRaisesRegex(ValueError, "rsi_period"):
            run_backtest({**payload, "rsi_period": 1})

    def test_walk_forward_supports_rsi_and_ar1_with_strategy_specific_grids(self):
        sample = bars(100)
        rsi = run_walk_forward({
            "bars": sample, "strategy": "rsi_mean_reversion",
            "train_window": 30, "test_window": 10, "step_window": 10, "max_folds": 2,
            "parameter_grid": [{"rsi_period": 5, "rsi_oversold": 30, "rsi_overbought": 70}],
        })
        self.assertEqual(rsi["strategy"], "rsi_mean_reversion")
        self.assertEqual(rsi["metrics"]["fold_count"], 2)
        self.assertFalse(rsi["look_ahead_leakage"])
        ar1 = run_walk_forward({
            "bars": sample, "strategy": "ar1_trend",
            "train_window": 30, "test_window": 10, "step_window": 10, "max_folds": 2,
            "parameter_grid": [{"ar1_window": 20, "ar1_signal_bps": 0}],
        })
        self.assertEqual(ar1["strategy"], "ar1_trend")
        self.assertEqual(ar1["metrics"]["fold_count"], 2)
        self.assertFalse(ar1["look_ahead_leakage"])

    def test_walk_forward_rejects_candidate_parameters_for_wrong_strategy(self):
        with self.assertRaisesRegex(ValueError, "exactly"):
            run_walk_forward({
                "bars": bars(80), "strategy": "ar1_trend",
                "train_window": 30, "test_window": 10,
                "parameter_grid": [{"fast_window": 3, "slow_window": 8}],
            })

    def test_rejects_invalid_ohlc(self):
        sample = bars()
        sample[0]["high"] = sample[0]["low"] - 1
        with self.assertRaisesRegex(ValueError, "high is inconsistent"):
            validate({"bars": sample, "fast_window": 3, "slow_window": 8})

    def test_rejects_invalid_windows(self):
        with self.assertRaisesRegex(ValueError, "slow_window"):
            run_backtest({"bars": bars(), "fast_window": 8, "slow_window": 5})


    def test_volatility_forecast_is_deterministic_and_positive(self):
        sample = bars(80)
        for index, row in enumerate(sample):
            shock = 1.0 if index % 9 == 0 else 0.1
            row["close"] = 100.0 * (1 + shock / 100) ** (index + 1)
            row["open"] = row["close"] * 0.999
            row["high"] = row["close"] * 1.005
            row["low"] = row["close"] * 0.995
        payload = {"bars": sample}
        first = run_volatility_forecast(payload)
        self.assertEqual(first, run_volatility_forecast(payload))
        self.assertEqual(first["model"], "ewma_and_fixed_parameter_garch11")
        self.assertGreater(first["forecast"]["garch11_daily_volatility_pct"], 0)
        self.assertGreater(first["forecast"]["ewma_daily_volatility_pct"], 0)
        self.assertEqual(first["execution_mode"], "risk_research_only")

    def test_volatility_rejects_nonstationary_garch_parameters(self):
        with self.assertRaisesRegex(ValueError, r"alpha \+ beta < 1"):
            run_volatility_forecast({"bars": bars(80), "garch_alpha": 0.1, "garch_beta": 0.9})

    def test_volatility_rejects_zero_variance_returns(self):
        sample = bars(40)
        for row in sample:
            row.update({"open": 100, "high": 101, "low": 99, "close": 100})
        with self.assertRaisesRegex(ValueError, "non-zero variance"):
            run_volatility_forecast({"bars": sample})


    def test_egarch_forecast_is_deterministic_and_records_asymmetry(self):
        sample = bars(80)
        for index, row in enumerate(sample):
            close = 100.0 * math.exp(0.001 * index + (0.0008 if index % 2 else -0.0006) * index)
            row.update({"open": close * 0.999, "high": close * 1.005, "low": close * 0.995, "close": close})
        result = run_egarch_forecast({"bars": sample, "egarch_gamma": -0.2})
        self.assertEqual(result, run_egarch_forecast({"bars": sample, "egarch_gamma": -0.2}))
        self.assertEqual(result["model"], "egarch11_asymmetric_fixed_parameter")
        self.assertEqual(result["parameters"]["egarch_gamma"], -0.2)
        self.assertGreater(result["forecast"]["egarch_daily_volatility_pct"], 0)
        self.assertEqual(result["execution_mode"], "risk_research_only")

    def test_egarch_negative_shock_has_larger_variance_response(self):
        def shock_bars(last_return):
            result = []
            price = 100.0
            for index in range(40):
                change = (0.001 if index % 2 else -0.0007) if index < 39 else last_return
                price *= math.exp(change)
                result.append({
                    "date": (date(2026, 1, 1) + timedelta(days=index)).isoformat(),
                    "open": price * 0.999, "high": price * 1.005,
                    "low": price * 0.995, "close": price, "volume": 1000,
                })
            return result
        params = {"egarch_alpha": 0.1, "egarch_beta": 0.8, "egarch_gamma": -0.2}
        positive = run_egarch_forecast({"bars": shock_bars(0.03), **params})
        negative = run_egarch_forecast({"bars": shock_bars(-0.03), **params})
        self.assertGreater(
            negative["forecast"]["egarch_daily_volatility_pct"],
            positive["forecast"]["egarch_daily_volatility_pct"],
        )

    def test_egarch_rejects_invalid_parameters_and_constant_returns(self):
        with self.assertRaisesRegex(ValueError, "outside supported bounds"):
            run_egarch_forecast({"bars": bars(80), "egarch_beta": 1.0})
        sample = bars(40)
        for row in sample:
            row.update({"open": 100, "high": 101, "low": 99, "close": 100})
        with self.assertRaisesRegex(ValueError, "non-zero variance"):
            run_egarch_forecast({"bars": sample})


if __name__ == "__main__":
    unittest.main()
