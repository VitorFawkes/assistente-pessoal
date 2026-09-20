"""Meaningful security/transport checks; no production or model calls."""

from contextlib import redirect_stdout
import fcntl
import importlib.util
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error


spec = importlib.util.spec_from_file_location("coach_runner", Path(__file__).with_name("coach-run.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Path(self.temp.name) / "runner.json"
        self.lock = Path(self.temp.name) / "lock"
        self.token = "test-secret-" + "a" * 32
        self.write_config()

    def write_config(self, **changes):
        value = {"url": "https://example.test/api/internal/coach/run", "token": self.token}
        value.update(changes)
        self.config.write_text(json.dumps(value))
        self.config.chmod(0o600)

    def run_main(self, **kwargs):
        output = StringIO()
        with patch("sys.argv", ["coach-run.py", "--config", str(self.config), "--lock", str(self.lock)]), redirect_stdout(output):
            result = runner.main()
        self.assertNotIn(self.token, output.getvalue())
        return result, output.getvalue()

    def test_rejects_world_readable_config(self):
        self.config.chmod(0o644)
        with self.assertRaises(ValueError):
            runner.read_config(self.config)

    def test_rejects_http_query_and_embedded_credentials(self):
        for url in ["http://example.test/api/internal/coach/run", "https://example.test/api/internal/coach/run?user_id=x", "https://secret@example.test/api/internal/coach/run"]:
            with self.subTest(url=url):
                self.write_config(url=url)
                with self.assertRaises(ValueError):
                    runner.read_config(self.config)

    def test_sends_empty_post_and_does_not_read_private_response(self):
        captured = []

        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): raise AssertionError("response body must not be read")

        class Client:
            def open(self, request, timeout):
                captured.append((request, timeout))
                return Response()

        with patch.object(runner.urllib.request, "build_opener", return_value=Client()):
            result, output = self.run_main()
        self.assertEqual(result, 0)
        request, timeout = captured[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.data, b"")
        self.assertEqual(request.get_header("Authorization"), "Bearer " + self.token)
        self.assertEqual(timeout, 600)
        self.assertIn("http=200", output)

    def test_rejects_redirect_and_does_not_forward_token(self):
        self.assertIsNone(runner.NoRedirects().redirect_request(None, None, 302, "", {}, "https://elsewhere.test/"))

    def test_lock_prevents_second_network_call(self):
        with self.lock.open("a") as lock, patch.object(runner.urllib.request, "build_opener") as client:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result, output = self.run_main()
            self.assertEqual(result, 0)
            self.assertIn("already_running", output)
            client.assert_not_called()

    def test_http_failure_logs_status_without_body_or_token(self):
        error = urllib.error.HTTPError("https://example.test/", 503, self.token, {}, None)
        with patch.object(runner.urllib.request, "build_opener") as client:
            client.return_value.open.side_effect = error
            result, output = self.run_main()
        self.assertEqual(result, 1)
        self.assertIn("http=503", output)


if __name__ == "__main__":
    unittest.main()
