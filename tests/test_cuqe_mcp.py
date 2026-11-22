import json
from subprocess import CompletedProcess, TimeoutExpired

import pytest

from scripts import cuqe_mcp


NODE = {
    "version": "v22.0.0",
    "executable": "/example/bin/node",
    "resolution_scope": "saved_profile",
    "observed_at_unix_ms": 1000,
}


def fake_cli(monkeypatch, flag, value, *, stdout="", stderr="", returncode=0):
    def run(args, *, capture_output, text, timeout):
        assert args == [str(cuqe_mcp.CLI), flag, value]
        assert capture_output and text
        assert timeout == (5 if flag == "--read" else 55)
        return CompletedProcess(args, returncode, stdout, stderr)

    monkeypatch.setattr(cuqe_mcp.subprocess, "run", run)


@pytest.mark.parametrize(
    ("action", "stdout", "expected"),
    [("disk_space", "75.0% free\n", "75.0% free"), ("node_version", json.dumps(NODE), NODE)],
)
def test_named_reads(monkeypatch, action, stdout, expected):
    fake_cli(monkeypatch, "--read", action, stdout=stdout)
    assert cuqe_mcp.read_machine(action) == expected


def unexpected_process(*args, **kwargs):
    pytest.fail("Cuqe should reject this input before calling the CLI")


@pytest.mark.parametrize("action", ["", "--help", "disk_free", "other"])
def test_named_reads_reject_other_actions(monkeypatch, action):
    monkeypatch.setattr(cuqe_mcp.subprocess, "run", unexpected_process)
    with pytest.raises(cuqe_mcp.ToolError, match="Read action must be disk_space or node_version"):
        cuqe_mcp.read_machine(action)


@pytest.mark.parametrize("request_text", [" ", "a\0b", "é" * 513])
def test_verified_requests_reject_invalid_input(monkeypatch, request_text):
    monkeypatch.setattr(cuqe_mcp.subprocess, "run", unexpected_process)
    with pytest.raises(cuqe_mcp.ToolError, match="1024 UTF-8 bytes"):
        cuqe_mcp.disk_space(request_text)


def test_verified_node_returns_structured_result(monkeypatch):
    request_text = "What is my installed Node.js version?"
    fake_cli(monkeypatch, "--verified-node-json", request_text, stdout=json.dumps(NODE))
    assert cuqe_mcp.node_version(request_text) == NODE


def test_verified_disk_decline_includes_suggested_wording(monkeypatch):
    request_text = "How full is the startup drive?"
    fake_cli(
        monkeypatch, "--verified", request_text, returncode=1,
        stderr="cuqe: Cuqe verifier declined the disk space request\n",
    )
    with pytest.raises(cuqe_mcp.ToolError, match="Suggested wording"):
        cuqe_mcp.disk_space(request_text)


def test_cli_timeout_becomes_tool_error(monkeypatch):
    def time_out(args, **kwargs):
        raise TimeoutExpired(args, kwargs["timeout"])

    monkeypatch.setattr(cuqe_mcp.subprocess, "run", time_out)
    with pytest.raises(cuqe_mcp.ToolError, match="timed out"):
        cuqe_mcp.read_machine("disk_space")
