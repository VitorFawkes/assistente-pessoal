"""Backfill stops safely instead of making unbounded paid requests."""

from contextlib import redirect_stdout
import importlib.util
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("coach_backfill", Path(__file__).with_name("coach-backfill.py"))
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)


class BackfillTests(unittest.TestCase):
    def run_with_response(self, payload):
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            config, lock = Path(directory) / "config.json", Path(directory) / "lock"
            token = "test-secret-" + "a" * 32
            config.write_text(json.dumps({"url": "https://example.test/api/internal/coach/run", "token": token}))
            config.chmod(0o600)

            class Response:
                status = 200
                def __enter__(self): return self
                def __exit__(self, *_): return False
                def read(self, limit): return json.dumps(payload).encode()

            class Client:
                def open(self, request, timeout):
                    calls.append(request)
                    return Response()

            output = StringIO()
            argv = ["coach-backfill.py", "--config", str(config), "--lock", str(lock), "--max-ticks", "2", "--pause-seconds", "1"]
            with patch("sys.argv", argv), patch("urllib.request.build_opener", return_value=Client()), patch("time.sleep"), redirect_stdout(output):
                result = backfill.main()
            self.assertNotIn(token, output.getvalue())
            for request in calls:
                self.assertEqual(request.data, b"")
            return result, calls, output.getvalue()

    def test_stops_when_endpoint_cannot_prove_remaining_work(self):
        result, calls, output = self.run_with_response({"ok": True, "processed": 1})
        self.assertEqual(result, 1)
        self.assertEqual(len(calls), 1)
        self.assertIn("backfill_invalid_progress", output)

    def test_stops_at_zero_without_extra_model_request(self):
        result, calls, output = self.run_with_response({"ok": True, "remaining_meetings": 0})
        self.assertEqual(result, 0)
        self.assertEqual(len(calls), 1)
        self.assertIn("backfill_complete", output)

    def test_stops_at_tick_limit_when_no_progress(self):
        result, calls, output = self.run_with_response({"ok": True, "remaining_meetings": 100})
        self.assertEqual(result, 2)
        self.assertEqual(len(calls), 2)
        self.assertIn("backfill_tick_limit", output)


if __name__ == "__main__":
    unittest.main()
