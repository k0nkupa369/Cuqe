"""Print the v21 development results as a Markdown table from archived observations."""

import json
from math import ceil
from pathlib import Path

RESULTS = Path(__file__).with_name("results")
UNSUPPORTED = "unsupported"


def load(run):
    return json.loads((RESULTS / f"{run}.json").read_text(encoding="utf-8"))


def report():
    calibration = load("calibration")
    correct = sorted(
        (row["ranked_margin"] for row in calibration["cases"]
         if row["present"] and row["ranking"] == row["expected"]),
        reverse=True,
    )
    # The archive picked the highest cutoff retaining at least 90% of correct proposals.
    cutoff = correct[ceil(0.90 * len(correct)) - 1]
    if cutoff != calibration["cutoff"]:
        raise ValueError("Calibration scores do not reproduce the archived cutoff")
    retained = sum(margin >= cutoff for margin in correct)

    offered, absent = {}, {}
    for row in load("development")["cases"]:
        margin = row["ranked_margin"]
        final = row["ranking"] if margin is not None and margin >= cutoff else UNSUPPORTED
        group = offered if row["present"] else absent
        group[row["pair"]] = final == row["expected"]
    if offered.keys() != absent.keys():
        raise ValueError("Development presentations do not match by request ID")
    both = sum(offered[pair] and absent[pair] for pair in offered)

    replay = load("wrong-proposal-replay")["cases"]
    stopped = sum(row["margin"] < cutoff for row in replay)

    latency = load("latency")
    durations = sorted(row["elapsed_ms"] for row in latency["samples"])
    p95 = durations[ceil(0.95 * len(durations)) - 1]
    resident_gib = max(map(sum, latency["resident_size_bytes"])) / (1024 ** 3)

    return "\n".join([
        "| v21 development measure | Result |",
        "| --- | ---: |",
        f"| Correct action offered and kept | {sum(offered.values())}/{len(offered)} |",
        f"| Correct action absent and declined | {sum(absent.values())}/{len(absent)} |",
        f"| Both presentations correct | {both}/{len(offered)} |",
        f"| Correct stock proposals kept in calibration | {retained}/{len(correct)} |",
        f"| Archived wrong proposals declined | {stopped}/{len(replay)} |",
        f"| Warm p95, ranking and verification | {p95:.0f} ms over {len(durations)} presentations |",
        f"| Peak Ollama-reported resident size, both models | {resident_gib:.2f} GiB |",
    ])


if __name__ == "__main__":
    print(report())
