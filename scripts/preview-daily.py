"""One-shot local daily-close overlay in a fresh dist build; never a publisher."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RECEIPT_NAME = "daily-preview-receipt.json"


def plain_path(path: Path, root: Path) -> Path:
    """Refuse symlinks and Windows junctions at every existing project component."""
    path, root = Path(os.path.abspath(path)), Path(os.path.abspath(root))
    try:
        parts = path.relative_to(root).parts
    except ValueError as exc:
        raise ValueError("PREVIEW_PATH_OUTSIDE_ROOT") from exc
    current = root
    for part in (None, *parts):
        if part is not None:
            current /= part
        if not os.path.lexists(current):
            raise ValueError("PREVIEW_PATH_MISSING")
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
            raise ValueError("PREVIEW_LINK_REFUSED")
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("PREVIEW_PATH_OUTSIDE_ROOT")
    return path


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def check_sources(sources):
    for path, root, expected in sources:
        if digest(plain_path(path, root).read_bytes()) != expected:
            raise ValueError("PREVIEW_SOURCE_CHANGED")


def atomic_dist_write(path: Path, content: bytes, root: Path):
    plain_path(path.parent, root)
    if os.path.lexists(path):
        plain_path(path, root)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=f".{path.name}.preview-", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
        plain_path(path.parent, root)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def create_preview(root: Path, converter, *, issued_at=None) -> dict:
    root = plain_path(root, root)
    dist = plain_path(root / "dist", root)
    plain_path(dist / "data", root)
    receipt_path = dist / RECEIPT_NAME
    if os.path.lexists(receipt_path):
        raise ValueError("PREVIEW_ALREADY_PRESENT_REBUILD_FIRST")
    source_root = Path(converter.FORECAST_PROJECT_DIR)
    plain_path(source_root, source_root)
    symbols = [symbol for group in converter.GROUPS.values() for symbol in group]
    if len(symbols) != 10 or len(set(symbols)) != 10 or any(
        not isinstance(symbol, str) or not symbol.isascii() or not symbol.isalpha() or not symbol.isupper()
        for symbol in symbols
    ):
        raise ValueError("PREVIEW_EXPECTS_TEN_SYMBOLS")
    issue = issued_at if issued_at is not None else datetime.now(timezone.utc)
    originals, documents, sources = {}, {}, []
    for symbol in symbols:
        public = plain_path(root / "public/data" / f"{symbol}.json", root)
        target = plain_path(dist / "data" / f"{symbol}.json", root)
        content = public.read_bytes()
        if target.read_bytes() != content:
            raise ValueError(f"{symbol}: PREVIEW_DIST_NOT_FRESH_REBUILD_FIRST")
        document = json.loads(content)
        if not isinstance(document, dict) or document.get("symbol") != symbol:
            raise ValueError(f"{symbol}: PREVIEW_SYMBOL_MISMATCH")
        if "dailyActuals" in document or "localPreview" in document:
            raise ValueError(f"{symbol}: PREVIEW_OVERLAY_ALREADY_PRESENT")
        originals[target], documents[symbol] = content, document
        sources.append((public, root, digest(content)))
        raw = plain_path(source_root / "data" / f"{symbol}.xlsx", source_root)
        sources.append((raw, source_root, digest(raw.read_bytes())))
    # All ten raw hashes are frozen before the first reader is called.
    daily = {symbol: converter.read_daily_actuals(symbol, issued_at=issue) for symbol in symbols}
    check_sources(sources)
    outputs = {}
    for symbol in symbols:
        target = dist / "data" / f"{symbol}.json"
        document = documents[symbol]
        document.update(dailyActuals=daily[symbol], localPreview=True)
        outputs[target] = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    check_sources(sources)
    for target, content in originals.items():
        if plain_path(target, root).read_bytes() != content:
            raise ValueError("PREVIEW_DIST_CHANGED")
    written = []
    receipt_content = None
    try:
        for target, content in outputs.items():
            if plain_path(target, root).read_bytes() != originals[target]:
                raise ValueError("PREVIEW_DIST_CHANGED")
            atomic_dist_write(target, content, root)
            written.append(target)
        check_sources(sources)
        if any(plain_path(path, root).read_bytes() != content for path, content in outputs.items()):
            raise ValueError("PREVIEW_OUTPUT_CHANGED")
        receipt = {"schema": "fx-local-daily-preview/v1", "localPreview": True,
                   "symbols": symbols, "publicUnchanged": True, "rawUnchanged": True,
                   "sourceCutoffs": {symbol: daily[symbol]["sourceDataCutoff"] for symbol in symbols}}
        if os.path.lexists(receipt_path):
            raise ValueError("PREVIEW_RECEIPT_CHANGED")
        receipt_content = json.dumps(receipt, ensure_ascii=False, indent=2).encode("utf-8")
        atomic_dist_write(receipt_path, receipt_content, root)
        check_sources(sources)
        return receipt
    except Exception:
        if receipt_content is not None and os.path.lexists(receipt_path):
            if plain_path(receipt_path, root).read_bytes() == receipt_content:
                receipt_path.unlink()
        # Restore only our own bytes, never clobber a concurrent writer's data.
        for target in written:
            if plain_path(target, root).read_bytes() == outputs[target]:
                atomic_dist_write(target, originals[target], root)
        raise


def main() -> int:
    try:
        source = plain_path(ROOT / "scripts/convert-data.py", ROOT)
        spec = importlib.util.spec_from_file_location("daily_preview_converter", source)
        converter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(converter)
        receipt = create_preview(ROOT, converter)
        print(f"LOCAL_PREVIEW_OK symbols={len(receipt['symbols'])} publicUnchanged=true rawUnchanged=true")
        return 0
    except Exception as exc:
        # Do not print source paths, credentials, or arbitrary workbook content.
        message = str(exc) if isinstance(exc, ValueError) and "PREVIEW_" in str(exc) else type(exc).__name__
        print(f"LOCAL_PREVIEW_REFUSED {message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
