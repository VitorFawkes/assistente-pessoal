#!/usr/bin/env python3
"""Private cron caller for the Ações coach; Python standard library only.

POSTs an empty request using a dedicated bearer token. Does not send a user ID,
read the response body, follow redirects, retry, or log personal content.
"""

import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import ssl
import stat
import urllib.error
import urllib.parse
import urllib.request


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def log(status: str, **details: int | str) -> None:
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    suffix = " ".join(f"{key}={value}" for key, value in details.items())
    print(f"{timestamp} coach status={status}{(' ' + suffix) if suffix else ''}", flush=True)


def read_config(path: Path) -> tuple[str, str, int]:
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid() or metadata.st_mode & 0o077:
        raise ValueError("config must be a private file owned by the runner")
    config = json.loads(path.read_text())
    url, token = config["url"], config["token"]
    timeout = config.get("timeout_seconds", 600)
    if not isinstance(url, str) or not isinstance(token, str) or type(timeout) is not int:
        raise ValueError("invalid configuration types")
    target = urllib.parse.urlsplit(url)
    if (target.scheme != "https" or not target.hostname or target.username or target.password
            or target.path != "/api/internal/coach/run" or target.query or target.fragment):
        raise ValueError("expected an HTTPS coach endpoint without query or credentials")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
        raise ValueError("expected a dedicated random token")
    if not 10 <= timeout <= 720:
        raise ValueError("timeout must be between 10 and 720 seconds")
    return url, token, timeout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("/etc/acoes-coach/runner.json"))
    parser.add_argument("--lock", type=Path, default=Path("/run/lock/acoes-coach.lock"))
    parser.add_argument("--check", action="store_true", help="Validate local configuration without network access")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        url, token, timeout = read_config(args.config)
        if args.check:
            log("config_valid")
            return 0
        with args.lock.open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                log("already_running")
                return 0
            # Disable environment proxies so the credential only goes to this host.
            client = urllib.request.build_opener(
                urllib.request.ProxyHandler({}), NoRedirects(),
                urllib.request.HTTPSHandler(context=ssl.create_default_context()),
            )
            request = urllib.request.Request(
                url, method="POST", data=b"",
                headers={"Authorization": f"Bearer {token}", "User-Agent": "acoes-coach-cron/1"},
            )
            try:
                with client.open(request, timeout=timeout) as response:
                    status = response.status
                log("complete" if 200 <= status < 300 else "http_error", http=status)
                return 0 if 200 <= status < 300 else 1
            except urllib.error.HTTPError as error:
                log("http_error", http=error.code)
                error.close()
                return 1
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as error:
        # Error messages may contain endpoints or response text. Log the class only.
        log("failed", kind=type(error).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
