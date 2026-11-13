"""Compose daily actuals and independently issued frequency batches in staging.

This module has no Git/network side effects. sync-data retains its existing
dirty-tree, source-hash, concurrent-writer and fast-forward publication guards.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import shutil


def read(path):
    return json.loads(Path(path).read_bytes())


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False,
                      separators=(",", ":")).encode("utf-8")


def consumer_document(batch, item, symbol, observations=()):
    """v1 transport with distinct period completion evidence for holiday labels."""
    frequency = batch["frequency"]
    if (frequency not in ("weekly", "monthly") or batch.get("modelVersion") != "V0.1.2"
            or batch.get("policyVersion") != "rolling_reference_mae3_v1_20261018"
            or batch.get("eligibleForExecution") is not False or batch.get("referenceOnly") is not True):
        raise ValueError("Unknown rolling reference contract")
    maximum, default = (52, 13) if frequency == "weekly" else (12, 3)
    meta, path = item["data"], item["path"]
    if batch["status"] != "ISSUED_REFERENCE" or meta["status"] != "READY" or meta["missingSessions"]:
        raise ValueError("Research or incomplete periods cannot enter the public contract")
    if [point["horizon"] for point in path] != list(range(maximum + 1)):
        raise ValueError("Incomplete rolling forecast path")
    if meta["originDate"] != meta["scheduledOrigin"] or path[0]["target"] != meta["originDate"]:
        raise ValueError("Scheduled and actual origins disagree")
    moment = datetime.fromisoformat(batch["issuedAt"])
    if moment.tzinfo is None:
        raise ValueError("Rolling issue time must include timezone")
    issued = moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    api_spec = importlib.util.spec_from_file_location("rolling_consumer_api", Path(__file__).with_name("consumer_api.py"))
    api = importlib.util.module_from_spec(api_spec)
    api_spec.loader.exec_module(api)
    cutoff = meta["rawDataCutoff"]
    from datetime import timedelta, date
    import calendar
    issue_day = moment.astimezone(timezone(timedelta(hours=8))).date()
    origin = date.fromisoformat(meta["originDate"])
    last_session = date.fromisoformat(meta["expectedLastSession"])
    if not last_session <= date.fromisoformat(cutoff) < issue_day or not 0 <= (origin-last_session).days <= 6:
        raise ValueError("Rolling source/period/issue chronology is invalid")
    if frequency == "weekly" and origin.weekday() != 4 or frequency == "monthly" and origin.day != calendar.monthrange(origin.year,origin.month)[1]:
        raise ValueError("Rolling period label is invalid")
    for point in path[1:]:
        if frequency == "weekly":
            expected = origin + timedelta(weeks=point["horizon"])
        else:
            index = origin.year*12 + origin.month-1 + point["horizon"]
            year, month = divmod(index,12)
            expected = date(year,month+1,calendar.monthrange(year,month+1)[1])
        if point["target"] != str(expected) or expected < issue_day:
            raise ValueError("Rolling target/horizon mismatch or backdated forecast")
    quality = [api.quality_for(list(observations), frequency, h, cutoff) for h in range(1, maximum + 1)]
    selected_label = "尚无足够独立样本与简单基准比较"
    scores = item["selection"].get("metrics")
    if scores:
        selected = scores["candidate" if item["selection"]["decision"] == "PROMOTE_REFERENCE_ONLY" else "old"]
        beats = all(selected["mae"] < scores[name]["mae"] and selected["rmse"] <= scores[name]["rmse"] for name in ("naive", "drift"))
        selected_label = "优于简单基准" if beats else "未胜简单基准"
    completed = {"schema": "fx-period-completion/v1", "frequency": frequency,
                 "periodLabel": meta["originDate"], "lastSession": meta["expectedLastSession"],
                 "calendarVersion": meta["calendarVersion"], "calendarSha256": meta["calendarSha256"],
                 "missingSessions": [], "status": "COMPLETE", "sourceSha256": meta["rawSha256"],
                 "closureEvidence": meta.get("closureEvidence", [])}
    doc = {"schemaVersion": 1, "symbol": symbol, "frequency": frequency,
           "modelVersion": batch["modelVersion"], "forecastScope": "PUBLISHED_FORECAST",
           "runId": batch["runId"], "productionRunId": batch["runId"],
           "engineVersion": item["chainVersion"], "policyVersion": batch["policyVersion"],
           "extensionPolicyVersion": "GENERATE_MAXIMUM_ONCE_SLICE_ONLY",
           "generatedAt": issued, "sourceDataCutoff": cutoff,
           "latestActual": {"date": meta["originDate"], "value": path[0]["anchor"]},
           "defaultHorizon": default, "maximumHorizon": maximum,
           "forecasts": [{"targetDate": point["target"], "horizon": point["horizon"],
                          "forecast": point["forecast"], "actual": None, "lower": None, "upper": None,
                          "generatedAt": issued, "referenceOnly": True} for point in path[1:]],
           "quality": quality[default - 1], "qualityByHorizon": quality,
           "referenceOnly": True, "eligibleForExecution": False, "businessTimezone": "Asia/Shanghai",
           "intervalCalibration": "NOT_ESTIMATED", "periodCompletion": completed,
           "targetDefinition": "FRIDAY_LAST_SESSION_CLOSE" if frequency == "weekly" else "CALENDAR_MONTH_END_LAST_SESSION_CLOSE",
           "parameterDecision": item["selection"]["decision"],
           "baselineComparison": selected_label,
           "baselineComparisonScope": "FROZEN_PARAMETER_HOLDOUT_REPLAY"}
    if meta.get('referenceInput'):
        ref = meta['referenceInput']
        if (symbol != 'AUDCNH' or ref.get('policy') != 'audcnh_reciprocal_reference_20261018_v1'
                or ref.get('role') != 'DERIVED_TEMPORARY_REFERENCE' or ref.get('referenceOnly') is not True
                or ref.get('eligibleForExecution') is not False or ref.get('inputSha256') != meta['rawSha256']
                or not ref.get('derivedSessions') or not set(ref['derivedSessions']) <= set(ref.get('primaryMissingSessions', []))):
            raise ValueError('Unapproved reciprocal reference input')
        doc['referenceInput'] = meta['referenceInput']
        doc['periodCompletion']['basis'] = 'TEMPORARY_REFERENCE_INPUT'
        doc['periodCompletion']['primaryMissingSessions'] = meta['referenceInput']['primaryMissingSessions']
        doc['latestActual']['valueRole'] = ('DERIVED_REFERENCE_ANCHOR'
            if meta['expectedLastSession'] in meta['referenceInput']['derivedSessions'] else 'PRIMARY')
    for point in doc["forecasts"]:
        if (isinstance(point["forecast"], bool) or not isinstance(point["forecast"], (int, float))
                or not math.isfinite(point["forecast"]) or point["forecast"] <= 0):
            raise ValueError("Invalid reference price")
    return doc


def refresh_terrain(document, symbol, market, central, converter, staging):
    import tempfile
    from terrain_filter import compute_terrain_features, load_ohlc
    latest = document["dailyActuals"]["latest"]
    features = compute_terrain_features(load_ohlc(market / f"{symbol}.xlsx", end_date=latest["date"]))
    with tempfile.TemporaryDirectory() as folder:
        temporary = Path(folder)
        features.to_csv(temporary / f"{symbol}_terrain_features.csv", index=False)
        previous = converter.TERRAIN_FEATURE_DIR
        try:
            converter.TERRAIN_FEATURE_DIR = temporary
            series = converter.read_terrain_series(symbol)
        finally:
            converter.TERRAIN_FEATURE_DIR = previous
    if not series or series[-1]["date"] != latest["date"] or series[-1]["close"] != converter.fmt(latest["close"]):
        raise ValueError(f"{symbol}: GMMA cutoff or close differs from daily actuals")
    (staging / f"terrain/{symbol}.json").write_bytes(json.dumps({
        "symbol": symbol, "centralMarket": central, "series": series,
    }, allow_nan=False, separators=(",", ":")).encode())


def compose(root, staging, converter):
    root, staging = Path(root), Path(staging)
    source = root / "public/data"
    shutil.copytree(source, staging, dirs_exist_ok=True)
    project = converter.FORECAST_PROJECT_DIR
    rolling = project / "prophet output/rolling_reference"
    pointer_path = rolling / "latest.json"
    pointer = read(pointer_path) if pointer_path.exists() else {"frequencies": {}}
    status_path = rolling / "latest_status.json"
    status = read(status_path) if status_path.exists() else None
    if status:
        status = {key: status.get(key) for key in ("checkedAt", "workflow", "status")} | {
            "frequencies": {freq: {key: info.get(key) for key in ("scheduledOrigin", "dueAt", "formalReady")} |
                {"pairs": {symbol: {key: meta.get(key) for key in ("status", "rawDataCutoff", "originDate", "missingSessions")}
                           for symbol, meta in info["pairs"].items()}}
                for freq, info in status.get("frequencies", {}).items()}}
    manifest = read(source / "manifest.json")
    old_api = read(source / "api-v1/manifest.json")
    api_documents = {}
    for entry in old_api["catalog"]:
        body = (source / "api-v1/data" / (entry["sha256"] + ".json")).read_bytes()
        if hashlib.sha256(body).hexdigest() != entry["sha256"]:
            raise ValueError("Prior public API bytes changed")
        doc = json.loads(body)
        if doc["generationId"] != old_api["generationId"]:
            raise ValueError("Prior API generation mismatch")
        api_documents[(doc["symbol"], doc["frequency"], doc["modelVersion"], doc["forecastScope"])] = doc
    new_docs = []
    batches = {}
    formal_history = {"weekly": {}, "monthly": {}}
    for archived_path in sorted((rolling / "vintages").glob("*.json")):
        archived = read(archived_path)
        if (archived.get("status") == "ISSUED_REFERENCE" and archived.get("modelVersion") == "V0.1.2"
                and archived.get("policyVersion") == "rolling_reference_mae3_v1_20261018"):
            for symbol, item in archived["pairs"].items():
                if item['data']['expectedLastSession'] in item['data'].get('referenceInput', {}).get('derivedSessions', []):
                    continue  # A reciprocal anchor must not become a historical realised price.
                formal_history[archived["frequency"]].setdefault(symbol, []).append(
                    {"date": item["data"]["originDate"], "actual": item["path"][0]["anchor"]})
    symbols = [item["symbol"] for item in manifest["symbols"]]
    if len(set(symbols)) != len(symbols):
        raise ValueError("Duplicate public instrument")
    for frequency, entry in pointer["frequencies"].items():
        body = (rolling / "vintages" / f"{entry['runId']}.json").read_bytes()
        if hashlib.sha256(body).hexdigest() != entry["sha256"]:
            raise ValueError("Rolling archive hash mismatch")
        batch = json.loads(body)
        if batch["frequency"] != frequency or batch["runId"] != entry["runId"]:
            raise ValueError("Rolling pointer identity mismatch")
        if set(batch["pairs"]) != set(symbols):
            raise ValueError("Rolling batch instrument coverage differs from dashboard")
        batches[frequency] = batch
    weekly = batches.get("weekly")
    if weekly and weekly["runId"] != "20261107T040358_ea0493d9":
        run_id = weekly["runId"]
        alignment = read(rolling / "aligned_weekly" / f"{run_id}.json")
        official_sha = hashlib.sha256((rolling / "vintages" / f"{run_id}.json").read_bytes()).hexdigest()
        if (alignment.get("schema") != "fx-aligned-weekly-comparison/v1"
                or alignment.get("status") != "PASS"
                or alignment.get("vintageSha256") != official_sha
                or alignment.get("centralMarket") != weekly["inputFreeze"]["centralMarket"]
                or set(alignment["pairs"]) != set(symbols)):
            raise ValueError("Weekly reference is missing its accepted ten-pair comparison")
        for symbol, entry in alignment["pairs"].items():
            item = weekly["pairs"][symbol]
            official = item["path"][:14]
            if (entry["origin"] != weekly["scheduledOrigin"] or entry["v012RunId"] != run_id
                    or entry.get("referenceInput") != item["data"].get("referenceInput")
                    or set(entry["series"]) != {"V0.1.0", "V0.1.1"}):
                raise ValueError(f"{symbol}: comparison provenance mismatch")
            for series in entry["series"].values():
                if (len(series) != 14 or [point["date"] for point in series] != [point["target"] for point in official]
                        or any(not math.isfinite(point["forecast"]) or point["forecast"] <= 0 for point in series)
                        or abs(series[0]["forecast"] - official[0]["forecast"]) > 1e-10):
                    raise ValueError(f"{symbol}: invalid accepted comparison path")
        (staging / "aligned-weekly.json").write_bytes(encode(alignment))
    import sys
    sys.path.insert(0, str(project))
    central_path = project / "data/central_market/current.json"
    central = read(central_path)["pointer"] if central_path.exists() else None
    if central is None and (project / "central_market_config.json").exists():
        raise ValueError("Missing verified central market pointer")
    if central:
        from central_market import verify_batch
        market = project / "data/central_market/versions" / central["data_version"]
        verify_batch(market, central["manifest_sha256"])
    actuals_as_of = datetime.now(timezone.utc)
    for symbol_item in manifest["symbols"]:
        symbol = symbol_item["symbol"]
        document = read(source / f"{symbol}.json")
        if document.get("localPreview"):
            raise ValueError("A local preview cannot be published")
        document["dailyActuals"] = converter.read_daily_actuals(symbol, issued_at=actuals_as_of)
        if central:
            refresh_terrain(document, symbol, market, central, converter, staging)
            if read(central_path)["pointer"] != central:
                raise ValueError("Central market pointer changed during GMMA generation")
        document["cadenceStatus"] = status
        document.setdefault("rollingReference", {})
        for frequency, batch in batches.items():
            item = batch["pairs"][symbol]
            # Issued metrics for this new chain start empty and accumulate from
            # this chain's immutable archives only. Legacy/replay metrics remain
            # visible under their own original version.
            doc = consumer_document(batch, item, symbol, item.get("issuedComparisons", []))
            new_docs.append(doc)
            document["rollingReference"][frequency] = {"runId": batch["runId"], "issuedAt": batch["issuedAt"],
                "modelVersion": batch["modelVersion"], "policyVersion": batch["policyVersion"],
                "sourceDataCutoff": item["data"]["rawDataCutoff"], "latestActual": doc["latestActual"],
                "referenceInput": doc.get('referenceInput'),
                "selection": {**item["selection"], "selectedBaselineLabel": doc["baselineComparison"]},
                "trainingMonths": item["parameters"]["window"],
                "issuedActuals": formal_history[frequency].get(symbol, []),
                "issuedComparisons": item.get("issuedComparisons", []),
                "qualityByHorizon": doc["qualityByHorizon"],
                "series": [{"date": point["target"], "horizon": point["horizon"], "forecast": point["forecast"],
                            "actual": point["anchor"] if point["horizon"] == 0 and doc['latestActual'].get('valueRole') != 'DERIVED_REFERENCE_ANCHOR' else None,
                            "future": point["horizon"] > 0, "lower": None, "upper": None} for point in item["path"]]}
        (staging / f"{symbol}.json").write_bytes(encode(document))
    # Reuse the API generation byte-for-byte on daily-only refreshes. New values
    # replace only their own symbol/frequency/version key; other batches retain
    # their original issue time, cutoff, runId and quality.
    changed = False
    for doc in new_docs:
        key = tuple(doc[k] for k in ("symbol", "frequency", "modelVersion", "forecastScope"))
        previous = api_documents.get(key)
        if previous is None or {k: v for k, v in previous.items() if k != "generationId"} != doc:
            changed = True
        api_documents[key] = doc
    if changed:
        import uuid
        generation = uuid.uuid4().hex
        catalog = []
        for key, doc in sorted(api_documents.items()):
            doc["generationId"] = generation
            body = encode(doc)
            sha = hashlib.sha256(body).hexdigest()
            target = staging / "api-v1/data" / f"{sha}.json"
            if target.exists() and target.read_bytes() != body:
                raise ValueError("API content collision")
            target.write_bytes(body)
            catalog.append(dict(zip(("symbol", "frequency", "modelVersion", "forecastScope"), key)) |
                           {"dataPath": f"/api/v1/data/{sha}.json", "sha256": sha})
        api_manifest = {"schemaVersion": 1, "generationId": generation,
                        "publishedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "catalog": catalog}
        (staging / "api-v1/manifest.json").write_bytes(encode(api_manifest))
    manifest["updatedAt"] = datetime.now(timezone.utc).isoformat()
    manifest["updateKind"] = "INDEPENDENT_FREQUENCY_AND_DAILY_ACTUALS"
    (staging / "manifest.json").write_bytes(encode(manifest))
