#!/usr/bin/env python3
"""Explicit bounded, sequential coach backfill; no user ID or transcript input.

Requires aggregate remaining_meetings in the authenticated endpoint response.
Uses the cron runner's lock, so cron cannot overlap this process. Nothing is
scheduled by this script. It incurs model requests only when explicitly run.
"""

import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import ssl
import time
import urllib.error
import urllib.request


def main() -> int:
    spec = importlib.util.spec_from_file_location("coach_run", Path(__file__).with_name("coach-run.py"))
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("/etc/acoes-coach/runner.json"))
    parser.add_argument("--lock", type=Path, default=Path("/run/lock/acoes-coach.lock"))
    parser.add_argument("--max-ticks", type=int, default=250)
    parser.add_argument("--max-seconds", type=int, default=14400)
    parser.add_argument("--pause-seconds", type=int, default=5)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if not 1 <= args.max_ticks <= 1000 or not 1 <= args.pause_seconds <= 60 or not 60 <= args.max_seconds <= 43200:
            raise ValueError("invalid backfill limits")
        url, token, timeout = runner.read_config(args.config)
        with args.lock.open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                runner.log("already_running")
                return 1
            client = urllib.request.build_opener(
                urllib.request.ProxyHandler({}), runner.NoRedirects(),
                urllib.request.HTTPSHandler(context=ssl.create_default_context()),
            )
            deadline = time.monotonic() + args.max_seconds
            for tick in range(1, args.max_ticks + 1):
                if time.monotonic() >= deadline:
                    runner.log("backfill_time_limit", ticks=tick - 1)
                    return 2
                request = urllib.request.Request(
                    url, method="POST", data=b"",
                    headers={"Authorization": f"Bearer {token}", "User-Agent": "acoes-coach-backfill/1"},
                )
                try:
                    with client.open(request, timeout=min(timeout, max(1, int(deadline - time.monotonic())))) as response:
                        if response.status != 200:
                            runner.log("http_error", http=response.status)
                            return 1
                        result = json.loads(response.read(65537))
                except urllib.error.HTTPError as error:
                    runner.log("http_error", http=error.code)
                    error.close()
                    return 1
                if not isinstance(result, dict):
                    raise ValueError("invalid aggregate response")
                remaining = result.get("remaining_meetings")
                if type(remaining) is not int or remaining < 0 or result.get("ok") is not True:
                    runner.log("backfill_invalid_progress")
                    return 1
                runner.log("backfill_progress", tick=tick, remaining_meetings=remaining)
                if remaining == 0:
                    runner.log("backfill_complete", ticks=tick)
                    return 0
                if tick < args.max_ticks:
                    time.sleep(min(args.pause_seconds, max(0, deadline - time.monotonic())))
            runner.log("backfill_tick_limit", ticks=args.max_ticks)
            return 2
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as error:
        runner.log("failed", kind=type(error).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
