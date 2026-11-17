"""Local server for Driftbound.

Same as `python3 -m http.server`, but it serves this folder no matter where it is started from
and tells the browser not to cache anything, so a normal reload always runs the latest code
(without it, browsers can mix cached old scripts with new ones and the game never starts).

usage: python3 serve.py [port]
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f'Driftbound is running at http://127.0.0.1:{port}  (close this window to stop it)')
http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
