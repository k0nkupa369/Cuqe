# Cuqe v21 training and export

Cuqe started with the BF16 weights of Qwen3 0.6B at revision `c1899de289a04d12100db370d81485cdf75e47ca`. It trained a fresh rank-8 LoRA adapter on the last eight model layers. The fit took 432 optimizer updates. It used 432 distinct English requests, each paired with an accept and a decline candidate. The second pass repeated the first pass in the same order, for 864 pair presentations across the two passes. [Base model at the pinned revision](https://huggingface.co/Qwen/Qwen3-0.6B/tree/c1899de289a04d12100db370d81485cdf75e47ca) · [Archived adapter configuration](model/adapter/adapter_config.json)

## Data credits

The fit used selected English requests from Amazon Science's MASSIVE 1.1 under CC BY 4.0 and CLINC150 by Larson et al. under CC BY 3.0. Cuqe contributed its own request text, candidate descriptions, and accept and decline labels. The source utterances are omitted. [Dataset versions and licenses](MODEL_CARD.md#data-credits)

## Q4_K_M export

The archive recorded these steps for the update-432 adapter.

1. Fuse the adapter into the pinned BF16 base with `mlx_lm fuse` and restore the tied output head.
2. Use llama.cpp b12549 to convert the fused checkpoint to BF16 GGUF with `convert_hf_to_gguf.py --outtype bf16`. Run `llama-quantize --tensor-type attn_v=f16` with `Q4_K_M`.
3. Copy the 56 adapted tensors from that quantized file into the stock Q4_K_M GGUF. Verify that every byte outside those tensor payloads matches stock.
4. Register the resulting GGUF with Ollama using a relative `FROM` line in the Modelfile. The v0.1 beta asset has SHA-256 `3c35d685e4ccdcba0f14ac2b813cad0badabc278e0ed85154b0e4f435a956118`. [v0.1 beta release and checksum](https://github.com/k0nkupa369/Cuqe/releases/tag/v0.1-beta)

The [adapter files](model/adapter/) are the archived update-432 MLX package, covered by [Apache 2.0](LICENSE). The configuration retains the archive's relative paths. The weight file's SHA-256 is `4fc8427af3127685c680e047d6790ed51cef3ebf2fac2dd8f083798e18901d65` and the configuration's is `93e144758afeba84202c76c2cee56b5540d39b3b83392b0ed844d214f4c69589`.
