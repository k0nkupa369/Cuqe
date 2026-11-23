"""Check an actual Cuqe MCP endpoint from a second device."""

from __future__ import annotations

import argparse
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def rpc(url: str, method: str, params: dict | None = None) -> dict:
    body = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    request = Request(
        url,
        data=json.dumps(body).encode(),
        headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        },
    )
    with urlopen(request, timeout=8) as response:
        return json.load(response)["result"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    expected = parser.add_mutually_exclusive_group(required=True)
    expected.add_argument("--disk-result", help="Expected output from cuqe --read disk_space on the serving Mac")
    expected.add_argument("--denied", action="store_true", help="Expect HTTP 403")
    args = parser.parse_args()

    try:
        listed = rpc(args.url, "tools/list")
    except HTTPError as error:
        if args.denied and error.code == 403:
            print("Cuqe denied access (HTTP 403).")
            return
        raise
    assert not args.denied, "Cuqe accepted a request that should have been denied."
    assert [tool["name"] for tool in listed["tools"]] == ["read_startup_disk"]
    result = rpc(args.url, "tools/call", {"name": "read_startup_disk", "arguments": {}})
    assert result.get("isError") is False and result["content"][0]["text"] == args.disk_result
    rejected = rpc(
        args.url, "tools/call", {"name": "read_startup_disk", "arguments": {"action": "node_version"}}
    )
    assert rejected.get("isError") is True
    print("Cuqe returned the expected disk read and rejected unsupported arguments.")


if __name__ == "__main__":
    main()
