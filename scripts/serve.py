"""Serve the prebuilt Pages folder without SPA fallback or build dependencies."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
import argparse


def handler_for(root, base='/'):
    prefix = base.rstrip('/')

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kw):
            super().__init__(*args, directory=str(root), **kw)

        def do_GET(self):
            self.serve_request(False)

        def do_HEAD(self):
            self.serve_request(True)

        def serve_request(self, head):
            requested = urlsplit(self.path)
            if prefix and requested.path == prefix:
                self.send_response(301)
                self.send_header('Location', prefix + '/' + ('?' + requested.query if requested.query else ''))
                self.end_headers()
                return
            if prefix and not requested.path.startswith(prefix + '/'):
                self.send_error(404)
                return
            self.path = self.path[len(prefix):] if prefix else self.path
            # Standard static serving: nonexistent URLs really return 404.
            if head:
                super().do_HEAD()
            else:
                super().do_GET()

    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8899)
    parser.add_argument('--base', default='/')
    parser.add_argument('--directory', default='docs')
    args = parser.parse_args()
    root = Path(args.directory).resolve()
    if not (root / 'index.html').is_file():
        parser.error('The deployment directory must contain index.html. Run npm run build first.')
    if not args.base.startswith('/') or not args.base.endswith('/'):
        parser.error('--base must start and end with /')
    print(f'http://127.0.0.1:{args.port}{args.base}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(root, args.base)).serve_forever()
