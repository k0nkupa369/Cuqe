# Cuqe v0.1 beta model card

- Checkpoint: v21, 432 updates, Q4_K_M GGUF, 522,640,096 bytes.
- Base: [Qwen3 0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), revision `c1899de289a04d12100db370d81485cdf75e47ca`.
- Modifications: Cuqe fine-tuned a rank-eight LoRA adapter on 432 distinct requests presented twice, then exported the adapted weights into the Q4_K_M GGUF.
- License: [Apache 2.0](LICENSE). The original license is included.

## Intended use

Score one proposed action against one English request using a local Ollama server. The archived two-stage evaluation first used stock Qwen3 0.6B to rank a catalog, then used this checkpoint to keep or decline the proposal. The example in this repository takes a proposal directly.

## Development evidence

On the original simulated 48-request M4 development split, the two-stage pipeline kept the correct action on 39 of 48 offered presentations, declined 44 of 48 absent presentations, and kept the intended behavior on both presentations for 35 of 48 requests. Separate calibration kept 38 of 42 correctly ranked actions. A separate replay stopped 22 of 25 archived wrong stock proposals. The archived M4 p95 was 365 ms across 96 warm presentations, including stock ranking and verification. Ollama reported about 1.08 GiB resident for both models. These figures are development measurements from Ollama 0.40.15. Native v21 execution and loaded M1 performance were outside that evaluation.

The model can accept a similar action when the requested action is unavailable. In a release smoke check using Ollama 0.40.16, it accepted “Minimize the focused window” for the request “Close this window.” Keep this beta in simulation. Any app that executes actions needs its own authorization, input validation, and confirmation checks.

## Data credits

The training set used selected English utterances from [Amazon MASSIVE 1.1](https://huggingface.co/datasets/AmazonScience/massive/blob/ff6bd8e4b27c3543e4f8fe2108f32bb95a6f8740/README.md), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and [CLINC150 by Larson et al.](https://github.com/clinc/oos-eval/tree/828f8093932c8fe6ca7936c3d2e52903b1c523de), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The project added its own request text, candidate action descriptions, and accept/decline labels. The release contains the checkpoint and omits the source utterance files.
