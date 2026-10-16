import calendar
import copy
import hashlib
import importlib.util
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("consumer_api", Path(__file__).resolve().parents[1] / "scripts/consumer_api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = api.raw_json(data)
    path.write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def input_data(tmp_path):
    weekly = [{"date": str(date(2026, 10, 9) + timedelta(weeks=h)), "horizon": h,
               "forecast": 7 + h / 100, "future": True} for h in range(1, 53)]
    monthly = []
    for horizon in range(1, 13):
        year, zero_month = divmod(2026 * 12 + 8 + horizon, 12)
        month = zero_month + 1
        monthly.append({"date": str(date(year, month, calendar.monthrange(year, month)[1])),
                        "horizon": horizon, "forecast": 6.9 + horizon / 100, "future": True})
    production = {"schema_version": "forecast_vintage_v1", "run_id": "issued-weekly", "pair": "USDCNH",
                  "recorded_at_utc": "2026-10-15T15:00:00+08:00", "source_data_cutoff": "2026-10-14",
                  "model_version": "prophet_fixed_origin_20261015",
                  "decision_policy_version": "fixed_origin_weekly_v2_20261015", "origin_date": "2026-10-09",
                  "forecasts": [{"horizon_weeks": row["horizon"], "target_date": row["date"],
                                 "decision_forecast": row["forecast"]} for row in weekly[:13]]}
    digest = save(tmp_path / "prophet output/snapshots/vintages/issued-weekly/USDCNH.json", production)
    long = {"symbol": "USDCNH", "sourceDataCutoff": "2026-10-14",
            "weekly": {"productionRunId": "issued-weekly", "productionSha256": digest,
                       "originDate": "2026-10-09", "prefixDisplayEqual": True, "series": weekly,
                       "policyVersion": "weekly_extension_frozen_prefix_v1_20261015"},
            "monthly": {"status": "RESEARCH_ONLY", "originDate": "2026-09-30", "trainEnd": "2026-09-30", "series": monthly,
                        "latestActual": {"date": "2026-09-30", "value": 6.9},
                        "modelVersion": "independent-monthly", "policyVersion": "monthly-close"}}
    archive = {"runId": "issued-sidecar", "issuedAt": "2026-10-15T15:01:00+08:00", "pairs": {"USDCNH": long}}
    save(tmp_path / "prophet output/long_horizon/vintages/issued-sidecar.json", archive)
    return {"symbol": "USDCNH", "appVersion": "V0.1.1", "latestActual": {"date": "2026-10-09", "value": 7},
            "series": [{**row, "forecast": round(row["forecast"], 5)} for row in weekly[:13]],
            "longHorizon": {**long, "runId": archive["runId"], "issuedAt": archive["issuedAt"]},
            "issuedComparisons": {"weekly": [], "monthly": []},
            "walkforward": {"runId": "NEVER-EXPORT-REPLAY", "metrics": {"mape": 0}},
            "tradeSignal": {"clientSensitive": "NEVER-EXPORT-CLIENT-DATA"},
            "sourceUpdatedAt": "2099-01-01", "generatedAt": "2099-01-01"}


def test_exact_vintage_times_dimensions_and_reference_boundary(tmp_path):
    data = input_data(tmp_path)
    weekly, monthly = api.build_documents(data, tmp_path)
    assert weekly["generatedAt"] == "2026-10-15T07:01:00.000000Z"
    assert weekly["forecasts"][0]["generatedAt"] == "2026-10-15T07:00:00.000000Z"
    assert weekly["runId"] == "issued-sidecar" and weekly["productionRunId"] == "issued-weekly"
    assert len(weekly["forecasts"]) == 52 and len(monthly["forecasts"]) == 12
    assert [row["forecast"] for row in weekly["forecasts"][:13]] == [row["forecast"] for row in data["series"]]
    assert weekly["forecasts"][12]["referenceOnly"] is True
    assert weekly["forecasts"][13]["referenceOnly"] is True
    assert monthly["referenceOnly"] is True
    assert monthly["latestActual"]["date"] == "2026-09-30" and monthly["sourceDataCutoff"] == "2026-10-14"
    assert monthly["forecasts"][0]["targetDate"] == "2026-10-31"
    assert monthly["forecasts"][4]["targetDate"] == "2027-02-28"
    assert all(row["actual"] is None and row["lower"] is None and row["upper"] is None for row in weekly["forecasts"])
    assert weekly["quality"]["horizon"] == 13 and monthly["quality"]["horizon"] == 3
    assert all(doc["quality"]["sampleCount"] == 0 and doc["quality"]["mape"] is None for doc in (weekly, monthly))
    assert "NEVER-EXPORT" not in api.raw_json([weekly, monthly]).decode()


def test_same_horizon_mature_real_issued_metrics_only():
    rows = [{"origin": "2026-09-25", "target": "2026-10-02", "horizon": 1,
             "forecast": 11, "actual": 10, "anchor": 9},
            {"origin": "2026-09-18", "target": "2026-10-02", "horizon": 2,
             "forecast": 1000, "actual": 10, "anchor": 9},
            {"origin": "2026-10-02", "target": "2026-10-16", "horizon": 1,
             "forecast": 1000, "actual": 10, "anchor": 9}]
    quality = api.quality_for(rows, "weekly", 1, "2026-10-14")
    assert quality["sampleCount"] == 1 and quality["mape"] == .1
    assert quality["rmse"] == 1 and quality["mae"] == 1 and quality["directionAccuracy"] == 1
    assert quality["eligibleForExecution"] is False


def test_manifest_hashes_generation_atomicity_and_immutable_objects(tmp_path):
    data = input_data(tmp_path)
    output = tmp_path / "staging"
    manifest = api.export_batch(output, tmp_path, [data], generation_id="generation-a", published_at="2026-10-16T02:00:00Z")
    assert manifest["publishedAt"] == "2026-10-16T02:00:00.000000Z"
    for entry in manifest["catalog"]:
        path = output / "api-v1/data" / (entry["sha256"] + ".json")
        content = path.read_bytes()
        assert hashlib.sha256(content).hexdigest() == entry["sha256"]
        body = json.loads(content)
        assert body["generationId"] == manifest["generationId"]
        assert all(body[key] == entry[key] for key in ("symbol", "frequency", "modelVersion", "forecastScope"))
    old_manifest = (output / "api-v1/manifest.json").read_bytes()
    wrong = copy.deepcopy(data)
    wrong["longHorizon"]["weekly"]["series"][0]["forecast"] = 99
    with pytest.raises(ValueError, match="archive mismatch"):
        api.export_batch(output, tmp_path, [wrong])
    assert (output / "api-v1/manifest.json").read_bytes() == old_manifest
    old_path = output / "api-v1/data" / (manifest["catalog"][0]["sha256"] + ".json")
    old_content = old_path.read_bytes()
    newer = api.export_batch(output, tmp_path, [data], generation_id="generation-b")
    assert newer["catalog"][0]["sha256"] != manifest["catalog"][0]["sha256"]
    assert old_path.read_bytes() == old_content


def test_vintage_contents_and_timezone_required(tmp_path):
    data = input_data(tmp_path)
    path = tmp_path / "prophet output/snapshots/vintages/issued-weekly/USDCNH.json"
    record = json.loads(path.read_bytes())
    record["forecasts"][0]["decision_forecast"] = 100
    save(path, record)
    with pytest.raises(ValueError, match="original first 13"):
        api.build_documents(data, tmp_path)
    with pytest.raises(ValueError, match="timezone"):
        api.utc_timestamp("2026-10-15T15:00:00")


def test_duplicates_cannot_double_weight_real_issued_quality():
    row = {"origin": "2026-10-02", "target": "2026-10-09", "horizon": 1,
           "forecast": 30, "actual": 10, "anchor": 9}
    assert api.quality_for([row], "weekly", 1, "2026-10-14")["mape"] == 2
    with pytest.raises(ValueError, match="Duplicate"):
        api.quality_for([row, row], "weekly", 1, "2026-10-14")


def test_business_day_cutoff_is_checked_in_shanghai_not_utc(tmp_path):
    data = input_data(tmp_path)
    archive_path = tmp_path / "prophet output/long_horizon/vintages/issued-sidecar.json"
    production_path = tmp_path / "prophet output/snapshots/vintages/issued-weekly/USDCNH.json"
    archive = json.loads(archive_path.read_bytes())
    production = json.loads(production_path.read_bytes())
    production["recorded_at_utc"] = "2026-10-14T16:01:00Z"  # 2026-10-15 in Shanghai
    save(production_path, production)
    archive["issuedAt"] = "2026-10-14T16:02:00Z"
    data["longHorizon"]["issuedAt"] = archive["issuedAt"]
    save(archive_path, archive)
    assert api.build_documents(data, tmp_path)[0]["sourceDataCutoff"] == "2026-10-14"
    production["recorded_at_utc"] = "2026-10-14T15:59:00Z"
    save(production_path, production)
    with pytest.raises(ValueError, match="completed business day"):
        api.build_documents(data, tmp_path)


def test_fixture_hashes_are_exact_original_bytes():
    folder = Path(__file__).parent / "fixtures/consumer-api"
    manifest = json.loads((folder / "manifest.json").read_bytes())
    assert manifest["fixture"] is True
    for item in manifest["catalog"]:
        content = (folder / "data" / (item["sha256"] + ".json")).read_bytes()
        assert hashlib.sha256(content).hexdigest() == item["sha256"]
        body = json.loads(content)
        assert body["fixture"] is True and body["generationId"] == manifest["generationId"]
        assert body["referenceOnly"] is True
        assert all(point["referenceOnly"] is True for point in body["forecasts"])
