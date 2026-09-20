#!/usr/bin/env python3
"""Prepare/apply coach service configuration while preserving unrelated env.

Defaults to read-only inspection. --apply explicitly changes Easypanel's stored
configuration but does not deploy. Snapshots contain secrets: keep them in /tmp
or another private location and never commit them.
"""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parents[1] / ".env")
    parser.add_argument("--project", default="n8n")
    parser.add_argument("--service", default="assistente-frontend")
    parser.add_argument("--token-file", type=Path, help="Private file containing only the dedicated cron token")
    parser.add_argument("--image", help="Immutable ghcr image reference to configure")
    parser.add_argument("--snapshot-file", type=Path, help="Private backup required before --apply")
    parser.add_argument("--apply", action="store_true", help="Explicitly update stored env/image; does not deploy")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        spec = importlib.util.spec_from_file_location("coach_remote", Path(__file__).with_name("coach-remote.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        credentials = module.read_env(args.env_file)
        base = credentials["EASYPANEL_URL"].rstrip("/")
        headers = {"Authorization": "Bearer " + credentials["EASYPANEL_TOKEN"], "Content-Type": "application/json"}

        def request(endpoint: str, payload: dict, mutation: bool = False) -> dict:
            encoded = json.dumps({"json": payload}).encode()
            url = base + "/api/trpc/" + endpoint
            if not mutation:
                url += "?input=" + urllib.parse.quote(encoded.decode())
            req = urllib.request.Request(url, headers=headers, data=encoded if mutation else None)
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response).get("json", {})

        identity = {"projectName": args.project, "serviceName": args.service}
        current = request("services.app.inspectService", identity)
        if current.get("type") != "app" or not isinstance(current.get("env"), str):
            raise ValueError("unexpected service response")
        env = current["env"]
        source = current.get("source", {})
        if source.get("type") != "image":
            raise ValueError("expected an existing image service")
        updates = []
        if args.token_file:
            metadata = args.token_file.stat()
            if metadata.st_mode & 0o077 or metadata.st_uid != os.geteuid():
                raise ValueError("token file must be private and owned by current user")
            token = args.token_file.read_text().strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
                raise ValueError("invalid dedicated token")
            # Keep every unrelated line, including comments and multiline values.
            assignment = re.compile(r"^\s*(?:export\s+)?COACH_CRON_TOKEN\s*=")
            lines = env.splitlines()
            indices = [index for index, line in enumerate(lines) if assignment.match(line)]
            if len(indices) > 1:
                raise ValueError("duplicate token assignments require review")
            replacement = "COACH_CRON_TOKEN=" + token
            if indices:
                lines[indices[0]] = replacement
            else:
                lines.append(replacement)
            env = "\n".join(lines) + "\n"
            if env != current["env"]:
                updates.append("COACH_CRON_TOKEN")
        image = args.image or source.get("image")
        if args.image and not re.fullmatch(r"ghcr\.io/vitorfawkes/assistente-pessoal-frontend:(?:[0-9a-f]{40}|[0-9a-f]{64})", image):
            raise ValueError("expected an immutable frontend image tag")
        if image != source.get("image"):
            updates.append("source.image")
        if args.apply:
            if not args.snapshot_file:
                raise ValueError("snapshot-file is required when applying")
            with args.snapshot_file.open("x") as backup:
                os.fchmod(backup.fileno(), 0o600)
                json.dump(current, backup)
            if "COACH_CRON_TOKEN" in updates:
                payload = {**identity, "env": env}
                if "dotEnvPath" in current:
                    payload["dotEnvPath"] = current["dotEnvPath"]
                request("services.app.updateEnv", payload, mutation=True)
            if "source.image" in updates:
                payload = {**identity, "image": image}
                for key in ("username", "password"):
                    if source.get(key) is not None:
                        payload[key] = source[key]
                request("services.app.updateSourceImage", payload, mutation=True)
        print(json.dumps({
            "mode": "applied" if args.apply else "read_only", "project": args.project,
            "service": args.service, "current_image": source.get("image"),
            "requested_image": image, "changed_fields": updates,
            "deploy_required": bool(args.apply and updates),
            "openai_configured": bool(re.search(r"^OPENAI_API_KEY=\S+", current["env"], re.MULTILINE)),
            "cron_token_configured": bool(re.search(r"^COACH_CRON_TOKEN=\S+", current["env"], re.MULTILINE)),
        }))
        return 0
    except Exception as error:
        # HTTP error bodies and service snapshots may contain credentials.
        print(f"easypanel_operation_failed kind={type(error).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
