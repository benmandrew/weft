"""Serve `web/` with a file watcher that reloads the browser on save.

`/` is the nested-arc harness, `/words.html` the word chain one and
`/letters.html` the letter graph.

`web/` is served at `/` and `out/` at `/out/`, so a page reaches the exported
tree at `/out/wordnet-tree.json` and a category at `/out/words-animal.json`
without either directory having to know where the other sits. A background
thread compares file modification times every `--interval` seconds and bumps a
counter when any of them move; every open `/__reload` stream notices the new
number and tells its page to reload. Server sent events rather than a
websocket, because the whole protocol is one line of text and `http.server` can
already speak it.

HTML is the one thing not served straight off disk: the reload client is
injected on the way out, so no page has to carry a script that only exists
during development. Everything else textual is gzipped on the way out, so that
what a disc waits on here is roughly what it waits on where the same files are
served brotli'd, rather than five times more.

    python tools/serve.py                  # http://127.0.0.1:8000
    python tools/serve.py --port 9000 --open
    python tools/serve.py --watch src/weft
"""

from __future__ import annotations

import argparse
import datetime
import email.utils
import functools
import gzip
import http.server
import posixpath
import sys
import threading
import time
import urllib.parse
import webbrowser
from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
OUT = ROOT / "out"

# What gets compressed on the way out. A deployed copy is served brotli'd, so a
# server that sends the exports raw is not the thing being developed against:
# wordnet-tree.json is 479 KB here and 42 KB there, and the disc shows nothing
# until it lands. Content types rather than suffixes, since `guess_type` is
# already the thing that decides, and the set is only what the pages ask for.
GZIP_TYPES = frozenset(
    {
        "application/json",
        "application/javascript",
        "text/javascript",
        "text/plain",
        "text/css",
        "image/svg+xml",
    }
)
# Below this a response is one packet either way, and gzip's own header is
# most of what would be saved.
GZIP_MIN = 1024
# Level 6 is the default and roughly where the exports stop getting smaller;
# the cost is paid once per file, since the result is held against its mtime.
GZIP_LEVEL = 6

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
    # Compressed bodies, keyed on the file and the stat it was compressed from,
    # so the 5.7 MB of glosses are gzipped once rather than once per reload. A
    # save moves the mtime and the entry is replaced, which is the whole of the
    # invalidation. Shared across threads: dict assignment is atomic, and two
    # threads compressing the same file at once agree on the answer.
    _gzipped: ClassVar[dict[str, tuple[tuple[float, int], bytes]]] = {}

    def _fresh(self, mtime: float) -> bool:
        """Whether the browser's copy is still the file on disk.

        `SimpleHTTPRequestHandler.send_head` does this itself, but it does it
        on the way to sending an uncompressed body, and there is no way in to
        the one without the other. Same comparison, to the second, and ignoring
        an ill-formed date the same way it does.
        """
        if "If-Modified-Since" not in self.headers or "If-None-Match" in self.headers:
            return False
        try:
            since = email.utils.parsedate_to_datetime(self.headers["If-Modified-Since"])
        except (TypeError, IndexError, OverflowError, ValueError):
            return False
        if since.tzinfo is None:  # the obsolete format, which means UTC
            since = since.replace(tzinfo=datetime.timezone.utc)
        last = datetime.datetime.fromtimestamp(mtime, datetime.timezone.utc)
        return last.replace(microsecond=0) <= since

    def _body(self, target: Path, stat: tuple[float, int]) -> bytes:
        held = self._gzipped.get(str(target))
        if held is not None and held[0] == stat:
            return held[1]
        blob = gzip.compress(target.read_bytes(), GZIP_LEVEL)
        self._gzipped[str(target)] = (stat, blob)
        return blob

    def _static(self, target: Path, ctype: str) -> None:
        """One file, gzipped, or a 304 saying the browser already has it."""
        try:
            st = target.stat()
        except OSError:
            self.send_error(404, "File not found")
            return
        if self._fresh(st.st_mtime):
            self.send_response(304)
            self.end_headers()
            return
        body = self._body(target, (st.st_mtime, st.st_size))
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", self.date_time_string(int(st.st_mtime)))
        self.end_headers()
        self.wfile.write(body)

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
        ctype = self.guess_type(str(target))
        if (
            "gzip" in self.headers.get("Accept-Encoding", "")
            and ctype.split(";")[0] in GZIP_TYPES
            and target.is_file()
            and target.stat().st_size >= GZIP_MIN
        ):
            self._static(target, ctype)
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
    usually mid-read when that happens. The reset surfaces in
    `handle_one_request`, outside any handler code here, so socketserver would
    print a whole traceback for the normal end of a connection, into the one
    terminal a real error has to be legible in.
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
