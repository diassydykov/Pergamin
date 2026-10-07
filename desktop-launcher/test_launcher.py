import http.client
import io
import json
import socket
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

import pergamin_launcher as launcher


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.root = launcher.find_app_root(Path(__file__).resolve().parent)
        self.token = "test-ready-token"
        self.server = launcher.make_server(self.root, self.token, port=0)
        self.port = self.server.server_port
        self.base_url = f"http://127.0.0.1:{self.port}/"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_finds_project_root_and_browser(self):
        self.assertTrue((self.root / "index.html").is_file())
        self.assertTrue((self.root / "book.js").is_file())
        self.assertIsNotNone(launcher.find_browser())

    def test_server_serves_only_application_assets(self):
        with urllib.request.urlopen(self.base_url, timeout=5) as response:
            html = response.read().decode("utf-8")
            self.assertEqual(response.status, 200)
            self.assertIn("Пергамин", html)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

        with urllib.request.urlopen(self.base_url + "fonts/Lora-Regular.ttf", timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "font/ttf")
            self.assertGreater(len(response.read()), 1000)

        with urllib.request.urlopen(self.base_url + "atelier.js", timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertIn(b"__pgAtelier__", response.read())

        for asset in ("library.js", "library-import.js", "library.css", "catalog/starter.json"):
            with urllib.request.urlopen(self.base_url + asset, timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertGreater(len(response.read()), 100)

        for blocked in ("pergamin-data/", "README.md", ".git/config", "desktop-launcher/pergamin_launcher.py", "catalog/private.json", ".catalog-cache/"):
            with self.assertRaises(urllib.error.HTTPError) as missing:
                urllib.request.urlopen(self.base_url + blocked, timeout=5)
            self.assertEqual(missing.exception.code, 404)
            missing.exception.close()

    def test_server_rejects_untrusted_host_and_has_authenticated_readiness(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("GET", "/", headers={"Host": "evil.example"})
        response = connection.getresponse()
        self.assertEqual(response.status, 421)
        response.read()
        connection.close()

        ready_url = self.base_url + "__pergamin_ready__"
        with urllib.request.urlopen(ready_url, timeout=5) as response:
            self.assertEqual(response.read().decode("ascii"), self.token)
        self.assertTrue(launcher.verify_running_server(self.token, port=self.port))
        self.assertFalse(launcher.verify_running_server("wrong-token", port=self.port))

    def test_occupied_port_is_not_trusted(self):
        occupied = socket.socket()
        occupied.bind(("127.0.0.1", 0))
        occupied.listen(1)
        port = occupied.getsockname()[1]
        try:
            with self.assertRaises(OSError):
                launcher.make_server(self.root, self.token, port=port)
            self.assertFalse(launcher.verify_running_server(self.token, port=port, timeout=0.1))
        finally:
            occupied.close()

    def test_oauth_navigation_keeps_callback_server_alive(self):
        targets = [{"type": "page", "url": "https://enter.pollinations.ai/authorize"}]
        response = io.BytesIO(json.dumps(targets).encode("utf-8"))
        with mock.patch.object(launcher, "devtools_port", return_value=9333), mock.patch.object(
            launcher.urllib.request, "urlopen", return_value=response
        ):
            self.assertTrue(launcher.app_target_exists(self.root / "pergamin-data"))


if __name__ == "__main__":
    unittest.main()
