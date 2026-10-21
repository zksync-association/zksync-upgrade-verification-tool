"""Loopback-only static server with one fixed, read-only PR refresh endpoint."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import importlib.util
import json
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
        if path == '/api/pr386':
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
                latest = prepare.snapshot()
                data = json.dumps(latest).encode()
                # Keep the pinned local copy current across browser reloads.
                temporary = ROOT / 'tx-sim-package.json.tmp'
                temporary.write_bytes(data)
                temporary.replace(ROOT / 'tx-sim-package.json')
                self.send_response(200)
            except Exception:
                data = json.dumps({'error': 'Could not read PR #386 through the local gh login. Check gh auth and retry.'}).encode()
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
