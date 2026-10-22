"""Exercise PR refresh against added/removed files without relying on a future PR edit."""
from pathlib import Path
import importlib.util
import json
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-tx-sim.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

class SnapshotTests(unittest.TestCase):
    def test_added_arbitrary_l2_and_removed_board_file(self):
        head = 'a' * 40
        new_path = 'l2-transactions/2026-10-21-testnet3-core-handover.json'
        old_path = 'transactions/old-board-route.json'
        calls = [{'network': 'zksync-testnet3', 'from': '0x' + '1' * 40, 'to': '0x' + '2' * 40, 'data': '0xdeadbeef', 'value': '0'}]
        metadata = {'headRefOid': head, 'headRefName': 'branch', 'title': 'title', 'url': 'https://github.com/matter-labs/transaction-simulator/pull/386', 'updatedAt': '2026-10-21'}
        def gh(_args):
            if _args[0] == 'pr':
                return metadata
            return [[{'filename': old_path, 'status': 'removed'}, {'filename': new_path, 'status': 'added'}]]
        requested = []
        def source(_path, _head):
            requested.append(_path)
            self.assertEqual(_head, head)
            return json.dumps(calls if _path == new_path else {}).encode()
        with patch.object(prepare, 'gh_json', side_effect=gh), patch.object(prepare, 'read_file', side_effect=source):
            result = prepare.snapshot()
        self.assertNotIn(old_path, requested)
        self.assertEqual(result['stages'][0]['path'], new_path)
        self.assertEqual(json.loads(result['stages'][0]['raw']), calls)

    def test_other_pr_does_not_import_testnet3_metadata(self):
        metadata = {'headRefOid': 'a' * 40, 'headRefName': 'era', 'title': 'Era stage', 'url': 'url', 'updatedAt': 'date'}
        requested = []
        def gh(_args):
            requested.append(_args)
            return [[{'filename': 'transactions/era-stage.json', 'status': 'added'}]] if _args[0] == 'api' else metadata
        with patch.object(prepare, 'gh_json', side_effect=gh), patch.object(prepare, 'read_file', return_value=b'[]') as read:
            result = prepare.snapshot(387)
        self.assertEqual(result['number'], 387)
        self.assertEqual(read.call_args_list[0].args, ('transactions/era-stage.json', 'a' * 40))
        self.assertEqual(read.call_count, 1)
        self.assertTrue(all(args[2] == '387' for args in requested if args[0] == 'pr'))
        self.assertTrue(any('pulls/387/files' in args[1] for args in requested if args[0] == 'api'))

    def test_large_github_file_uses_raw_response_and_preserves_bytes(self):
        raw = b'[' + b' ' * (1024 * 1024 + 1) + b']\n'
        with patch.object(prepare.subprocess, 'check_output', return_value=raw) as read:
            self.assertEqual(prepare.read_file('transactions/large.json', 'a' * 40), raw)
        self.assertIn('Accept: application/vnd.github.raw+json', read.call_args.args[0])
        with patch.object(prepare.subprocess, 'check_output', return_value=b'x' * (prepare.MAX_SOURCE_BYTES + 1)):
            with self.assertRaisesRegex(ValueError, 'exceeds 8 MB'):
                prepare.read_file('transactions/large.json', 'a' * 40)

    def test_moving_head_is_rejected_instead_of_mixing_revisions(self):
        metadata = {'headRefOid': 'a' * 40, 'headRefName': 'branch', 'title': 'title', 'url': 'url', 'updatedAt': 'date'}
        responses = [metadata, [[{'filename': 'transactions/new.json', 'status': 'added'}]], {'headRefOid': 'b' * 40}]
        def source(_path, _head):
            return b'[]' if _path.startswith('transactions/') else b'{}'
        with patch.object(prepare, 'gh_json', side_effect=responses), patch.object(prepare, 'read_file', side_effect=source):
            with self.assertRaisesRegex(ValueError, 'changed while loading'):
                prepare.snapshot()

if __name__ == '__main__':
    unittest.main()
