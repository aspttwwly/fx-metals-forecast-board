from __future__ import annotations

import json
import math
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = Path(os.getenv("FX_FORECAST_UPLOAD_DIR", str(ROOT / "upload file"))).resolve()
DATA_DIR = ROOT / "public" / "data"
FILES_DIR = DATA_DIR / "files"

GROUPS = {
    "人民币相关": ["USDCNH", "EURCNH", "GBPCNH", "AUDCNH"],
    "美元直盘": ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY", "USDCHF"],
    "贵金属": ["XAUUSD"],
}

NAMES = {
    "USDCNH": "美元 / 离岸人民币",
    "EURCNH": "欧元 / 离岸人民币",
    "GBPCNH": "英镑 / 离岸人民币",
    "AUDCNH": "澳元 / 离岸人民币",
    "EURUSD": "欧元 / 美元",
    "GBPUSD": "英镑 / 美元",
    "AUDUSD": "澳元 / 美元",
    "USDJPY": "美元 / 日元",
    "USDCHF": "美元 / 瑞郎",
    "XAUUSD": "黄金 / 美元",
}


def read_two_column_xlsx(path: Path) -> list[tuple[str, float]]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    rows: list[tuple[str, float]] = []

    for row in sheet.iter_rows(min_row=2, values_only=True):
        raw_date, raw_value = row[:2]
        if raw_date is None or raw_value is None:
            continue
        if isinstance(raw_date, datetime):
            date = raw_date.date().isoformat()
        else:
            date = str(raw_date)[:10]
        rows.append((date, float(raw_value)))

    return rows


def pct_band(symbol: str, value: float) -> float:
    if symbol == "XAUUSD":
        return max(value * 0.035, 25)
    if symbol == "USDJPY":
        return max(value * 0.018, 1.2)
    if symbol.endswith("CNH"):
        return max(value * 0.015, 0.045)
    return max(value * 0.018, 0.006)


def fmt(value: float) -> float:
    if abs(value) >= 100:
        return round(value, 2)
    if abs(value) >= 10:
        return round(value, 4)
    return round(value, 5)


def build_symbol(symbol: str) -> dict:
    history_path = UPLOAD_DIR / f"{symbol}_diff_0th_diff.xlsx"
    forecast_path = UPLOAD_DIR / f"{symbol}_forecast.xlsx"

    history = read_two_column_xlsx(history_path)
    forecast = read_two_column_xlsx(forecast_path)
    actual_by_date = dict(history)
    forecast_by_date = dict(forecast)
    dates = sorted(set(actual_by_date) | set(forecast_by_date))

    latest_actual_date, latest_actual_value = history[-1]
    future_forecasts = [(date, value) for date, value in forecast if date > latest_actual_date]
    next_forecast_date, next_forecast_value = future_forecasts[0] if future_forecasts else forecast[-1]
    deviation = next_forecast_value - latest_actual_value
    direction = "上行" if deviation > 0 else "下行" if deviation < 0 else "持平"

    series = []
    for date in dates:
        actual = actual_by_date.get(date)
        predicted = forecast_by_date.get(date)
        base = predicted if predicted is not None else actual
        low = high = None
        if base is not None and predicted is not None:
            band = pct_band(symbol, base)
            low = base - band
            high = base + band
        series.append(
            {
                "date": date,
                "actual": fmt(actual) if actual is not None else None,
                "forecast": fmt(predicted) if predicted is not None else None,
                "lower": fmt(low) if low is not None else None,
                "upper": fmt(high) if high is not None else None,
                "future": date > latest_actual_date,
            }
        )

    return {
        "symbol": symbol,
        "name": NAMES.get(symbol, symbol),
        "group": next(group for group, symbols in GROUPS.items() if symbol in symbols),
        "frequency": "周频",
        "modelVersion": "Prophet annealing v1",
        "generatedAt": datetime.now(timezone.utc).date().isoformat(),
        "sourceUpdatedAt": max(history_path.stat().st_mtime, forecast_path.stat().st_mtime),
        "latestActual": {"date": latest_actual_date, "value": fmt(latest_actual_value)},
        "nextForecast": {"date": next_forecast_date, "value": fmt(next_forecast_value)},
        "direction": direction,
        "deviation": fmt(deviation),
        "files": {
            "forecast": f"/data/files/{forecast_path.name}",
            "history": f"/data/files/{history_path.name}",
        },
        "series": series,
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)

    all_symbols = [symbol for symbols in GROUPS.values() for symbol in symbols]
    manifest_symbols = []

    for symbol in all_symbols:
        data = build_symbol(symbol)
        updated = datetime.fromtimestamp(data["sourceUpdatedAt"]).isoformat(timespec="seconds")
        data["sourceUpdatedAt"] = updated
        (DATA_DIR / f"{symbol}.json").write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

        for file_name in [f"{symbol}_forecast.xlsx", f"{symbol}_diff_0th_diff.xlsx"]:
            shutil.copy2(UPLOAD_DIR / file_name, FILES_DIR / file_name)

        manifest_symbols.append(
            {
                "symbol": symbol,
                "name": NAMES.get(symbol, symbol),
                "group": data["group"],
                "latestActual": data["latestActual"],
                "nextForecast": data["nextForecast"],
                "direction": data["direction"],
            }
        )

    manifest = {
        "title": "汇率与贵金属预测观察",
        "defaultSymbol": "USDCNH",
        "updatedAt": max(
            item.stat().st_mtime
            for item in UPLOAD_DIR.glob("*.xlsx")
            if not math.isnan(item.stat().st_mtime)
        ),
        "groups": GROUPS,
        "symbols": manifest_symbols,
    }
    manifest["updatedAt"] = datetime.fromtimestamp(manifest["updatedAt"]).isoformat(timespec="seconds")
    (DATA_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Wrote {len(all_symbols)} symbols to {DATA_DIR}")


if __name__ == "__main__":
    main()
