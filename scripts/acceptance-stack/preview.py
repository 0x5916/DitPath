#!/usr/bin/env python3
"""Serve a local static build with the approved SSH-forwarded disposable API."""
import argparse
import http.client
import http.server
from pathlib import Path
import time
from urllib.parse import urlsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--build', type=Path, required=True)
parser.add_argument('--stall-file', type=Path, help='If present, delay API requests for 30s')
args = parser.parse_args()
build = args.build.resolve()
assert (build / 'en.html').is_file(), 'Build the static frontend first with PUBLIC_API_BASE=/v1'


class Preview(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *handler_args, **kwargs):
        super().__init__(*handler_args, directory=str(build), **kwargs)

    def log_message(self, *_args):
        pass  # Do not log account request URLs or bodies.

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def handle_request(self):
        if not self.path.startswith('/v1/'):
            if self.command not in ('GET', 'HEAD'):
                self.send_error(405)
                return
            path = Path(self.translate_path(urlsplit(self.path).path))
            if path.with_suffix('.html').is_file():
                self.path = urlsplit(self.path).path + '.html'
            return super().do_HEAD() if self.command == 'HEAD' else super().do_GET()
        connection = http.client.HTTPConnection('127.0.0.1', 8081, timeout=20)
        try:
            if args.stall_file and args.stall_file.exists():
                time.sleep(30)
                self.send_error(504)
                return
            body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'connection')}
            connection.request(self.command, self.path, body, headers)
            response = connection.getresponse()
            data = response.read()
            self.send_response(response.status)
            for key in ('Content-Type', 'Retry-After'):
                if response.getheader(key):
                    self.send_header(key, response.getheader(key))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (OSError, http.client.HTTPException):
            self.close_connection = True
        finally:
            connection.close()

    do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = handle_request


print('Acceptance preview: http://127.0.0.1:3001/en (loopback only)', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', 3001), Preview).serve_forever()
