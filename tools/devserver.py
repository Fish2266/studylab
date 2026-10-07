"""Dev-only static server: same as http.server but with caching switched off,
so edits show up on reload while testing."""
import functools, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()
    def log_message(self, fmt, *args):
        pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    handler = functools.partial(NoCache, directory=".")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
