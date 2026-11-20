"""Score an action proposal with local Cuqe without executing it."""
import argparse
import json
import math
import re
from urllib.request import ProxyHandler, Request, build_opener

CUTOFF = 2.2131806164979935
SYSTEM = (
    "Decide whether the candidate action fulfills the request. Accept only if the action "
    "does what the user asked. Return JSON with action a for accept or b for decline."
)


def verify(port, request, candidate):
    model = "cuqe-verifier:v0.1-beta"
    payload = {
        "model": model,
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_ctx": 2048, "num_predict": 32},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Request: {request}\nCandidate: {candidate}"},
        ],
        "format": {
            "type": "object",
            "properties": {"action": {"enum": ["a", "b"]}},
            "required": ["action"],
            "additionalProperties": False,
        },
        "logprobs": True,
        "top_logprobs": 20,
    }
    call = Request(
        f"http://127.0.0.1:{port}/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with build_opener(ProxyHandler({})).open(call, timeout=30) as response:
        result = json.load(response)
    if result.get("model") != model or not result.get("done"):
        raise ValueError("Ollama did not complete the requested model call")

    content = result["message"]["content"].encode()
    decision = re.fullmatch(rb'\s*\{\s*"action"\s*:\s*"([ab])"\s*\}\s*', content)
    tokens = result["logprobs"]
    pieces = [bytes(token["bytes"]) for token in tokens]
    if not decision or b"".join(pieces) != content:
        raise ValueError("Unexpected decision response")

    offset = 0
    for token, piece in zip(tokens, pieces, strict=True):
        if offset == decision.start(1) and piece == decision[1]:
            scores = {bytes(item["bytes"]): item["logprob"] for item in token["top_logprobs"]}
            if scores.get(piece) != token["logprob"] or not {b"a", b"b"} <= scores.keys():
                raise ValueError("Ollama did not return both decision scores")
            margin = scores[b"a"] - scores[b"b"]
            if not math.isfinite(margin):
                raise ValueError("Invalid decision margin")
            return {"decision": "accept" if margin >= CUTOFF else "decline", "margin": margin}
        offset += len(piece)
    raise ValueError("No standalone decision token")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request")
    parser.add_argument("candidate")
    parser.add_argument("--port", type=int, default=11434)
    args = parser.parse_args()
    print(json.dumps(verify(args.port, args.request, args.candidate)))
