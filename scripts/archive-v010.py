"""Recover the last pre-repair published payload verbatim, never overwrite it."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "d077c2823e014f65db160fd6af96edf37d69dee2"
PAIRS = ("USDCNH","EURCNH","GBPCNH","AUDCNH","EURUSD","GBPUSD","AUDUSD","USDJPY","USDCHF","XAUUSD")


def main():
    folder = ROOT / "public/data/versions/v0.1.0"
    folder.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for pair in PAIRS:
        content = subprocess.check_output(["git","show",f"{COMMIT}:public/data/{pair}.json"],cwd=ROOT)
        json.loads(content)
        path = folder / f"{pair}.json"
        if path.exists():
            if path.read_bytes() != content:
                raise ValueError(f"Refusing to overwrite changed V0.1.0: {pair}")
        else:
            with path.open("xb") as handle: handle.write(content)
        hashes[pair] = hashlib.sha256(content).hexdigest()
    metadata = {"version":"V0.1.0","sourceCommit":COMMIT,"snapshotDate":"2026-10-14",
                "sha256":hashes,"note":"修复前最后发布版本，原始JSON逐字节保留；包括原有时间边界问题，仅供旧版追溯。"}
    encoded = json.dumps(metadata,ensure_ascii=False,indent=2).encode("utf-8")
    manifest = folder / "manifest.json"
    if manifest.exists():
        if manifest.read_bytes() != encoded: raise ValueError("V0.1.0 manifest changed")
    else:
        with manifest.open("xb") as handle: handle.write(encoded)
    print(f"Restored immutable V0.1.0 for {len(hashes)} symbols")


if __name__ == "__main__": main()
