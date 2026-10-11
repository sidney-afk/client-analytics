"""Local static server that answers like GitHub Pages: a path with no file gets
the repo's 404.html (status 404), the way the live host does.

Why: the page shows clean addresses (/sample-reviews/<slug>, /calendar/<slug>;
src/index/003-sv-route.html.part). On the live host a reload of such an address
gets 404.html, which forwards into the app. Python's plain `http.server` answers
it with its own bare error page instead, so every reload in a robot landed on a
dead page (Samples nightly create_survives_reload and create_drag_reorder_persist,
2026-10-09: no Samples sheet after the reload). Same files, same port argument.

Usage: python3 qa/pages_static_server.py [port]   (serves the current directory)
"""
import http.server
import os
import sys


class PagesHandler(http.server.SimpleHTTPRequestHandler):
    def send_error(self, code, message=None, explain=None):
        page = os.path.join(os.getcwd(), '404.html')
        if code == 404 and self.command in ('GET', 'HEAD') and os.path.isfile(page):
            with open(page, 'rb') as f:
                body = f.read()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command == 'GET':
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.ThreadingHTTPServer(('', port), PagesHandler).serve_forever()
