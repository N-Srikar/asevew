
from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

API_BASE = "https://data.elexon.co.uk/bmrs/api/v1"
UK = ZoneInfo("Europe/London")
UTC = timezone.utc

FEB_START = datetime(2026, 2, 1, tzinfo=UTC)

ACTUAL_PUB_FROM = "2026-01-01T00:30:00Z"
ACTUAL_PUB_TO = "2026-02-02T00:30:00Z"
FORECAST_PUB_FROM = "2025-12-25T00:00:00Z"
FORECAST_PUB_TO = "2026-02-01T00:00:00Z"
TIMEOUT = 45
EXPECTED_HOURS_PER_DAY = 24
JANUARY_DAYS = 31

app = FastAPI(
    title="WindLens API",
    description=(
        "UK wind generation forecasts and point-in-time "
        "accuracy analysis for January 2026."
    ),
    version="0.1.0",
)

origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in origins if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def parse_dt(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None

    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except ValueError:
        return None


def get_rows(url: str, params: dict[str, str]) -> list[dict[str, Any]]:
    response = requests.get(url, params=params, timeout=TIMEOUT)
    response.raise_for_status()
    payload = response.json()

    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]

    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return [row for row in payload["data"] if isinstance(row, dict)]

    raise ValueError(f"Unexpected API response shape from {url}")


@lru_cache(maxsize=1)
def load_data() -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    """Fetch and cache the January decision-window data."""
    actual_rows = get_rows(
        f"{API_BASE}/datasets/FUELHH/stream",
        {
            "publishDateTimeFrom": ACTUAL_PUB_FROM,
            "publishDateTimeTo": ACTUAL_PUB_TO,
            "fuelType": "WIND",
        },
    )

    forecast_rows = get_rows(
        f"{API_BASE}/datasets/WINDFOR/stream",
        {
            "publishDateTimeFrom": FORECAST_PUB_FROM,
            "publishDateTimeTo": FORECAST_PUB_TO,
        },
    )

    # FUELHH actuals are half-hourly. Average the two half-hourly
    # MW observations to align them with hourly WINDFOR forecasts.
    actual_buckets: dict[datetime, list[float]] = {}

    for row in actual_rows:
        if row.get("fuelType") != "WIND":
            continue

        start = parse_dt(row.get("startTime"))
        generation = row.get("generation")

        if start is None or generation is None:
            continue

        try:
            generation_mw = float(generation)
        except (TypeError, ValueError):
            continue

        hour_start = start.replace(minute=0, second=0, microsecond=0)
        local_day = hour_start.astimezone(UK).date()

        # Decision dates: Jan 1–31.
        # Delivery dates: Jan 2–Feb 1.
        if date(2026, 1, 2) <= local_day <= date(2026, 2, 1):
            actual_buckets.setdefault(hour_start, []).append(generation_mw)

    # Exclude incomplete hourly buckets.
    actuals: list[dict[str, Any]] = [
        {"startTime": start, "generation": sum(values) / 2}
        for start, values in sorted(actual_buckets.items())
        if len(values) == 2
    ]

    forecasts: list[dict[str, Any]] = []

    for row in forecast_rows:
        published = parse_dt(row.get("publishTime"))
        start = parse_dt(row.get("startTime"))
        generation = row.get("generation")

        if published is None or start is None or generation is None:
            continue

        try:
            generation_mw = float(generation)
        except (TypeError, ValueError):
            continue

        # Retain forecast versions published before February.
        if not (
            datetime(2025, 12, 25, tzinfo=UTC)
            <= published
            < FEB_START
        ):
            continue

        local_day = start.astimezone(UK).date()

        if date(2026, 1, 2) <= local_day <= date(2026, 2, 1):
            forecasts.append(
                {
                    "startTime": start,
                    "publishTime": published,
                    "generation": generation_mw,
                }
            )

    loaded_at = datetime.now(UTC).isoformat()
    return actuals, forecasts, loaded_at


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def make_decision_cutoff(
    decision_date: date,
    cutoff_time: time,
) -> datetime:
    local = datetime.combine(decision_date, cutoff_time, tzinfo=UK)
    return local.astimezone(UTC)


