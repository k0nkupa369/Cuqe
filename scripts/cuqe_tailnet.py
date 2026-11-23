"""Serve the typed Cuqe disk read on an authenticated tailnet."""

import argparse
import subprocess

import uvicorn
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import TextContent, Tool, ToolAnnotations
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from cuqe_mcp import run_cli


def read_startup_disk() -> str:
    try:
        return run_cli("--read", "disk_space")
    except ToolError as error:
        if isinstance(error.__cause__, subprocess.TimeoutExpired):
            raise ToolError("Cuqe timed out reading startup disk space.") from None
        raise ToolError("The Mac could not read startup disk space.") from None


def create_app(serve_host: str, allowed_logins: frozenset[str]) -> Starlette:
    server = Server("Cuqe Tailnet")
    disk_tool = Tool(
        name="read_startup_disk",
        description="Read available space on this Mac's startup disk.",
        inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
        annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
    )

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [disk_tool]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[TextContent]:
        if name != disk_tool.name:
            raise ToolError("Unknown Cuqe tool.")
        result = await run_in_threadpool(read_startup_disk)
        return [TextContent(type="text", text=result)]

    manager = StreamableHTTPSessionManager(
        app=server,
        json_response=True,
        stateless=True,
        max_request_body_size=16_384,
        security_settings=TransportSecuritySettings(
            allowed_hosts=[serve_host],
            allowed_origins=[f"https://{serve_host}"],
        ),
    )

    class TailnetMcp:
        async def __call__(self, scope, receive, send) -> None:
            request = Request(scope)
            # Serve strips caller-supplied identity headers. Only trust the loopback proxy.
            logins = request.headers.getlist("tailscale-user-login")
            if (
                request.client is None
                or request.client.host != "127.0.0.1"
                or len(logins) != 1
                or logins[0] not in allowed_logins
            ):
                await PlainTextResponse("Cuqe access denied.", status_code=403)(scope, receive, send)
                return
            await manager.handle_request(scope, receive, send)

    return Starlette(routes=[Route("/mcp", endpoint=TailnetMcp())], lifespan=lambda app: manager.run())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve-host", required=True, help="Tailscale Serve DNS name, including a non-default HTTPS port")
    parser.add_argument("--allow-login", action="append", required=True, help="Exact Tailscale login. Repeat for each authorized user.")
    parser.add_argument("--port", type=int, default=9476, help="Loopback port used by Tailscale Serve")
    args = parser.parse_args()
    if not all(args.allow_login):
        parser.error("--allow-login must not be empty")
    uvicorn.run(
        create_app(args.serve_host, frozenset(args.allow_login)),
        host="127.0.0.1",
        port=args.port,
        proxy_headers=False,
        access_log=False,
    )


if __name__ == "__main__":
    main()
