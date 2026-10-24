import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import metric_pack, parse_dt, select_forecasts
from datetime import date, datetime, timezone


def test_metric_pack_known_values():
    result = metric_pack([(12, 10), (8, 10)])
    assert result["matchedIntervals"] == 2
    assert result["maeMW"] == 2
    assert result["rmseMW"] == 2
    assert result["biasMW"] == 0


def test_metric_pack_empty():
    result = metric_pack([])
    assert result["matchedIntervals"] == 0
    assert result["maeMW"] is None


def test_latest_forecast_before_cutoff_selected():
    target = datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc)
    rows = [
        {"startTime": target, "publishTime": datetime(2026, 1, 1, 8, tzinfo=timezone.utc), "generation": 100},
        {"startTime": target, "publishTime": datetime(2026, 1, 1, 11, tzinfo=timezone.utc), "generation": 120},
        {"startTime": target, "publishTime": datetime(2026, 1, 1, 13, tzinfo=timezone.utc), "generation": 150},
    ]
    selected = select_forecasts(rows, date(2026, 1, 1), date(2026, 1, 2), __import__("datetime").time(12, 0))
    assert len(selected) == 1
    assert selected[0]["generation"] == 120


def test_parse_zulu_timestamp():
    result = parse_dt("2026-01-01T00:00:00Z")
    assert result.isoformat() == "2026-01-01T00:00:00+00:00"


def test_incomplete_hourly_actuals_are_excluded():
    # Two half-hour observations make a complete hourly actual.
    actual_buckets = {
        datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc): [100, 120],
        # Only one half-hour observation: incomplete hour.
        datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc): [130],
    }

    actuals = [
        {"startTime": start, "generation": sum(values) / 2}
        for start, values in sorted(actual_buckets.items())
        if len(values) == 2
    ]

    assert len(actuals) == 1
    assert actuals[0]["generation"] == 110



def test_missing_actual_is_not_counted_as_matched():
    from app.main import matched_rows, UK

    target = datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc)
    forecasts = [
        {
            "startTime": target,
            "publishTime": datetime(
                2026, 1, 1, 8, 0, tzinfo=timezone.utc
            ),
            "generation": 120,
        }
    ]

    rows = matched_rows(
        actuals=[],
        forecasts=forecasts,
        decision_date=date(2026, 1, 1),
        cutoff_time=__import__("datetime").time(12, 0),
    )

    # Every expected delivery hour should be represented.
    assert len(rows) == 24

    # The first hour has a forecast but no actual.
    first = rows[0]
    assert first["forecastMW"] == 120
    assert first["actualMW"] is None
    assert first["errorMW"] is None

    # The remaining hours have neither forecast nor actual.
    assert all(row["forecastMW"] is None for row in rows[1:])
    assert all(row["errorMW"] is None for row in rows)

    matched = [
        row for row in rows
        if row["forecastMW"] is not None and row["actualMW"] is not None
    ]
    result = metric_pack([
        (row["forecastMW"], row["actualMW"]) for row in matched
    ])

    assert result["matchedIntervals"] == 0
    assert result["maeMW"] is None
    assert round(100 * len(matched) / 24, 2) == 0.0
