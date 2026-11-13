"""Verify public source hashes, generated assets, and heuristic secret checks.

.git and node_modules are ignored in a normal clone. --export additionally rejects
those directories in a folder intended for public handoff; neither is deployable.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--export', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
findings = []
files = []
patterns = {
    'private_key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'provider_secret': r'(?:sb_secret_|ghp_|github_pat_)[A-Za-z0-9_]{15,}',
    'jwt_literal': r'eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}',
    'private_path': r'/Users/[^/\s]+/',
    'private_contact': r'[A-Za-z0-9_.+%-]+@(?:gmail|naver|daum)\.',
    'database_connection': r'postgres(?:ql)?://[^\s"\']+',
}
for folder, dirs, names in os.walk(root, followlinks=False):
    for name in list(dirs):
        p = Path(folder) / name
        rel = p.relative_to(root).as_posix()
        if p.is_symlink():
            findings.append({'file': rel, 'rule': 'symlink'})
            dirs.remove(name)
        elif name in ['.git', 'node_modules', '__pycache__']:
            if args.export and name != '__pycache__':
                findings.append({'file': rel, 'rule': 'excluded_export_directory'})
            dirs.remove(name)
        elif name in ['local-data', 'artifacts', '.aws', '.codex', '.agents']:
            findings.append({'file': rel, 'rule': 'private_directory'})
            dirs.remove(name)
    for name in names:
        p = Path(folder) / name
        rel = p.relative_to(root).as_posix()
        if p.is_symlink():
            findings.append({'file': rel, 'rule': 'symlink'})
            continue
        if rel == 'verification/audit.json':
            continue
        files.append(rel)
        if name.startswith('.env') or p.suffix in ['.sqlite', '.db', '.pem', '.key', '.xlsx', '.zip', '.map'] or name == '.git':
            findings.append({'file': rel, 'rule': 'excluded_file'})
        if rel == 'scripts/audit.py' or p.suffix not in ['.js', '.mjs', '.ts', '.tsx', '.json', '.html', '.md', '.css', '.py']:
            continue
        content = p.read_text(errors='replace')
        for rule, pattern in patterns.items():
            if re.search(pattern, content):
                findings.append({'file': rel, 'rule': rule})

sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = json.loads((root / 'verification/source-manifest.json').read_text())
adapted = {item['file']: item['sha256'] for item in manifest['adaptedFiles']}
modified = []
for item in manifest['files']:
    p = root / item['file']
    if not p.is_file() or sha(p) != adapted.get(item['file'], item['sha256']):
        findings.append({'file': item['file'], 'rule': 'source_hash_mismatch'})
    if p.is_file() and sha(p) != item['sha256']:
        modified.append(item['file'])
source_files = {p.relative_to(root).as_posix() for folder in ['web', 'shared', 'public/icons'] for p in (root / folder).rglob('*') if p.is_file()}
if source_files != {item['file'] for item in manifest['files']}:
    findings.append({'file': 'verification/source-manifest.json', 'rule': 'source_inventory_mismatch'})
if len(manifest['files']) != 208 or set(modified) != set(adapted):
    findings.append({'file': 'verification/source-manifest.json', 'rule': 'source_baseline_mismatch'})
build = json.loads((root / 'verification/build.json').read_text())
if build['output'] != 'docs' or build['routing'] != 'hash':
    findings.append({'file': 'verification/build.json', 'rule': 'deployment_configuration'})
expected_assets = {item['file'] for item in build['assets']}
actual_assets = {p.relative_to(root / 'docs').as_posix() for p in (root / 'docs').rglob('*') if p.is_file()}
if expected_assets != actual_assets:
    findings.append({'file': 'docs', 'rule': 'deployment_inventory_mismatch'})
for item in build['assets']:
    p = root / 'docs' / item['file']
    if not p.is_file() or sha(p) != item['sha256']:
        findings.append({'file': 'docs/' + item['file'], 'rule': 'deployment_hash_mismatch'})
result = {'filesChecked': len(files), 'sourceFiles': len(manifest['files']), 'deployedAssets': len(expected_assets),
          'modifiedSourceFiles': sorted(modified), 'findings': findings, 'passed': not findings,
          'scope': 'Source and deployed-asset hashes plus heuristic scan; not proof of every possible confidential value or production behavior.'}
(root / 'verification/audit.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
sys.exit(0 if result['passed'] else 1)
