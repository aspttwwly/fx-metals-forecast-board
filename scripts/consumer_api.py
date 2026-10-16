"""Public, read-only LFE contract; never promotes research replay to as-issued data."""
from __future__ import annotations

import hashlib
import calendar
import json
import math
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


MODEL_VERSION = "V0.1.1"
FORECAST_SCOPE = "PUBLISHED_FORECAST"
RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
SYMBOL = re.compile(r"^[A-Z]{6}$")
BUSINESS_TIMEZONE = timezone(timedelta(hours=8))


def utc_timestamp(value):
    timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError("Prediction timestamp must include its source timezone")
    return timestamp.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def calendar_date(value):
    return date.fromisoformat(str(value)).isoformat()


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Forecast contract requires finite numeric values")
    return value


def raw_json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def quality_for(rows, frequency, horizon, cutoff):
    # The caller supplies only the converter's eligible as-issued comparisons.
    # Replay scores intentionally have no fallback path into this contract.
    selected = [row for row in rows if row.get("horizon") == horizon]
    identities = set()
    for row in selected:
        target = calendar_date(row["target"])
        origin = calendar_date(row["origin"])
        if origin >= target or target in identities:
            raise ValueError("Duplicate or invalid as-issued target identity")
        identities.add(target)
    mature = [row for row in selected
              if isinstance(row.get("actual"), (int, float)) and not isinstance(row["actual"], bool)
              and math.isfinite(row["actual"])
              and isinstance(row.get("forecast"), (int, float)) and not isinstance(row["forecast"], bool)
              and math.isfinite(row["forecast"])
              and row["origin"] < row["target"] <= cutoff]
    count = len(mature)
    errors = [row["forecast"] - row["actual"] for row in mature]
    anchors = [row.get("anchor") for row in mature]
    direction = None
    if count and all(isinstance(anchor, (int, float)) and not isinstance(anchor, bool)
                     and math.isfinite(anchor) for anchor in anchors):
        sign = lambda value: (value > 0) - (value < 0)
        direction = sum(sign(row["forecast"] - row["anchor"]) ==
                        sign(row["actual"] - row["anchor"]) for row in mature) / count
    return {
        "scope": "AS_ISSUED", "frequency": frequency, "horizon": horizon,
        "sampleCount": count, "evaluationCutoff": cutoff,
        "mape": sum(abs((row["forecast"] - row["actual"]) / row["actual"]) for row in mature) / count
        if count and all(row["actual"] != 0 for row in mature) else None,
        "rmse": math.sqrt(sum(error * error for error in errors) / count) if count else None,
        "mae": sum(abs(error) for error in errors) / count if count else None,
        "directionAccuracy": direction, "eligibleForExecution": False,
    }


