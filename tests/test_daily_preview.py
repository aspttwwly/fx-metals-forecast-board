"""All preview writes are confined to disposable fixture projects."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location(
    "daily_preview", Path(__file__).resolve().parents[1] / "scripts/preview-daily.py"
)
preview = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preview)
SYMBOLS = ["USDCNH", "EURCNH", "GBPCNH", "AUDCNH", "EURUSD", "GBPUSD", "AUDUSD", "USDJPY", "USDCHF", "XAUUSD"]
ISSUED = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)


class DailyPreviewTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="fx-daily-preview-")
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        self.root, self.backend = self.base / "ui", self.base / "backend"
        for path in (self.root / "public/data", self.root / "dist/data", self.backend / "data"):
            path.mkdir(parents=True)
        self.public, self.raw, self.originals = {}, {}, {}
        for symbol in SYMBOLS:
            content = json.dumps({"symbol": symbol, "latestActual": {"date": "2026-10-09", "value": 7},
                                  "series": [{"date": "2026-10-16", "actual": None, "forecast": 7.1}],
                                  "walkforward": {"metrics": [1, 2]}, "longHorizon": {"runId": "frozen"}}).encode()
            public, target, raw = (self.root / "public/data" / f"{symbol}.json",
                                   self.root / "dist/data" / f"{symbol}.json", self.backend / "data" / f"{symbol}.xlsx")
            public.write_bytes(content)
            target.write_bytes(content)
            raw.write_bytes(f"fixture-{symbol}".encode())
            self.public[public] = content
            self.raw[raw] = raw.read_bytes()
            self.originals[target] = content
        self.converter = SimpleNamespace(FORECAST_PROJECT_DIR=self.backend, GROUPS={"fixture": SYMBOLS},
                                         read_daily_actuals=Mock(side_effect=self.daily))

    @staticmethod
    def daily(symbol, *, issued_at):
        return {"symbol": symbol, "sourceDataCutoff": "2026-10-15", "issueDate": "2026-10-17",
                "latest": {"date": "2026-10-15", "close": 7.2}, "rows": [{"date": "2026-10-15", "close": 7.2}]}

    def run_preview(self):
        return preview.create_preview(self.root, self.converter, issued_at=ISSUED)

    def assert_unwritten(self):
        self.assertTrue(all(path.read_bytes() == content for path, content in self.originals.items()))
        self.assertFalse((self.root / "dist" / preview.RECEIPT_NAME).exists())

    def test_only_dist_daily_layer_is_added_and_repeat_run_is_refused(self):
        receipt = self.run_preview()
        self.assertTrue(receipt["publicUnchanged"] and receipt["rawUnchanged"])
        self.assertEqual(self.converter.read_daily_actuals.call_count, 10)
        for call in self.converter.read_daily_actuals.call_args_list:
            self.assertEqual(call.kwargs["issued_at"], ISSUED)
        for path, content in {**self.public, **self.raw}.items():
            self.assertEqual(path.read_bytes(), content)
        for path, content in self.originals.items():
            result = json.loads(path.read_bytes())
            self.assertTrue(result.pop("localPreview"))
            self.assertEqual(result.pop("dailyActuals")["latest"]["date"], "2026-10-15")
            self.assertEqual(result, json.loads(content))
        self.assertEqual(json.loads((self.root / "dist" / preview.RECEIPT_NAME).read_bytes()), receipt)
        with self.assertRaisesRegex(ValueError, "ALREADY_PRESENT"):
            self.run_preview()
        self.assertEqual(self.converter.read_daily_actuals.call_count, 10)

    def test_one_mismatching_dist_file_blocks_all_writes_before_readers(self):
        path = next(iter(self.originals))
        path.write_bytes(b"different")
        with self.assertRaisesRegex(ValueError, "DIST_NOT_FRESH"):
            self.run_preview()
        self.converter.read_daily_actuals.assert_not_called()
        path.write_bytes(self.originals[path])
        self.assert_unwritten()

    def test_reader_failure_does_not_write_partial_preview(self):
        def fail(symbol, **kwargs):
            if symbol == SYMBOLS[6]:
                raise ValueError("DAILY_CLOSE_INVALID")
            return self.daily(symbol, **kwargs)
        self.converter.read_daily_actuals.side_effect = fail
        with self.assertRaisesRegex(ValueError, "DAILY_CLOSE_INVALID"):
            self.run_preview()
        self.assert_unwritten()

    def test_raw_or_public_change_during_read_is_detected_before_writes(self):
        for changed in (next(iter(self.raw)), next(iter(self.public))):
            before = changed.read_bytes()
            def mutate(symbol, **kwargs):
                changed.write_bytes(before + b"changed")
                return self.daily(symbol, **kwargs)
            self.converter.read_daily_actuals.side_effect = mutate
            with self.subTest(path=changed.name):
                with self.assertRaisesRegex(ValueError, "SOURCE_CHANGED"):
                    self.run_preview()
                self.assert_unwritten()
            changed.write_bytes(before)

    def test_source_change_after_writes_rolls_back_only_dist(self):
        original_write = preview.atomic_dist_write
        changed = next(iter(self.raw))
        def mutate(path, content, root):
            original_write(path, content, root)
            changed.write_bytes(b"concurrent source edit")
        with patch.object(preview, "atomic_dist_write", side_effect=mutate):
            with self.assertRaisesRegex(ValueError, "SOURCE_CHANGED"):
                self.run_preview()
        self.assert_unwritten()
        self.assertEqual(changed.read_bytes(), b"concurrent source edit")

    def test_source_change_during_receipt_removes_own_receipt_and_rolls_back(self):
        original_write = preview.atomic_dist_write
        changed = next(iter(self.raw))
        def mutate(path, content, root):
            original_write(path, content, root)
            if path.name == preview.RECEIPT_NAME:
                changed.write_bytes(b"concurrent source edit")
        with patch.object(preview, "atomic_dist_write", side_effect=mutate):
            with self.assertRaisesRegex(ValueError, "SOURCE_CHANGED"):
                self.run_preview()
        self.assert_unwritten()

    def test_cli_native_exit_codes_are_zero_then_one_on_repeat(self):
        scripts = self.root / "scripts"
        scripts.mkdir()
        (scripts / "preview-daily.py").write_bytes(Path(preview.__file__).read_bytes())
        stub = ("from pathlib import Path\n"
                "FORECAST_PROJECT_DIR=Path(__file__).resolve().parents[2]/'backend'\n"
                f"GROUPS={{'fixture':{SYMBOLS!r}}}\n"
                "def read_daily_actuals(symbol, *, issued_at):\n"
                "    return {'symbol':symbol,'sourceDataCutoff':'2026-10-15'}\n"
                "def main():\n"
                "    raise AssertionError('converter main must not run')\n"
                "def build_symbol(*args):\n"
                "    raise AssertionError('build_symbol must not run')\n")
        (scripts / "convert-data.py").write_text(stub, encoding="utf-8")
        command = [sys.executable, "-B", str(scripts / "preview-daily.py")]
        first = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("LOCAL_PREVIEW_OK", first.stdout)
        second = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(second.returncode, 1)
        self.assertIn("ALREADY_PRESENT", second.stderr)

    def test_existing_overlay_keys_and_bad_symbol_identity_are_rejected(self):
        symbol = SYMBOLS[0]
        public, target = self.root / "public/data" / f"{symbol}.json", self.root / "dist/data" / f"{symbol}.json"
        for bad, code in [({"symbol": symbol, "localPreview": False}, "OVERLAY_ALREADY"),
                          ({"symbol": symbol, "dailyActuals": {}}, "OVERLAY_ALREADY"),
                          ({"symbol": "OTHER"}, "SYMBOL_MISMATCH")]:
            content = json.dumps(bad).encode()
            public.write_bytes(content)
            target.write_bytes(content)
            with self.subTest(code=code):
                with self.assertRaisesRegex(ValueError, code):
                    self.run_preview()
        self.converter.read_daily_actuals.assert_not_called()

    def test_path_outside_project_and_windows_reparse_points_are_refused(self):
        with self.assertRaisesRegex(ValueError, "OUTSIDE_ROOT"):
            preview.plain_path(self.backend, self.root)
        original = Path.lstat
        dist = self.root / "dist"
        def reparse(path):
            info = original(path)
            return SimpleNamespace(st_mode=info.st_mode, st_file_attributes=0x400) if path == dist else info
        with patch.object(Path, "lstat", reparse):
            with self.assertRaisesRegex(ValueError, "LINK_REFUSED"):
                self.run_preview()
        self.assert_unwritten()

    def test_real_symlink_is_refused_when_supported(self):
        link = self.root / "linked"
        try:
            os.symlink(self.backend, link, target_is_directory=True)
        except OSError as exc:
            self.skipTest(f"Symlink creation unavailable: {type(exc).__name__}")
        with self.assertRaisesRegex(ValueError, "LINK_REFUSED"):
            preview.plain_path(link, self.root)
        link.unlink()


if __name__ == "__main__":
    unittest.main(verbosity=2)
