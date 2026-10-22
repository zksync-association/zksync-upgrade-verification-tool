"""Loopback-only static server with read-only transaction-simulator PR imports."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import importlib.util
import json
import re
import threading

ROOT = Path(__file__).parent
HOST = '127.0.0.1'
PORT = 8765
ALLOWED_HOSTS = {f'127.0.0.1:{PORT}', f'localhost:{PORT}'}
FILES = {'index.html', 'tx-sim.html', 'tx-sim-testnet-3.html', 'tx-sim.css', 'tx-sim-ui.mjs', 'tx-sim-core.mjs', 'tx-sim-config.mjs', 'tx-sim-contracts.mjs', 'tx-sim-source.mjs', 'tx-sim-abis.json', 'tx-sim-package.json', 'ethers.umd.min.js'}
spec = importlib.util.spec_from_file_location('prepare', ROOT / 'prepare-tx-sim.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
lock = threading.Lock()

def current_snapshot(_number):
    latest = prepare.snapshot(_number)
    plan_path = ROOT / 'execution-plans' / f'{_number}.json'
    if plan_path.exists():
        plan = json.loads(plan_path.read_text())
        if plan.get('repo') != prepare.REPO or plan.get('number') != _number or plan.get('commit') != latest['commit']:
            raise ValueError('The reviewed execution plan targets another PR revision; review the new revision first.')
        latest = plan
    return latest

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def do_GET(self):
        if self.headers.get('Host') not in ALLOWED_HOSTS:
            self.send_error(403, 'Loopback host required')
            return
        path = urlparse(self.path).path
        pr_match = re.fullmatch(r'/api/pr/([1-9][0-9]{0,8})', path)
        if path == '/api/pr386' or pr_match:
            number = int(pr_match.group(1)) if pr_match else 386
            if self.headers.get('X-TxSim-Request') != '1' or self.headers.get('Sec-Fetch-Site') not in {None, 'same-origin', 'none'}:
                self.send_error(403, 'Same-origin request required')
                return
            origin = self.headers.get('Origin')
            if origin and origin not in {f'http://{host}' for host in ALLOWED_HOSTS}:
                self.send_error(403, 'Origin mismatch')
                return
            if not lock.acquire(blocking=False):
                self.send_error(429, 'A GitHub refresh is already running')
                return
            try:
                latest = current_snapshot(number)
                data = json.dumps(latest).encode()
                # Keep the pinned local copy current across browser reloads.
                temporary = ROOT / 'tx-sim-package.json.tmp'
                temporary.write_bytes(data)
                temporary.replace(ROOT / 'tx-sim-package.json')
                self.send_response(200)
            except Exception:
                data = json.dumps({'error': f'Could not read PR #{number} or its matching execution plan. Check gh auth and the reviewed plan revision.'}).encode()
                self.send_response(502)
            finally:
                lock.release()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path == '/':
            self.path = '/index.html'
        elif path.lstrip('/') not in FILES:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if self.headers.get('Host') not in ALLOWED_HOSTS or urlparse(self.path).path.lstrip('/') not in FILES | {''}:
            self.send_error(404)
            return
        super().do_HEAD()

if __name__ == '__main__':
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