def build_documents(data, project_dir):
    """Export existing real vintages only; current replay never enters the catalog."""
    symbol = data["symbol"]
    if not SYMBOL.fullmatch(symbol) or data.get("appVersion") != MODEL_VERSION:
        raise ValueError("Unsupported consumer contract symbol/version")
    long = data.get("longHorizon")
    if not long:
        raise ValueError(f"{symbol}: missing independently issued long-horizon batch")
    run_id = long["runId"]
    production_id = long["weekly"]["productionRunId"]
    if not RUN_ID.fullmatch(run_id) or not RUN_ID.fullmatch(production_id):
        raise ValueError("Invalid forecast vintage identity")
    archive_path = Path(project_dir) / "prophet output/long_horizon/vintages" / f"{run_id}.json"
    archive = json.loads(archive_path.read_bytes())
    if (archive.get("runId") != run_id or archive.get("issuedAt") != long["issuedAt"]
            or archive.get("pairs", {}).get(symbol) != {key: value for key, value in long.items()
                                                       if key not in ("runId", "issuedAt")}):
        raise ValueError("Issued long-horizon archive mismatch")
    vintage_path = Path(project_dir) / "prophet output/snapshots/vintages" / production_id / f"{symbol}.json"
    vintage_bytes = vintage_path.read_bytes()
    vintage = json.loads(vintage_bytes)
    if vintage.get("run_id") != production_id or vintage.get("pair") != symbol:
        raise ValueError("Production vintage identity mismatch")
    if (vintage.get("schema_version") != "forecast_vintage_v1"
            or vintage.get("model_version") != "prophet_fixed_origin_20261015"
            or vintage.get("decision_policy_version") != "fixed_origin_weekly_v2_20261015"):
        raise ValueError("Production vintage is not the V0.1.1 issued policy")
    issued_at = utc_timestamp(long["issuedAt"])
    production_issued_at = utc_timestamp(vintage["recorded_at_utc"])
    if production_issued_at > issued_at:
        raise ValueError("Extension predates its production forecast")
    cutoff = calendar_date(long["sourceDataCutoff"])
    if cutoff != calendar_date(vintage["source_data_cutoff"]):
        raise ValueError("Production and extension source cutoffs disagree")
    issued_day = datetime.fromisoformat(issued_at.replace("Z", "+00:00")).astimezone(BUSINESS_TIMEZONE).date().isoformat()
    production_day = datetime.fromisoformat(production_issued_at.replace("Z", "+00:00")).astimezone(BUSINESS_TIMEZONE).date().isoformat()
    if cutoff >= min(issued_day, production_day):
        raise ValueError("Source cutoff must be a completed business day before issue")
    weekly = long["weekly"]
    if not weekly.get("prefixDisplayEqual") or weekly["originDate"] != vintage["origin_date"]:
        raise ValueError("Weekly frozen prefix provenance is missing")
    if weekly["originDate"] != data["latestActual"]["date"]:
        raise ValueError("Dashboard and vintage origins disagree")
    raw_by_horizon = {point["horizon_weeks"]: point for point in vintage["forecasts"]}
    display = {row["date"]: row["forecast"] for row in data["series"] if row.get("future")}
    documents = []
    for frequency, maximum, default in (("weekly", 52, 13), ("monthly", 12, 3)):
        sidecar = long[frequency]
        if frequency == "monthly" and sidecar.get("status") != "RESEARCH_ONLY":
            raise ValueError("Monthly source must be the independent as-issued sidecar")
        origin = calendar_date(sidecar["originDate"])
        if origin > cutoff:
            raise ValueError("Forecast origin is newer than its source cutoff")
        origin_date = date.fromisoformat(origin)
        if frequency == "weekly" and origin_date.weekday() != 4:
            raise ValueError("Weekly origin must label a complete Friday period")
        if frequency == "monthly" and (origin_date.day != calendar.monthrange(origin_date.year, origin_date.month)[1]
                                       or sidecar.get("trainEnd") != origin):
            raise ValueError("Monthly origin/training must end at the complete natural month")
        anchor = data["latestActual"] if frequency == "weekly" else sidecar["latestActual"]
        if anchor["date"] != origin:
            raise ValueError("Latest actual is not the forecast origin")
        points = sorted((row for row in sidecar["series"] if (row.get("horizon") or 0) > 0),
                        key=lambda row: row["horizon"])
        if [row["horizon"] for row in points] != list(range(1, maximum + 1)):
            raise ValueError("Forecast horizons must be complete and unique")
        forecast = []
        for point in points:
            horizon = point["horizon"]
            target = calendar_date(point["date"])
            if target <= origin:
                raise ValueError("Forecast target must be after its origin")
            target_date = date.fromisoformat(target)
            if frequency == "weekly" and (target_date - date.fromisoformat(origin)).days != 7 * horizon:
                raise ValueError("Weekly target/horizon mismatch")
            if frequency == "monthly":
                month_index = origin_date.year * 12 + origin_date.month - 1 + horizon
                year, month_zero = divmod(month_index, 12)
                month = month_zero + 1
                if target_date != date(year, month, calendar.monthrange(year, month)[1]):
                    raise ValueError("Monthly target must be the independent natural month end")
            value = number(point["forecast"])
            point_generated = issued_at
            if frequency == "weekly" and horizon <= 13:
                raw = raw_by_horizon.get(horizon)
                if not raw or raw["target_date"] != target or not math.isclose(
                        value, number(raw["decision_forecast"]), rel_tol=0, abs_tol=1e-8):
                    raise ValueError("Weekly extension changed the original first 13 values")
                # The API's first 13 points preserve the already displayed precision.
                expected = round(value, 2 if abs(value) >= 100 else 4 if abs(value) >= 10 else 5)
                if display.get(target) != expected:
                    raise ValueError("Consumer weekly prefix differs from dashboard")
                value = display[target]
                point_generated = production_issued_at
            point_issue_day = datetime.fromisoformat(point_generated.replace("Z", "+00:00")).astimezone(BUSINESS_TIMEZONE).date().isoformat()
            if point_issue_day > target:
                raise ValueError("Forecast was generated after its target business day")
            forecast.append({"targetDate": target, "horizon": horizon, "forecast": value,
                             "actual": None, "lower": None, "upper": None,
                             "generatedAt": point_generated,
                             "referenceOnly": True})
        qualities = [quality_for(data.get("issuedComparisons", {}).get(frequency, []), frequency, h, cutoff)
                     for h in range(1, maximum + 1)]
        documents.append({
            "schemaVersion": 1, "symbol": symbol, "frequency": frequency,
            "modelVersion": MODEL_VERSION, "forecastScope": FORECAST_SCOPE,
            "runId": run_id, "productionRunId": production_id if frequency == "weekly" else None,
            "productionVintageSha256": hashlib.sha256(vintage_bytes).hexdigest() if frequency == "weekly" else None,
            "engineVersion": vintage["model_version"] if frequency == "weekly" else sidecar["modelVersion"],
            "policyVersion": vintage["decision_policy_version"] if frequency == "weekly" else sidecar["policyVersion"],
            "extensionPolicyVersion": weekly["policyVersion"] if frequency == "weekly" else None,
            "generatedAt": issued_at, "sourceDataCutoff": cutoff,
            "latestActual": {"date": origin, "value": number(anchor["value"])},
            "defaultHorizon": default, "maximumHorizon": maximum, "forecasts": forecast,
            "quality": qualities[default - 1], "qualityByHorizon": qualities,
            "referenceOnly": True, "eligibleForExecution": False,
            "businessTimezone": "Asia/Shanghai",
            "intervalCalibration": "NOT_ESTIMATED",
            "targetDefinition": "FRIDAY_LAST_SESSION_CLOSE" if frequency == "weekly" else "CALENDAR_MONTH_END_LAST_SESSION_CLOSE",
        })
    return documents


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_bytes(content)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def export_batch(data_dir, project_dir, symbols, *, generation_id=None, published_at=None):
    """All content objects precede one atomic manifest switch, inside sync staging."""
    if not symbols or len({data["symbol"] for data in symbols}) != len(symbols):
        raise ValueError("Consumer catalog must have unique instruments")
    documents = [document for data in symbols for document in build_documents(data, project_dir)]
    if len({document["runId"] for document in documents}) != 1 or len({document["sourceDataCutoff"] for document in documents}) != 1:
        raise ValueError("Consumer catalog cannot mix issued batches or source cutoffs")
    generation = generation_id or uuid.uuid4().hex
    timestamp = utc_timestamp(published_at or datetime.now(timezone.utc).isoformat())
    if any(document["generatedAt"] > timestamp for document in documents):
        raise ValueError("Publication batch predates its forecasts")
    catalog = []
    objects = []
    for document in documents:
        document["generationId"] = generation
        content = raw_json(document)
        digest = hashlib.sha256(content).hexdigest()
        path = f"/api/v1/data/{digest}.json"
        objects.append((digest, content))
        catalog.append({key: document[key] for key in ("symbol", "frequency", "modelVersion", "forecastScope")}
                       | {"dataPath": path, "sha256": digest})
    manifest = {"schemaVersion": 1, "generationId": generation, "publishedAt": timestamp,
                "catalog": catalog}
    folder = Path(data_dir) / "api-v1"
    for digest, content in objects:
        target = folder / "data" / f"{digest}.json"
        if target.exists() and target.read_bytes() != content:
            raise ValueError("Content-addressed object collision")
        if not target.exists():
            atomic_write(target, content)
    atomic_write(folder / "manifest.json", raw_json(manifest))
    return manifest