def select_forecasts(
    forecasts: list[dict[str, Any]],
    decision_date: date,
    delivery_date: date,
    cutoff_time: time,
) -> list[dict[str, Any]]:
    """Select the latest eligible forecast for each delivery hour."""
    cutoff = make_decision_cutoff(decision_date, cutoff_time)
    selected: dict[datetime, dict[str, Any]] = {}

    for row in forecasts:
        target = row["startTime"]

        if target.astimezone(UK).date() != delivery_date:
            continue

        if row["publishTime"] > cutoff:
            continue

        previous = selected.get(target)

        if previous is None or row["publishTime"] > previous["publishTime"]:
            selected[target] = row

    return [selected[key] for key in sorted(selected)]


def metric_pack(pairs: list[tuple[float, float]]) -> dict[str, Any]:
    """Calculate metrics from valid forecast–actual pairs only."""
    if not pairs:
        return {
            "matchedIntervals": 0,
            "maeMW": None,
            "rmseMW": None,
            "biasMW": None,
            "coveragePct": 0,
        }

    errors = [forecast - actual for forecast, actual in pairs]
    count = len(errors)

    mae = sum(abs(error) for error in errors) / count
    rmse = (sum(error * error for error in errors) / count) ** 0.5
    bias = sum(errors) / count

    return {
        "matchedIntervals": count,
        "maeMW": round(mae, 2),
        "rmseMW": round(rmse, 2),
        "biasMW": round(bias, 2),
    }


def is_matched(row: dict[str, Any]) -> bool:
    """A matched interval requires both forecast and actual values."""
    return (
        row["forecastMW"] is not None
        and row["actualMW"] is not None
    )


def matched_rows(
    actuals: list[dict[str, Any]],
    forecasts: list[dict[str, Any]],
    decision_date: date,
    cutoff_time: time,
) -> list[dict[str, Any]]:
    """Return all 24 delivery hours, including intervals with missing data."""
    delivery_date = decision_date + timedelta(days=1)

    selected = select_forecasts(
        forecasts,
        decision_date,
        delivery_date,
        cutoff_time,
    )

    forecast_map = {row["startTime"]: row for row in selected}
    actual_map = {
        row["startTime"]: row["generation"]
        for row in actuals
    }

    # January delivery days have 24 hourly intervals in UK local time.
    delivery_start = datetime.combine(
        delivery_date,
        time.min,
        tzinfo=UK,
    ).astimezone(UTC)

    output: list[dict[str, Any]] = []

    for hour in range(EXPECTED_HOURS_PER_DAY):
        target = delivery_start + timedelta(hours=hour)
        forecast = forecast_map.get(target)
        actual = actual_map.get(target)

        forecast_mw = forecast["generation"] if forecast else None
        actual_mw = actual
        publish_time = iso(forecast["publishTime"]) if forecast else None

        error_mw = None
        if forecast_mw is not None and actual_mw is not None:
            error_mw = round(forecast_mw - actual_mw, 2)

        output.append(
            {
                "startTime": iso(target),
                "publishTime": publish_time,
                "forecastMW": forecast_mw,
                "actualMW": actual_mw,
                "errorMW": error_mw,
            }
        )

    return output


def parse_cutoff(value: str) -> time:
    try:
        parsed = time.fromisoformat(value)

        if parsed.tzinfo is not None:
            raise ValueError

        return parsed
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="cutoff must be a local UK time such as 12:00",
        ) from exc


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "windlens-api"}


@app.get("/api/metadata")
def metadata() -> dict[str, Any]:
    try:
        actuals, forecasts, loaded_at = load_data()

        return {
            "dataStatus": "loaded",
            "loadedAt": loaded_at,
            "actualRecordsInWindow": len(actuals),
            "forecastRecordsInWindow": len(forecasts),
            "decisionDates": "2026-01-01 through 2026-01-31",
            "deliveryDates": "2026-01-02 through 2026-02-01",
            "timezone": "Europe/London",
            "defaultCutoff": "12:00",
            "sources": [
                f"{API_BASE}/datasets/FUELHH/stream",
                f"{API_BASE}/datasets/WINDFOR/stream",
            ],
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not load Elexon data: {exc}",
        ) from exc


