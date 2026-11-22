from pathlib import Path

from eval.report import report


def test_report_reproduces_archived_v21_results():
    table = report()
    assert table.splitlines()[2:] == [
        "| Correct action offered and kept | 39/48 |",
        "| Correct action absent and declined | 44/48 |",
        "| Both presentations correct | 35/48 |",
        "| Correct stock proposals kept in calibration | 38/42 |",
        "| Archived wrong proposals declined | 22/25 |",
        "| Warm p95, ranking and verification | 365 ms over 96 presentations |",
        "| Peak Ollama-reported resident size, both models | 1.08 GiB |",
    ]
    root = Path(__file__).resolve().parents[1]
    assert table in (root / "MODEL_CARD.md").read_text(encoding="utf-8")
