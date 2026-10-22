"""Pin read-only GitHub inputs using the existing local gh login; no token enters HTML."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import argparse

ROOT = Path(__file__).parent
REPO = 'matter-labs/transaction-simulator'
MAX_SOURCE_BYTES = 8 * 1024 * 1024
KNOWN = {
    'transactions/2026-10-21-testnet3-1-governance-handover-testnet.json': ('PUH handover', 'I checked the original owners and roles against the runbook.'),
    'l2-transactions/2026-10-20-testnet3-token-admin-handover.json': ('L2 token administration', 'The PUH handover is complete and PUH is operational.'),
    'transactions/2026-10-21-testnet3-2-v33-ecosystem-testnet.json': ('v33 ecosystem', 'The prior handover, token administration and all fourteen L2 migration receipts have passed the runbook checks.'),
    'transactions/2026-10-21-testnet3-3-v33-chain-312-testnet.json': ('Chain 312 upgrade', 'The normal L1 ecosystem upgrade is complete. Operators confirmed the v33 rollout; batches are aligned and no earlier L2 upgrade is pending.'),
}
ABI_NAMES = ['Testnet3Governor', 'Testnet3ZkTokenV3', 'ProtocolUpgradeHandlerV31', 'IL1Messenger', 'IZkSyncHyperchain']

def gh_json(_args):
    return json.loads(subprocess.check_output(['gh', *_args], timeout=35, stderr=subprocess.PIPE))

def read_file(_path, _commit):
    data = subprocess.check_output(
        ['gh', 'api', f'repos/{REPO}/contents/{_path}?ref={_commit}',
         '-H', 'Accept: application/vnd.github.raw+json'],
        timeout=35, stderr=subprocess.PIPE)
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError(f'Source exceeds 8 MB: {_path}')
    return data

def snapshot(_number=386):
    if not isinstance(_number, int) or _number <= 0:
        raise ValueError('PR number must be a positive integer.')
    pr = gh_json(['pr', 'view', str(_number), '--repo', REPO, '--json', 'headRefOid,headRefName,title,url,updatedAt,files'])
    result = {
        'repo': REPO, 'number': _number, 'commit': pr['headRefOid'], 'branch': pr['headRefName'],
        'title': pr['title'], 'url': pr['url'], 'updatedAt': pr['updatedAt'],
        'pinnedAt': datetime.now(timezone.utc).isoformat(), 'stages': [], 'proposalSources': [],
    }
    pages = gh_json(['api', f'repos/{REPO}/pulls/{_number}/files?per_page=100', '--paginate', '--slurp'])
    changed = [item['filename'] for page in pages for item in page if item['status'] != 'removed' and item['filename'].endswith('.json') and item['filename'].startswith(('transactions/', 'l2-transactions/', 'docs/'))]
    if _number == 386 and 'docs/testnet3.json' not in changed:
        changed.append('docs/testnet3.json')
    paths = sorted(changed, key=lambda _path: (list(KNOWN).index(_path) if _path in KNOWN else len(KNOWN), _path))
    for path in paths:
        data = read_file(path, pr['headRefOid'])
        parsed = json.loads(data)
        source = {'path': path, 'raw': data.decode(), 'sha256': hashlib.sha256(data).hexdigest()}
        if path.startswith(('transactions/', 'l2-transactions/')) and isinstance(parsed, list):
            title, gate = KNOWN.get(path, (Path(path).stem, 'I checked this file’s order and prerequisites against the current reviewed runbook.'))
            result['stages'].append({**source, 'title': title, 'gate': gate})
        else:
            result['proposalSources'].append(source)
    if not result['stages']:
        raise ValueError(f'PR #{_number} contains no transaction arrays.')
    latest = gh_json(['pr', 'view', str(_number), '--repo', REPO, '--json', 'headRefOid'])
    if latest['headRefOid'] != result['commit']:
        raise ValueError('The PR changed while loading. Refresh again to read one consistent revision.')
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT, help='Directory for the pinned package and ABIs')
    parser.add_argument('--pr', type=int, default=386, help='transaction-simulator PR number')
    args = parser.parse_args()
    result = snapshot(args.pr)
    abis = ({name: json.loads(read_file(f'abi/{name}.json', result['commit'])) for name in ABI_NAMES}
            if args.pr == 386 else json.loads((ROOT / 'tx-sim-abis.json').read_text()))
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'tx-sim-package.json').write_text(json.dumps(result, indent=2) + '\n')
    (args.output / 'tx-sim-abis.json').write_text(json.dumps(abis) + '\n')

    print(f'Pinned {REPO}#{args.pr} at {result["commit"]}; {sum(len(json.loads(item["raw"])) for item in result["stages"])} source calls.')

if __name__ == '__main__':
    main()