@app.get("/api/forecasts")
def forecast_explorer(
    decision_date: date = Query(..., alias="decisionDate"),
    cutoff: str = Query("12:00"),
) -> dict[str, Any]:
    if not date(2026, 1, 1) <= decision_date <= date(2026, 1, 31):
        raise HTTPException(
            status_code=400,
            detail="decisionDate must be in January 2026",
        )

    cutoff_time = parse_cutoff(cutoff)
    delivery_date = decision_date + timedelta(days=1)

    try:
        actuals, forecasts, loaded_at = load_data()
        rows = matched_rows(
            actuals,
            forecasts,
            decision_date,
            cutoff_time,
        )

        matched = [row for row in rows if is_matched(row)]
        pairs = [
            (row["forecastMW"], row["actualMW"])
            for row in matched
        ]

        stats = metric_pack(pairs)
        stats["coveragePct"] = round(
            100 * len(matched) / EXPECTED_HOURS_PER_DAY,
            2,
        )

        return {
            "decisionDate": decision_date.isoformat(),
            "deliveryDate": delivery_date.isoformat(),
            "cutoffLocal": cutoff,
            "cutoffUtc": iso(
                make_decision_cutoff(decision_date, cutoff_time)
            ),
            "timezone": "Europe/London",
            "loadedAt": loaded_at,
            "stats": stats,
            "intervals": rows,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not build forecast view: {exc}",
        ) from exc


@app.get("/api/accuracy")
def accuracy(
    cutoff: str = Query("12:00"),
) -> dict[str, Any]:
    cutoff_time = parse_cutoff(cutoff)

    try:
        actuals, forecasts, loaded_at = load_data()

        all_pairs: list[tuple[float, float]] = []
        daily: list[dict[str, Any]] = []
        timeline: list[dict[str, Any]] = []

        for day_num in range(1, JANUARY_DAYS + 1):
            decision_date = date(2026, 1, day_num)
            rows = matched_rows(
                actuals,
                forecasts,
                decision_date,
                cutoff_time,
            )

            matched = [row for row in rows if is_matched(row)]
            pairs = [
                (row["forecastMW"], row["actualMW"])
                for row in matched
            ]

            all_pairs.extend(pairs)
            stats = metric_pack(pairs)
            stats["coveragePct"] = round(
                100 * len(matched) / EXPECTED_HOURS_PER_DAY,
                2,
            )

            daily.append(
                {
                    "decisionDate": decision_date.isoformat(),
                    "deliveryDate": (
                        decision_date + timedelta(days=1)
                    ).isoformat(),
                    **stats,
                }
            )
            timeline.extend(rows)

        total_expected = JANUARY_DAYS * EXPECTED_HOURS_PER_DAY
        summary = metric_pack(all_pairs)
        summary["coveragePct"] = round(
            100 * summary["matchedIntervals"] / total_expected,
            2,
        )

        return {
            "month": "2026-01",
            "cutoffLocal": cutoff,
            "timezone": "Europe/London",
            "loadedAt": loaded_at,
            "summary": summary,
            "daily": daily,
            "intervals": timeline,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not calculate accuracy: {exc}",
        ) from exc


@app.get("/api/overview")
def overview(
    cutoff: str = Query("12:00"),
) -> dict[str, Any]:
    result = accuracy(cutoff=cutoff)
    actuals, forecasts, loaded_at = load_data()
    cutoff_time = parse_cutoff(cutoff)

    series = []

    for day in result["daily"]:
        decision_date = date.fromisoformat(day["decisionDate"])
        rows = matched_rows(
            actuals,
            forecasts,
            decision_date,
            cutoff_time,
        )

        # Use the same valid pairs for both averages.
        matched = [row for row in rows if is_matched(row)]
        actual_values = [row["actualMW"] for row in matched]
        forecast_values = [row["forecastMW"] for row in matched]

        series.append(
            {
                "date": day["deliveryDate"],
                "actualAvgMW": (
                    round(sum(actual_values) / len(actual_values), 2)
                    if actual_values
                    else None
                ),
                "forecastAvgMW": (
                    round(sum(forecast_values) / len(forecast_values), 2)
                    if forecast_values
                    else None
                ),
                "maeMW": day["maeMW"],
                "coveragePct": day["coveragePct"],
            }
        )

    return {
        "month": "2026-01",
        "cutoffLocal": cutoff,
        "timezone": "Europe/London",
        "loadedAt": loaded_at,
        "summary": result["summary"],
        "series": series,
        "daily": result["daily"],
    }
