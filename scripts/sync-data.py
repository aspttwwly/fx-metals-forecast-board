"""Publish generated FX data without an interactive Git rebase or force push."""
from __future__ import annotations
import contextlib
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def git(root, *args, check=True, network=False):
    env = os.environ.copy()
    env.update(GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never')
    for attempt in range(3 if network else 1):
        p = subprocess.run(['git', *args], cwd=root, env=env, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=90)
        if p.returncode == 0 or not network or attempt == 2:
            break
        time.sleep(3)
    if check and p.returncode:
        raise RuntimeError('Git '+args[0]+' failed: '+p.stderr[-1500:])
    return p


def guard_repository(root):
    gitdir = Path(git(root, 'rev-parse', '--absolute-git-dir').stdout.strip())
    if any((gitdir / p).exists() for p in ('rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD')):
        raise RuntimeError('Unfinished Git operation preserved; repair it before publishing')
    if git(root, 'symbolic-ref', '--short', 'HEAD').stdout.strip() != 'main':
        raise RuntimeError('Publishing requires the main branch')
    if git(root, 'status', '--porcelain').stdout.strip():
        raise RuntimeError('Uncommitted changes preserved; publishing stopped')


def align_remote(root, receipt):
    guard_repository(root)
    git(root, 'fetch', 'origin', 'main', network=True)
    ahead = git(root, 'rev-list', '--count', 'origin/main..HEAD').stdout.strip()
    if ahead != '0':
        # Preserve every unique commit before replacing only unpushed generated output.
        commits = git(root, 'rev-list', 'origin/main..HEAD').stdout.split()
        for commit in commits:
            parents = git(root, 'rev-list', '--parents', '-n', '1', commit).stdout.split()
            paths = git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit).stdout.splitlines()
            if len(parents) != 2 or not paths or any(not x.startswith('public/data/') for x in paths):
                raise RuntimeError('Unpushed source or merge commits require review; preserved unchanged')
        ref = 'refs/heads/codex/preserve-fx-sync-' + receipt['run_id'] + '-' + str(receipt['attempt'])
        git(root, 'update-ref', ref, 'HEAD')
        receipt.setdefault('preserved_refs', []).append(ref)
        git(root, 'reset', '--keep', 'origin/main')
    else:
        git(root, 'merge', '--ff-only', 'origin/main')
    return git(root, 'rev-parse', 'HEAD').stdout.strip()


def freshness(candidate, current):
    incoming = {x['symbol']: x for x in candidate['symbols']}
    existing = {x['symbol']: x for x in current['symbols']}
    if not incoming or len(incoming) != len(candidate['symbols']) or set(incoming) != set(existing):
        raise ValueError('Symbol coverage changed or duplicated; review before publishing')
    for symbol, old in existing.items():
        if incoming[symbol]['latestActual']['date'] < old['latestActual']['date']:
            return 'remote_newer'
    if dt.datetime.fromisoformat(candidate['updatedAt']) < dt.datetime.fromisoformat(current['updatedAt']):
        return 'remote_newer'
    return 'eligible'


def source_hashes(module):
    paths = set(module.UPLOAD_DIR.glob('*.xlsx')) | set(module.TERRAIN_FEATURE_DIR.glob('*_terrain_features.csv'))
    for name, value in vars(module).items():
        if name.endswith('_PATH') and isinstance(value, Path):
            paths.add(value)
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None for p in sorted(paths)}


def convert(root, staging):
    spec = importlib.util.spec_from_file_location('fx_conversion', root / 'scripts/convert-data.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    before = source_hashes(module)
    module.DATA_DIR = staging
    module.FILES_DIR = staging / 'files'
    module.TERRAIN_DATA_DIR = staging / 'terrain'
    module.main()
    if source_hashes(module) != before:
        raise RuntimeError('Inputs changed during conversion; staged output retained but not published')
    return before


@contextlib.contextmanager
def exclusive_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as handle:
        if handle.tell() == 0:
            handle.write(b'0'); handle.flush()
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def execute(root, receipt):
    run_dir = root / '.runtime/sync-runs' / receipt['run_id']
    for attempt in range(1, 4):
        receipt['attempt'] = attempt
        base = align_remote(root, receipt)
        staging = run_dir / ('attempt-' + str(attempt)) / 'data'
        receipt['source_sha256'] = convert(root, staging)
        candidate = json.loads((staging / 'manifest.json').read_text(encoding='utf-8'))
        current = json.loads((root / 'public/data/manifest.json').read_text(encoding='utf-8'))
        receipt.update(source_updated_at=candidate['updatedAt'], remote_updated_at=current['updatedAt'],
                       symbols=len(candidate['symbols']), staged_data=str(staging), baseline_commit=base)
        if freshness(candidate, current) == 'remote_newer':
            receipt.update(status='SKIPPED_REMOTE_NEWER', remote_commit=base, published=False)
            return
        guard_repository(root)
        if git(root, 'rev-parse', 'HEAD').stdout.strip() != base:
            raise RuntimeError('Local branch changed during conversion; output preserved without publishing')
        shutil.copytree(staging, root / 'public/data', dirs_exist_ok=True)
        git(root, 'add', '--', 'public/data')
        staged = git(root, 'diff', '--cached', '--name-only').stdout.splitlines()
        if any(not x.startswith('public/data/') for x in staged):
            raise RuntimeError('Unexpected staged source changes; automatic commit refused')
        if git(root, 'diff', '--cached', '--quiet', check=False).returncode:
            git(root, 'commit', '-m', 'Update forecast data ' + dt.datetime.now().strftime('%Y-%m-%d_%H-%M-%S'))
        head = git(root, 'rev-parse', 'HEAD').stdout.strip()
        push = git(root, 'push', 'origin', 'HEAD:main', check=False, network=True)
        if push.returncode:
            # Refetch before deciding whether this was a racing writer or a network failure.
            git(root, 'fetch', 'origin', 'main', network=True)
            if git(root, 'rev-parse', 'origin/main').stdout.strip() != base:
                continue
            raise RuntimeError('Push failed; local commit preserved for the next retry')
        git(root, 'fetch', 'origin', 'main', network=True)
        if git(root, 'merge-base', '--is-ancestor', head, 'origin/main', check=False).returncode:
            raise RuntimeError('Remote did not retain the pushed commit')
        receipt.update(status='SUCCESS', remote_commit=head, published=(head != base))
        return
    raise RuntimeError('Remote changed repeatedly; local commits preserved; retry later')


def main():
    run_id = dt.datetime.now().strftime('%Y%m%d_%H%M%S') + '_' + uuid.uuid4().hex[:8]
    receipt = {'schema': 'fx-data-sync/v1', 'run_id': run_id,
               'started_at': dt.datetime.now().astimezone().isoformat(), 'status': 'RUNNING'}
    path = ROOT / '.runtime/sync-runs' / run_id / 'receipt.json'
    try:
        with exclusive_lock(ROOT / '.runtime/data-sync.lock'):
            execute(ROOT, receipt)
        code = 0
    except Exception as exc:
        receipt.update(status='FAILED', error=str(exc))
        code = 1
    receipt['ended_at'] = dt.datetime.now().astimezone().isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    # Each run retains its own evidence; the monitor can select the newest completed receipt.
    print(json.dumps({'status': receipt['status'], 'receipt': str(path)}, ensure_ascii=True))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
