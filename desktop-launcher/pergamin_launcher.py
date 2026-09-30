from __future__ import annotations

import argparse
import ctypes
import errno
import json
import mimetypes
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

PORT = 8321
APP_URL = f"http://127.0.0.1:{PORT}/"
MUTEX_NAME = "Local\\PergaminDesktopApp"
ERROR_ALREADY_EXISTS = 183
READY_PATH = "/__pergamin_ready__"
ALLOWED_TOP_LEVEL = {"index.html", "book.css", "mvp.css", "book.js", "ai.js", "studio.js", "atelier.js", "manifest.webmanifest", "sw.js"}
ALLOWED_DIRECTORIES = {"fonts", "icons"}
ALLOWED_EXTENSIONS = {".woff2", ".ttf", ".png", ".jpg", ".jpeg", ".svg", ".ico"}


def app_base() -> Path:
    return Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent


def find_app_root(start: Path | None = None) -> Path:
    current = (start or app_base()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / "index.html").is_file() and (candidate / "book.js").is_file():
            return candidate
    raise FileNotFoundError("Рядом с программой не найдены index.html и book.js")


def find_browser() -> Path | None:
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local")))
    candidates = [
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
        local / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
        local / "Microsoft/Edge/Application/msedge.exe",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    for name in ("chrome.exe", "msedge.exe"):
        found = shutil.which(name)
        if found:
            return Path(found)
    return None


def show_error(message: str) -> None:
    ctypes.windll.user32.MessageBoxW(None, message, "Пергамин", 0x10)


class PergaminHandler(BaseHTTPRequestHandler):
    server_version = "Pergamin/1.0"

    def do_GET(self) -> None:
        self._serve(head_only=False)

    def do_HEAD(self) -> None:
        self._serve(head_only=True)

    def _serve(self, head_only: bool) -> None:
        port = self.server.server_port
        if self.headers.get("Host", "").lower() not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
            self._send(421, b"Misdirected request", "text/plain; charset=utf-8", head_only)
            return

        path = unquote(urlsplit(self.path).path)
        if path == READY_PATH:
            self._send(200, self.server.ready_token.encode("ascii"), "text/plain; charset=us-ascii", head_only)
            return
        if path == "/":
            path = "/index.html"

        relative = path.lstrip("/").replace("\\", "/")
        parts = tuple(part for part in relative.split("/") if part)
        allowed = (
            len(parts) == 1 and parts[0] in ALLOWED_TOP_LEVEL
        ) or (
            len(parts) == 2
            and parts[0] in ALLOWED_DIRECTORIES
            and Path(parts[1]).suffix.lower() in ALLOWED_EXTENSIONS
        )
        if not allowed or any(part in {".", ".."} for part in parts):
            self._send(404, b"Not found", "text/plain; charset=utf-8", head_only)
            return

        root = self.server.app_root
        candidate = root.joinpath(*parts).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            self._send(404, b"Not found", "text/plain; charset=utf-8", head_only)
            return
        if not candidate.is_file():
            self._send(404, b"Not found", "text/plain; charset=utf-8", head_only)
            return

        try:
            body = candidate.read_bytes()
        except OSError:
            self._send(500, b"Read error", "text/plain; charset=utf-8", head_only)
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.suffix == ".webmanifest":
            content_type = "application/manifest+json"
        elif candidate.suffix == ".ttf":
            content_type = "font/ttf"
        elif candidate.suffix == ".woff2":
            content_type = "font/woff2"
        elif candidate.suffix in {".html", ".css", ".js"}:
            content_type += "; charset=utf-8"
        self._send(200, body, content_type, head_only)

    def _send(self, status: int, body: bytes, content_type: str, head_only: bool) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class PergaminServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def make_server(root: Path, ready_token: str, port: int = PORT) -> PergaminServer:
    server = PergaminServer(("127.0.0.1", port), PergaminHandler)
    server.app_root = root.resolve()
    server.ready_token = ready_token
    return server


def token_path(root: Path) -> Path:
    return root / "pergamin-data" / ".launcher-token"


def load_or_create_token(root: Path) -> str:
    path = token_path(root)
    path.parent.mkdir(exist_ok=True)
    try:
        token = path.read_text(encoding="ascii").strip()
        if len(token) >= 32:
            return token
    except OSError:
        pass
    token = secrets.token_urlsafe(32)
    path.write_text(token, encoding="ascii")
    return token


def verify_running_server(token: str, port: int = PORT, timeout: float = 0.5) -> bool:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{READY_PATH}",
        headers={"Host": f"127.0.0.1:{port}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status == 200 and response.read().decode("ascii") == token
    except (OSError, urllib.error.URLError, UnicodeError):
        return False


def launch_browser(root: Path) -> subprocess.Popen[bytes] | None:
    browser = find_browser()
    if browser is None:
        return None
    profile = root / "pergamin-data"
    profile.mkdir(exist_ok=True)
    try:
        (profile / "DevToolsActivePort").unlink(missing_ok=True)
    except OSError:
        pass
    return subprocess.Popen(
        [
            str(browser),
            f"--user-data-dir={profile}",
            f"--app={APP_URL}",
            "--remote-debugging-port=0",
            "--no-first-run",
            "--disable-default-apps",
        ],
        cwd=root,
    )


def devtools_port(profile: Path) -> int | None:
    try:
        first_line = (profile / "DevToolsActivePort").read_text(encoding="ascii").splitlines()[0]
        port = int(first_line)
        return port if 0 < port < 65536 else None
    except (OSError, ValueError, IndexError):
        return None


def app_target_exists(profile: Path) -> bool:
    port = devtools_port(profile)
    if port is None:
        return False
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=0.5) as response:
            targets = json.loads(response.read().decode("utf-8"))
        # OAuth temporarily navigates the dedicated app window to Pollinations (and
        # possibly its identity provider). Keep the local callback server alive as
        # long as that window exists, regardless of its current URL.
        return any(item.get("type") == "page" for item in targets)
    except (OSError, urllib.error.URLError, UnicodeError, json.JSONDecodeError):
        return False


def wait_for_app_window(profile: Path, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if app_target_exists(profile):
            break
        if process.poll() is not None:
            time.sleep(0.2)
        time.sleep(0.2)
    else:
        process.wait()
        return

    missing_checks = 0
    while missing_checks < 4:
        if app_target_exists(profile):
            missing_checks = 0
        else:
            missing_checks += 1
        time.sleep(0.5)


def acquire_mutex() -> tuple[int, bool]:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = (ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p)
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel32.CreateMutexW(None, True, MUTEX_NAME)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    return int(handle), ctypes.get_last_error() != ERROR_ALREADY_EXISTS


def run(serve_only: bool = False) -> int:
    root = find_app_root()
    token = load_or_create_token(root)
    mutex, owns_mutex = acquire_mutex()
    try:
        if not owns_mutex:
            if serve_only:
                return 1
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if verify_running_server(token):
                    return 0
                time.sleep(0.1)
            show_error("Пергамин уже запускается, но локальный компонент пока недоступен.")
            return 1

        try:
            server = make_server(root, token)
        except OSError as error:
            if error.errno in (errno.EADDRINUSE, 10048):
                show_error("Порт 8321 занят другой программой. Пергамин не будет открывать непроверенное содержимое.")
                return 1
            raise

        with server:
            worker = threading.Thread(target=server.serve_forever, name="PergaminServer", daemon=True)
            worker.start()
            if serve_only:
                threading.Event().wait()
                return 0

            process = launch_browser(root)
            if process is None:
                show_error("Не найден Google Chrome или Microsoft Edge.")
                return 1
            wait_for_app_window(root / "pergamin-data", process)
            server.shutdown()
            worker.join(timeout=2)
            return 0
    finally:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.ReleaseMutex.argtypes = (ctypes.c_void_p,)
        kernel32.ReleaseMutex.restype = ctypes.c_bool
        kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
        kernel32.CloseHandle.restype = ctypes.c_bool
        if owns_mutex:
            kernel32.ReleaseMutex(ctypes.c_void_p(mutex))
        kernel32.CloseHandle(ctypes.c_void_p(mutex))


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--serve-only", action="store_true")
    args, _ = parser.parse_known_args()
    try:
        return run(args.serve_only)
    except Exception as error:
        if args.serve_only:
            raise
        show_error("Не удалось запустить Пергамин.\n\n" + str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
