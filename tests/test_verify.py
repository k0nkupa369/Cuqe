import io
import json

import pytest

import verify


def reply(accept, decline):
    scores = [{"bytes": [ord("a")], "logprob": accept}]
    if decline is not None:
        scores.append({"bytes": [ord("b")], "logprob": decline})
    return {
        "model": "cuqe-verifier:v0.1-beta",
        "done": True,
        "message": {"content": '{"action":"a"}'},
        "logprobs": [
            {"bytes": list(b'{"action":"')},
            {"bytes": [ord("a")], "logprob": accept, "top_logprobs": scores},
            {"bytes": list(b'"}')},
        ],
    }


def fake_http(monkeypatch, response):
    class Opener:
        def open(self, call, *, timeout):
            assert call.full_url == "http://127.0.0.1:12345/api/chat"
            assert call.get_method() == "POST"
            assert timeout == 30
            payload = json.loads(call.data)
            assert payload["model"] == "cuqe-verifier:v0.1-beta"
            assert payload["messages"][1]["content"] == "Request: Disk space?\nCandidate: Read disk space."
            assert payload["format"]["properties"]["action"]["enum"] == ["a", "b"]
            assert (payload["stream"], payload["think"], payload["logprobs"], payload["top_logprobs"]) == (
                False, False, True, 20,
            )
            return io.StringIO(json.dumps(response))

    def build(proxy):
        assert proxy.proxies == {}
        return Opener()

    monkeypatch.setattr(verify, "build_opener", build)


@pytest.mark.parametrize(
    ("margin", "decision"),
    [(3.0, "accept"), (2.0, "decline"), (2.2131806164979935, "accept")],
)
def test_verifier_cutoff(monkeypatch, margin, decision):
    fake_http(monkeypatch, reply(0.0, -margin))
    assert verify.verify(12345, "Disk space?", "Read disk space.") == {
        "decision": decision, "margin": margin,
    }


@pytest.mark.parametrize(
    ("accept", "decline", "error"),
    [(0.0, None, "both decision scores"), (1e308, -1e308, "Invalid decision margin")],
)
def test_verifier_rejects_bad_scores(monkeypatch, accept, decline, error):
    fake_http(monkeypatch, reply(accept, decline))
    with pytest.raises(ValueError, match=error):
        verify.verify(12345, "Disk space?", "Read disk space.")


@pytest.mark.parametrize(
    ("changes", "error"),
    [
        ({"done": False}, "did not complete"),
        ({"model": "other"}, "did not complete"),
        ({"message": {"content": '{"action":"b"}'}}, "Unexpected decision response"),
    ],
)
def test_verifier_rejects_bad_response(monkeypatch, changes, error):
    fake_http(monkeypatch, reply(0.0, -3.0) | changes)
    with pytest.raises(ValueError, match=error):
        verify.verify(12345, "Disk space?", "Read disk space.")
