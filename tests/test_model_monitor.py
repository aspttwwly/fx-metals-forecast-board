import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("conversion", Path(__file__).resolve().parents[1] / "scripts/convert-data.py")
conversion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conversion)


class ModelMonitorTests(unittest.TestCase):
    def test_success_exports_only_review_metadata_and_per_question_confidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "jev.json"
            source.write_text(json.dumps({
                "created_at_utc": "2026-10-13T14:36:00+00:00", "judgments": [{
                    "pair": "USDCNH", "status": "SHADOW_EVALUATED", "model": "jev-1.13.0",
                    "state": {"private": "not for publication"},
                    "answers": {
                        "review_need": {"choice": "evidence_building", "confidence": 1},
                        "main_issue": {"choice": "oos_deterioration", "confidence": 0.53},
                        "legacy_assessment": {"choice": "underperforming", "confidence": 0},
                    },
                }],
            }), encoding="utf-8")
            with patch.object(conversion, "JEV_SHADOW_PATH", source), patch.object(conversion, "FORECAST_PROJECT_DIR", root):
                result = conversion.read_model_monitor()["USDCNH"]
        self.assertEqual(result["jevModel"], "jev-1.13.0")
        self.assertEqual(result["jevReviewedAtUtc"], "2026-10-13T14:36:00+00:00")
        self.assertEqual(result["reviewConfidence"], 1)
        self.assertEqual(result["mainIssueConfidence"], 0.53)
        self.assertEqual(result["legacyAssessmentConfidence"], 0)
        self.assertNotIn("not for publication", json.dumps(result))

    def test_confidence_rejects_invalid_or_missing_values(self):
        for value in (None, True, "0.8", -1, 2, float("nan"), float("inf")):
            self.assertIsNone(conversion.jev_confidence({"confidence": value}))

    def test_export_keeps_region_failure_without_private_response_detail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "logs").mkdir()
            (root / "logs/pipeline_run_fixture.json").write_text(json.dumps({
                "status": "OK_WITH_WARNINGS", "run_id": "20261012_120000", "data_cutoff": "2026-10-09",
            }), encoding="utf-8")
            source = root / "jev.json"
            source.write_text(json.dumps({"judgments": [{
                "pair": "USDCNH", "status": "API_ERROR", "http_status": 451,
                "error_code": "REGION_UNAVAILABLE", "error_detail": "private upstream response",
                "state": {"forecast_run_date": "2026-10-12T00:00:00"},
                "answers": {"review_need": {"choice": "routine", "confidence": 1}},
                "governance": {"status": "EVIDENCE_BUILDING"},
            }]}), encoding="utf-8")
            with patch.object(conversion, "JEV_SHADOW_PATH", source), patch.object(conversion, "FORECAST_PROJECT_DIR", root):
                result = conversion.read_model_monitor()["USDCNH"]
        self.assertEqual(result["jevHttpStatus"], 451)
        self.assertEqual(result["jevErrorCode"], "REGION_UNAVAILABLE")
        self.assertEqual(result["governanceStatus"], "EVIDENCE_BUILDING")
        self.assertEqual(result["sourceDataCutoff"], "2026-10-09")
        self.assertIsNone(result["reviewNeed"])
        self.assertIsNone(result["reviewConfidence"])
        self.assertIsNone(result["jevModel"])
        self.assertNotIn("private upstream", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
