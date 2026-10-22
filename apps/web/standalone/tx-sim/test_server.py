"""Exercise the loopback import boundary; GitHub is isolated to avoid network/credentials."""
import importlib.util
from pathlib import Path
import http.client
import json
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sender_server', Path(__file__).with_name('server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class ImportServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.port = self.http.server_address[1]
        self.root_patch = patch.object(server, 'ROOT', self.root)
        self.host_patch = patch.object(server, 'ALLOWED_HOSTS', {f'127.0.0.1:{self.port}'})
        self.snapshot = {'repo': server.prepare.REPO, 'number': 387, 'commit': 'a' * 40, 'stages': []}
        self.gh_patch = patch.object(server.prepare, 'snapshot', return_value=self.snapshot)
        for p in [self.root_patch, self.host_patch, self.gh_patch]: p.start()
        self.worker = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.worker.join()
        for p in [self.gh_patch, self.host_patch, self.root_patch]: p.stop()
        self.tmp.cleanup()

    def get(self, path='/api/pr/387', headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        conn.request('GET', path, headers=headers if headers is not None else {'X-TxSim-Request': '1'})
        response = conn.getresponse()
        result = response.status, response.read()
        conn.close()
        return result

    def test_import_pins_requested_pr_and_persists_reload_data(self):
        status, body = self.get()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), self.snapshot)
        server.prepare.snapshot.assert_called_once_with(387)
        self.assertEqual(json.loads((self.root/'tx-sim-package.json').read_text()), self.snapshot)

    def test_cross_origin_and_missing_header_cannot_use_github_login(self):
        for headers in [{}, {'X-TxSim-Request': '1', 'Origin': 'https://attacker.example'}, {'X-TxSim-Request': '1', 'Sec-Fetch-Site': 'cross-site'}]:
            self.assertEqual(self.get(headers=headers)[0], 403)
        server.prepare.snapshot.assert_not_called()

    def test_invalid_pr_paths_do_not_reach_github(self):
        for path in ['/api/pr/0', '/api/pr/-1', '/api/pr/abc', '/api/pr/387/extra']:
            self.assertEqual(self.get(path)[0], 404)
        server.prepare.snapshot.assert_not_called()

    def test_matching_reviewed_plan_is_loaded_without_rebuilding(self):
        (self.root/'execution-plans').mkdir()
        plan = {**self.snapshot, 'label': 'Reviewed ERA execution', 'executionPlan': {'calls': 14}}
        (self.root/'execution-plans/387.json').write_text(json.dumps(plan))
        status, body = self.get()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), plan)

    def test_stale_plan_fails_and_keeps_current_selection(self):
        (self.root/'execution-plans').mkdir()
        (self.root/'execution-plans/387.json').write_text(json.dumps({**self.snapshot, 'commit': 'b'*40}))
        (self.root/'tx-sim-package.json').write_text('previous selection')
        self.assertEqual(self.get()[0], 502)
        self.assertEqual((self.root/'tx-sim-package.json').read_text(), 'previous selection')
