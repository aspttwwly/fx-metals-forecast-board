"""Display-only daily data contract; fixtures never read or modify production data."""
import copy
import importlib.util
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

import openpyxl


SPEC = importlib.util.spec_from_file_location(
    "daily_actuals_export", Path(__file__).resolve().parents[1] / "scripts/convert-data.py"
)
convert = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(convert)
ISSUED = datetime(2026, 10, 16, 16, 1, tzinfo=timezone.utc)  # Shanghai October 17


class DailyActualsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="fx-daily-actuals-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "data").mkdir()
        self.patch = patch.object(convert, "FORECAST_PROJECT_DIR", self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def save(self, rows, header=("Date", "Close")):
        path = self.root / "data/USDCNH.xlsx"
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.append(header)
        for row in rows:
            sheet.append(row)
        workbook.save(path)
        workbook.close()
        return path

    def read(self, **kwargs):
        return convert.read_daily_actuals("USDCNH", issued_at=ISSUED, **kwargs)

    def test_mixed_iso_dates_sort_and_preserve_exact_daily_closes(self):
        price = 7.123456789012345
        path = self.save([
            ("2026-10-16T00:00:00.000000", price),
            (date(2026, 10, 13), 7.13),
            ("2026-10-15 00:00:00", 7.15),
            ("2026-10-14", 7.14),
            (datetime(2026, 10, 12), 7.12),
        ])
        before = path.read_bytes()
        payload = self.read()
        self.assertEqual([row["date"] for row in payload["rows"]],
                         [f"2026-10-{day}" for day in range(12, 17)])
        self.assertEqual(payload["latest"], {"date": "2026-10-16", "close": price})
        self.assertEqual(payload["sourceDataCutoff"], "2026-10-16")
        self.assertEqual(payload["rawDataCutoff"], "2026-10-16")
        self.assertEqual(payload["sourceId"], "market-raw/USDCNH")
        self.assertEqual(payload["scope"], "DAILY_OBSERVED_DISPLAY_ONLY")
        self.assertNotIn(str(self.root), json.dumps(payload))
        self.assertEqual(before, path.read_bytes())

    def test_shanghai_issue_day_and_future_are_excluded_without_relabeling(self):
        self.save([("2026-10-16", 7.1), ("2026-10-17", 7.2), ("2026-10-18", 7.3)])
        payload = self.read()
        self.assertEqual(payload["issueDate"], "2026-10-17")
        self.assertEqual(payload["rawDataCutoff"], "2026-10-18")
        self.assertEqual(payload["sourceDataCutoff"], "2026-10-16")
        self.assertEqual(payload["rows"], [{"date": "2026-10-16", "close": 7.1}])

    def test_missing_empty_schema_and_no_complete_day_fail_explicitly(self):
        with self.assertRaisesRegex(ValueError, "DAILY_SOURCE_MISSING"):
            self.read()
        for rows, header, code in [
            ([], ("Date", "Close"), "DAILY_SOURCE_EMPTY"),
            ([("2026-10-17", 7)], ("Date", "Close"), "DAILY_NO_COMPLETE_DAY"),
            ([("2026-10-16", 7)], ("Date", "Price"), "DAILY_COLUMNS_INVALID"),
            ([("2026-10-16", 7, 7)], ("Date", "Close", "Close"), "DAILY_COLUMNS_INVALID"),
        ]:
            with self.subTest(code=code):
                self.save(rows, header)
                with self.assertRaisesRegex(ValueError, code):
                    self.read()

    def test_duplicate_dates_are_rejected_even_across_legal_representations(self):
        self.save([("2026-10-16", 7), (datetime(2026, 10, 16), 7)])
        with self.assertRaisesRegex(ValueError, "DAILY_DATE_DUPLICATE"):
            self.read()

    def test_invalid_dates_are_not_guessed_or_silently_dropped(self):
        for invalid in [None, "10/16/2026", "20261016", 20261016, "2026-02-30",
                        "2026-10-16T00:00:00Z", "2026-10-16 12:00:00", "2026-10-16 "]:
            with self.subTest(value=invalid):
                self.save([("2026-10-15", 7), (invalid, 7)])
                with self.assertRaisesRegex(ValueError, "DAILY_DATE_INVALID"):
                    self.read()

    def test_invalid_prices_fail_including_excluded_future_rows(self):
        for invalid in [None, True, "7.1", "nan", "inf", 0, -1, float("nan"), float("inf")]:
            with self.subTest(value=invalid):
                self.save([("2026-10-15", 7), ("2026-10-18", invalid)])
                with self.assertRaisesRegex(ValueError, "DAILY_CLOSE_INVALID"):
                    self.read()

    def test_issue_time_and_symbol_must_be_unambiguous(self):
        with self.assertRaisesRegex(ValueError, "DAILY_ISSUE_TIME_INVALID"):
            convert.read_daily_actuals("USDCNH", issued_at=datetime(2026, 10, 17))
        with self.assertRaisesRegex(ValueError, "DAILY_SYMBOL_INVALID"):
            convert.read_daily_actuals("../USDCNH", issued_at=ISSUED)

    def test_all_expected_raw_inputs_are_included_in_change_detection(self):
        with patch.object(convert, "ROOT", self.root), \
             patch.object(convert, "WALKFORWARD_POINTER_PATH", self.root / "absent-v11.json"), \
             patch.object(convert, "LEGACY_BACKFILL_POINTER_PATH", self.root / "absent-v10.json"):
            paths = convert.extra_source_paths()
        expected = {self.root / "data" / f"{symbol}.xlsx"
                    for symbols in convert.GROUPS.values() for symbol in symbols}
        self.assertEqual(len(expected), 10)
        self.assertTrue(expected.issubset(paths))

    def test_build_symbol_adds_daily_layer_without_changing_existing_payload(self):
        history = [("2026-10-09", 7.)]
        forecast = [("2026-10-09", 7.), ("2026-10-16", 7.1)]
        for name in ("USDCNH_diff_0th_diff.xlsx", "USDCNH_forecast.xlsx"):
            (self.root / name).touch()
        def read_two(path):
            return history if "diff" in path.name else forecast
        comparison = {"weekly": [{"target": "2026-10-09", "actual": 7., "forecast": 7.05}], "monthly": []}
        daily = {"latest": {"date": "2026-10-16", "close": 99.}, "rows": [{"date": "2026-10-16", "close": 99.}]}
        with patch.object(convert, "UPLOAD_DIR", self.root), \
             patch.object(convert, "read_two_column_xlsx", side_effect=read_two), \
             patch.object(convert, "read_versioned_replay", return_value={"metrics": ["frozen"]}), \
             patch.object(convert, "read_legacy_backfill", return_value={"version": "V0.1.0"}), \
             patch.object(convert, "read_issued_comparisons", return_value=copy.deepcopy(comparison)), \
             patch.object(convert, "read_daily_actuals", return_value=copy.deepcopy(daily)) as read_daily:
            payload = convert.build_symbol("USDCNH", {}, {}, {}, {}, {}, {})
        read_daily.assert_called_once_with("USDCNH")
        self.assertEqual(payload["dailyActuals"], daily)
        self.assertEqual(payload["latestActual"], {"date": "2026-10-09", "value": 7.})
        self.assertEqual(payload["nextForecast"], {"date": "2026-10-16", "value": 7.1})
        self.assertEqual(payload["series"][1]["actual"], None)
        self.assertEqual(payload["series"][1]["forecast"], 7.1)
        self.assertEqual(payload["issuedComparisons"], comparison)
        self.assertEqual(payload["walkforward"], {"metrics": ["frozen"]})
        self.assertEqual(payload["legacyBackfill"], {"version": "V0.1.0"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
