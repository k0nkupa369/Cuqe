"""Pair a Mac and serve Cuqe's built-in read-only commands over HTTPS."""

from __future__ import annotations

import argparse
import json
import re
import secrets
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

SERVICE = "Cuqe Hosted Pilot"
TOKEN = re.compile(r"[a-f0-9]{64}")
KEYCHAIN_ITEM_NOT_FOUND = 44


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


READS = {"read_startup_disk": "disk_space", "read_node_version": "node_version"}


def read_machine(binary: Path, action: str) -> str:
    output = subprocess.check_output([str(binary), "--read", action], text=True, timeout=5, stderr=subprocess.DEVNULL).strip()
    return json.loads(output)["version"] if action == "node_version" else output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("relay", help="HTTPS origin of the Cuqe device relay")
    parser.add_argument("command", choices=["pair", "status", "run"], nargs="?", default="run")
    parser.add_argument("--account", default="cuqe-paired-mac", help="Keychain account for this Mac")
    parser.add_argument("--bin", type=Path, help="Path to the Cuqe executable")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    binary = args.bin.resolve() if args.bin else root / "cuqe"
    if args.bin is None and not binary.is_file():
        binary = root.parent / "target" / "release" / "cuqe"
    if args.command == "run" and not binary.is_file():
        parser.error("Cuqe binary not found. Pass --bin with the path to your Cuqe executable.")
    relay = urlsplit(args.relay)
    if (relay.scheme != "https" or not relay.hostname or relay.username or relay.password
            or relay.query or relay.fragment or relay.path not in ("", "/")
            or not re.fullmatch(r"[a-zA-Z0-9.-]{1,253}", relay.hostname)):
        parser.error("Provide an HTTPS origin without credentials or an API path.")
    if not re.fullmatch(r"[a-zA-Z0-9_.-]{1,80}", args.account):
        parser.error("Use letters, digits, underscores, periods, or hyphens in the Keychain account.")

    relay_origin = f"https://{relay.hostname}"
    try:
        relay_port = relay.port
    except ValueError:
        parser.error("The relay HTTPS port is invalid.")
    if relay_port not in (None, 443):
        relay_origin += f":{relay_port}"
    # Use the same canonical origin for network requests and credential lookup.
    keychain_service = f"{SERVICE} ({relay_origin})"
    keychain = ["/usr/bin/security", "find-generic-password", "-s", keychain_service, "-a", args.account, "-w"]
    saved = subprocess.run(keychain, capture_output=True, text=True, check=False)
    if saved.returncode not in (0, KEYCHAIN_ITEM_NOT_FOUND):
        raise SystemExit("Could not access the Cuqe Keychain item. Unlock the keychain and allow the request.")
    token = saved.stdout.strip() if saved.returncode == 0 else ""
    opener = build_opener(NoRedirect())

    def post(path: str, body: dict | None = None) -> dict:
        request = Request(
            relay_origin + "/device/" + path,
            data=json.dumps(body or {}).encode(),
            headers={
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
                "User-Agent": "CuqeHostedPilot/0.2",
            },
        )
        with opener.open(request, timeout=5) as response:
            return json.load(response)

    def check_status() -> bool:
        if not TOKEN.fullmatch(token):
            return False
        try:
            return post("status")["paired"] is True
        except HTTPError as error:
            if error.code != 403 or error.headers.get_content_type() != "application/json":
                raise
            detail = json.load(error)
            if detail.get("error") != "device_unpaired_or_revoked":
                raise
            return False

    try:
        if args.command == "status":
            if not check_status():
                raise SystemExit("This Mac is unpaired or revoked.")
            print("This Mac is paired.")
            return
        if args.command == "pair":
            if check_status():
                raise SystemExit("This Mac is already paired.")
            token = secrets.token_hex(32)
            code = post("pair-code")["code"]
            # Replace a revoked item so its old trust settings cannot carry over.
            if saved.returncode == 0:
                subprocess.run(
                    ["/usr/bin/security", "delete-generic-password", "-s", keychain_service, "-a", args.account],
                    capture_output=True, check=True,
                )
            # An empty trusted-app list requires explicit Keychain approval.
            line = f'add-generic-password -s "{keychain_service}" -a {args.account} -T "" -w {token}\n'
            subprocess.run(["/usr/bin/security", "-q", "-i"], input=line.encode(), capture_output=True, check=True)
            if subprocess.check_output(keychain, text=True, stderr=subprocess.DEVNULL).strip() != token:
                raise SystemExit("Could not store the Cuqe credential in Keychain.")
            print("Paste this code into the private Cuqe Site within five minutes.\n" + code)
            return
        if not check_status():
            raise SystemExit("Pair this Mac before starting Cuqe.")
    except (HTTPError, URLError, TimeoutError, subprocess.SubprocessError):
        raise SystemExit("Cuqe could not check or pair this Mac. Check the relay and Keychain.") from None

    while True:
        try:
            job = post("next")["job"]
            if job and job["operation"] in READS:
                operation = job["operation"]
                try:
                    result = read_machine(binary, READS[operation])
                except (OSError, subprocess.SubprocessError, ValueError, KeyError):
                    result = None
                post("result", {"id": job["id"], "operation": operation, "result": result})
                print("Processed Cuqe read: " + operation, flush=True)
        except HTTPError as error:
            if error.code in (401, 403):
                raise SystemExit("The Cuqe device credential was rejected or revoked.") from None
        except (TimeoutError, URLError):
            time.sleep(1)
        time.sleep(0.75)


if __name__ == "__main__":
    main()
