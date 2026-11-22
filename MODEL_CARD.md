# Cuqe v0.1 beta model card

- Checkpoint: v21, 432 updates, Q4_K_M GGUF, 522,640,096 bytes.
- Base: [Qwen3 0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), revision `c1899de289a04d12100db370d81485cdf75e47ca`.
- Modifications: Cuqe fine-tuned a rank-eight LoRA adapter on 432 distinct requests presented twice, then exported the adapted weights into the Q4_K_M GGUF.
- License: [Apache 2.0](LICENSE). The original license is included.

## Intended use

Score one proposed action against one English request using a local Ollama server. The archived two-stage evaluation first used stock Qwen3 0.6B to rank a catalog, then used this checkpoint to keep or decline the proposal. The Python simulator in this repository takes a proposal directly.

## Development evidence

These are simulated development measurements from an Apple M4 running Ollama 0.40.15. The development split presented each request twice, with the correct action offered and absent. Calibration and wrong-proposal replay used separate sets. The latency run measured the stock router and v21 verifier together.

| v21 development measure | Result |
| --- | ---: |
| Correct action offered and kept | 39/48 |
| Correct action absent and declined | 44/48 |
| Both presentations correct | 35/48 |
| Correct stock proposals kept in calibration | 38/42 |
| Archived wrong proposals declined | 22/25 |
| Warm p95, ranking and verification | 365 ms over 96 presentations |
| Peak Ollama-reported resident size, both models | 1.08 GiB |

Run `python3 eval/report.py` to regenerate the table from the [archived observations](eval/README.md). This evaluation covered simulated actions. It did not measure native execution or loaded M1 performance.

The model can accept a similar action when the requested action is unavailable. In a release smoke check using Ollama 0.40.16, it accepted “Minimize the focused window” for “Close this window.” With the [v21 model installed](README.md#optional-free-form-verification), try the same pair in the simulator.

```sh
python3 verify.py 'Close this window.' 'Minimize the focused window'
```

The simulator scores the proposal and prints the decision and margin. Cuqe's CLI only runs the two [built-in reads](README.md#read-disk-space-and-nodejs).

## Data credits

The training set used selected English utterances from [Amazon MASSIVE 1.1](https://huggingface.co/datasets/AmazonScience/massive/blob/ff6bd8e4b27c3543e4f8fe2108f32bb95a6f8740/README.md), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and [CLINC150 by Larson et al.](https://github.com/clinc/oos-eval/tree/828f8093932c8fe6ca7936c3d2e52903b1c523de), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The project added its own request text, candidate action descriptions, and accept/decline labels. The release contains the checkpoint and omits the source utterance files.
