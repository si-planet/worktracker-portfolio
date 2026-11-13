"""Check the real static HTTP behavior at root and repository paths."""
import sys
sys.dont_write_bytecode = True
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import urlopen
from urllib.error import HTTPError
from serve import handler_for
import json

root = Path(__file__).resolve().parents[1] / 'docs'
checks = 0
for base in ['/', '/portfolio/', '/nested/repo.with-dots/']:
    class QuietHandler(handler_for(root, base)):
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        for suffix in ['', 'index.html', '#/c/019950d3-b800-7000-8000-000000000001/day?date=2026-10-08', 'app.js', 'app.css', 'demo/banner.css', 'icons/work-tracker-192.svg']:
            with urlopen(origin + base + suffix) as response:
                assert response.status == 200
                body = response.read()
                assert body
                if suffix in ['', 'index.html'] or suffix.startswith('#'):
                    assert b'./app.js' in body
                checks += 1
        for suffix in ['missing.js', 'api/companies', 'c/019950d3-b800-7000-8000-000000000001/day']:
            try:
                urlopen(origin + base + suffix)
                raise AssertionError('A missing static path must not return the app')
            except HTTPError as error:
                assert error.code == 404
                checks += 1
        if base != '/':
            with urlopen(origin + base.rstrip('/')) as response:
                assert response.url == origin + base
                checks += 1
            try:
                urlopen(origin + '/outside-scope')
                raise AssertionError('A path outside the mount must be refused')
            except HTTPError as error:
                assert error.code == 404
                checks += 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
print(json.dumps({'status': 'passed', 'checks': checks, 'mountPaths': 3, 'fallback': False}))
