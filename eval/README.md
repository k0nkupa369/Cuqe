# Verify the v21 development results

From the repository root, run `python3 eval/report.py`. It uses the Python standard library and reads the four JSON files in [results/](results/). It recomputes results from saved observations without running either model.

| File | Archived input | What the report checks |
| --- | --- | --- |
| [development.json](results/development.json) | `heldout.json` | The final action on each offered and absent presentation, matched by request ID. A proposal below the cutoff becomes a decline. |
| [calibration.json](results/calibration.json) | `calibration.json` and `thresholds.json` | The highest cutoff that retains at least 90% of the stock router's correct offered proposals. The report checks that the calculated cutoff matches the archived value. |
| [wrong-proposal-replay.json](results/wrong-proposal-replay.json) | `stress.json` and `stress-cases.json` | The number of known wrong proposals with margins below the cutoff. |
| [latency.json](results/latency.json) | `benchmark.json` | The nearest-rank warm p95, rounded to whole milliseconds, and the peak sum of both models' Ollama-reported resident sizes. |

The JSON files retain request and action IDs, stock proposals, v21 margins, and timing samples from the original Apple M4 run with Ollama 0.40.15. They include SHA-256 hashes of the original archives. Request text and candidate descriptions are omitted, including any source utterances. See the [data credits](../MODEL_CARD.md#data-credits).

The simulated catalogs covered actions beyond Cuqe's two shipped reads. These files reproduce the reported development counts and timing. Re-running inference would require the original text and catalogs.
