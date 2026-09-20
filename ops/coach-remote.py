#!/usr/bin/env python3
"""Run an explicit VPS command without putting SSH credentials in arguments.

Loads existing VPS_* credentials locally. Requires sshpass and a pre-verified
entry in known_hosts. Does not disable host verification or print credentials.
The command decides whether the operation is read-only or a mutation.
"""

import argparse
import os
from pathlib import Path
import shlex
import subprocess
import sys


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        value = value.strip()
        if value.startswith(("'", '"')):
            parts = shlex.split(value, comments=True)
            value = parts[0] if parts else ""
        else:
            value = value.split(" #", 1)[0].rstrip()
        values[key.strip()] = value
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parents[1] / ".env")
    parser.add_argument("--command", required=True, help="Explicit remote shell command; never include secrets")
    parser.add_argument("--stdin-file", type=Path, help="Optional local input sent over SSH without printing")
    parser.add_argument("--output-file", type=Path, help="Save stdout privately instead of displaying it")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    try:
        values = read_env(args.env_file)
        host = values["VPS_SSH_HOST"]
        user = values.get("VPS_SSH_USER", "root")
        password = values["VPS_ROOT_PASSWORD"]
        if not host or not user or not password or host.startswith("-") or user.startswith("-"):
            raise ValueError("invalid connection settings")
        command = [
            "sshpass", "-e", "ssh", "-o", "StrictHostKeyChecking=yes",
            "-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no",
            "-o", "ConnectTimeout=15", f"{user}@{host}", args.command,
        ]
        source = args.stdin_file.read_bytes() if args.stdin_file else None
        result = subprocess.run(
            command, input=source, capture_output=True, timeout=args.timeout,
            env={**os.environ, "SSHPASS": password}, check=False,
        )
        if result.returncode:
            # Commands may print credentials in their errors; do not echo stderr.
            print(f"remote_command_failed exit={result.returncode}", file=sys.stderr)
            return result.returncode
        if args.output_file:
            old_umask = os.umask(0o077)
            try:
                with args.output_file.open("wb") as output:
                    os.fchmod(output.fileno(), 0o600)
                    output.write(result.stdout)
            finally:
                os.umask(old_umask)
            print(f"remote_output_saved bytes={len(result.stdout)}")
        else:
            sys.stdout.buffer.write(result.stdout)
        return 0
    except (OSError, KeyError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"remote_access_failed kind={type(error).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
