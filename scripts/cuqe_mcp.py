"""Expose verified read-only Cuqe commands as local MCP tools."""

import json
import subprocess
from pathlib import Path
from typing import Literal

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from typing_extensions import TypedDict


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "cuqe" if (ROOT / "cuqe").is_file() else ROOT / "target" / "release" / "cuqe"
server = FastMCP("Cuqe")


class NodeVersion(TypedDict):
    version: str
    executable: str
    resolution_scope: Literal["saved_profile", "process_path"]
    observed_at_unix_ms: int


def run_verified(flag: str, request: str) -> str:
    if not request.strip() or "\0" in request or len(request.encode("utf-8")) > 1024:
        raise ToolError("Provide a nonempty request within 1024 UTF-8 bytes.")

    return run_cli(flag, request)


def run_cli(flag: str, value: str) -> str:
    try:
        result = subprocess.run(
            [str(CLI), flag, value],
            capture_output=True,
            text=True,
            timeout=5 if flag == "--read" else 55,
        )
    except subprocess.TimeoutExpired as error:
        raise ToolError("Cuqe timed out before returning a result.") from error
    except OSError as error:
        raise ToolError("Could not start the Cuqe release binary.") from error

    if result.returncode:
        decline = "cuqe: Cuqe verifier declined the disk space request"
        if flag == "--verified" and result.stderr.removesuffix("\n") == decline:
            raise ToolError(
                f'{decline}. Suggested wording: "How much free space is on my startup disk?"'
            )
        raise ToolError(result.stderr.strip() or "Cuqe could not complete the read.")
    return result.stdout.strip()


@server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
def disk_space(request: str) -> str:
    """Read free space on this Mac's startup disk. Pass the user's request as written.

    If Cuqe declines and suggests wording, offer it to the user and wait for
    explicit approval before retrying once. For other errors, report the error
    without guessing a different wording or disk-space result.
    """
    return run_verified("--verified", request)


@server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
def node_version(request: str) -> NodeVersion:
    """Read the Node.js version from the saved Node profile, or Cuqe's PATH before setup.

    Pass the user's request as written. Report Cuqe errors without guessing a
    version or retrying.
    """
    return json.loads(run_verified("--verified-node-json", request))


@server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
def read_machine(action: Literal["disk_space", "node_version"]) -> str | NodeVersion:
    """Read the startup disk or the local installed Node.js version by explicit action ID.

    Use this only when that exact read answers the user's request. Ask for
    clarification if the target or intent is unclear. For online releases,
    package-manager versions, or instructions, choose a different tool.
    """
    if action not in ("disk_space", "node_version"):
        raise ToolError("Read action must be disk_space or node_version")
    result = run_cli("--read", action)
    return json.loads(result) if action == "node_version" else result


if __name__ == "__main__":
    server.run()
