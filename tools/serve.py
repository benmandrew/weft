"""Serve `web/` with a file watcher that reloads the browser on save.

The point is the edit loop: change `hypernym-disc.js`, save, and the page in
front of you is already showing the new code with its timings measured again
from a cold build. `/` is the nested-arc harness and `/words.html` the word
chain one.

`web/` is served at `/` and `out/` at `/out/`, so a page reaches the exported
tree at `/out/wordnet-tree.json` and a category at `/out/words-animal.json`
without either directory having to know where the other sits. A background
thread compares file modification times every
`--interval` seconds and bumps a counter when any of them move; every open
`/__reload` stream notices the new number and tells its page to reload. Server
sent events rather than a websocket, because the whole protocol is one line of
text and `http.server` can already speak it.

HTML is the one thing not served straight off disk: the reload client is
injected on the way out, so no page has to carry a script that only exists
during development.

    python tools/serve.py                  # http://127.0.0.1:8000
    python tools/serve.py --port 9000 --open
    python tools/serve.py --watch src/wordchain
"""

from __future__ import annotations

import argparse
import functools
import http.server
import posixpath
import sys
import threading
import time
import urllib.parse
import webbrowser
from collections.abc import Iterator
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
OUT = ROOT / "out"

# Injected into every HTML response. The indicator is optional: a page without
# an element called `live` still reloads, it just says nothing about it.
CLIENT = """
<script>
(() => {
  const dot = document.getElementById("live");
  const say = (text, on) => {
    if (!dot) return;
    dot.textContent = text;
    dot.classList.toggle("on", on);
  };
  const source = new EventSource("/__reload");
  source.onopen = () => say("watching — save to reload", true);
  source.onmessage = e => { if (e.data === "reload") location.reload(); };
  source.onerror = () => say("watcher offline", false);
})();
</script>
"""


class Watcher:
    """Modification times, polled.

    Polling rather than an OS watch API: the tree is a few dozen files, a scan
    costs under a millisecond, and it needs no dependency outside the standard
    library, which is the whole reason this is a script and not a package.
    """

    def __init__(self, roots: list[Path], interval: float) -> None:
        self.roots = roots
        self.interval = interval
        self.version = 0

    def _scan(self) -> dict[Path, float]:
        seen: dict[Path, float] = {}
        for root in self.roots:
            if root.is_file():
                seen[root] = root.stat().st_mtime
                continue
            for path in root.rglob("*"):
                if path.is_file() and not path.name.startswith("."):
                    seen[path] = path.stat().st_mtime
        return seen

    def run(self) -> None:
        previous = self._scan()
        while True:
            time.sleep(self.interval)
            try:
                current = self._scan()
            except OSError:
                continue  # a file moved mid-scan; the next pass will see it
            if current == previous:
                continue
            touched = sorted(
                str(path.relative_to(ROOT))
                for path in set(current) | set(previous)
                if current.get(path) != previous.get(path)
            )
            previous = current
            self.version += 1
            print(f"  changed: {', '.join(touched[:4])}", flush=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    watcher: Watcher

    def translate_path(self, path: str) -> str:
        clean = posixpath.normpath(urllib.parse.unquote(urllib.parse.urlparse(path).path))
        parts = [part for part in clean.split("/") if part and part not in (".", "..")]
        if parts and parts[0] == "out":
            return str(OUT.joinpath(*parts[1:]))
        target = WEB.joinpath(*parts)
        # `make web-dist` stages the modules and the exported data flat in one
        # directory, so a page written for that layout asks for
        # `wordnet-tree.json` beside its script rather than `/out/…`. Falling
        # back to out/ is what lets embed.html be served here as it ships.
        if parts and not target.exists():
            flat = OUT.joinpath(*parts)
            if flat.is_file():
                return str(flat)
        return str(target)

    def do_GET(self) -> None:
        if urllib.parse.urlparse(self.path).path == "/__reload":
            self._stream()
            return
        target = Path(self.translate_path(self.path))
        if target.is_dir():
            target = target / "index.html"
        if target.suffix == ".html" and target.is_file():
            self._html(target)
            return
        super().do_GET()

    inject = True

    def _html(self, target: Path) -> None:
        body = target.read_bytes()
        if self.inject:
            marker = b"</body>"
            client = CLIENT.encode()
            body = body.replace(marker, client + marker) if marker in body else body + client
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # The page under edit must never come from a cache; the tree it fetches
        # is large and unchanging, so that one keeps its usual revalidation.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _stream(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        seen = self.watcher.version
        beat = 0
        try:
            while True:
                if self.watcher.version != seen:
                    seen = self.watcher.version
                    self.wfile.write(b"data: reload\n\n")
                    self.wfile.flush()
                elif beat % 120 == 0:  # a comment every 30 s, so proxies hold on
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                beat += 1
                time.sleep(0.25)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the tab went away

    def log_message(self, format: str, *args: Any) -> None:
        line = format % args
        if "/__reload" in line:
            return
        print(f"  {line}", flush=True)


class Server(http.server.ThreadingHTTPServer):
    """Quiet about a browser hanging up, loud about everything else.

    A reload closes every socket the old page held, and a keep-alive one is
    usually mid-read when that happens: the reset surfaces in
    `handle_one_request`, outside any handler code this file owns, so
    socketserver prints the whole traceback for something that is the normal
    end of a connection. Saving a file therefore wrote a stack trace to the
    terminal the watcher is reporting into, which is the one place a real error
    has to be legible. `_stream` already swallows the same two exceptions for
    the reload channel, and this is that rule applied where the read happens
    between requests rather than inside one.
    """

    def handle_error(self, request: Any, client_address: Any) -> None:
        if isinstance(sys.exception(), (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


# What a harness needs to draw anything, and so what the watcher follows and
# the run refuses to start without. The glosses are left out of both: the disc
# is unaffected by their absence, and a page says so itself.
NEEDED = ("wordnet-tree.json", "wordnet-names.txt", "words-index.json")


def _watch_roots(extra: list[Path]) -> Iterator[Path]:
    yield WEB
    for path in [*(OUT / name for name in NEEDED), *sorted(OUT.glob("words-*.json"))]:
        if path.exists():
            yield path
    yield from extra


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").partition("\n")[0])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--interval", type=float, default=0.25, help="seconds between scans")
    parser.add_argument("--watch", type=Path, action="append", default=[], help="also watch this")
    parser.add_argument("--open", action="store_true", help="open a browser at the page")
    parser.add_argument(
        "--no-reload",
        action="store_true",
        help="serve the page without the reload client, which keeps a connection open",
    )
    args = parser.parse_args()

    missing = [name for name in NEEDED if not (OUT / name).exists()]
    if missing:
        print(f"out/{', out/'.join(missing)} missing. Run: make tree words")
        return 1

    watcher = Watcher(list(_watch_roots(args.watch)), args.interval)
    threading.Thread(target=watcher.run, daemon=True).start()

    handler = functools.partial(Handler)
    Handler.watcher = watcher
    Handler.inject = not args.no_reload
    url = f"http://{args.host}:{args.port}/"
    with Server((args.host, args.port), handler) as server:
        print(f"serving {WEB.relative_to(ROOT)}/ at {url}")
        print(f"watching {', '.join(str(p.relative_to(ROOT)) for p in watcher.roots)}")
        print("ctrl-c to stop")
        if args.open:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
