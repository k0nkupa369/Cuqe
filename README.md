# Cuqe

Cuqe v0.1 beta is a local action verifier based on fine-tuned Qwen3 0.6B. Give it a request and one proposed action. It returns an accept or decline decision. The beta verifies proposals in simulation and exposes no command execution.

[Download v0.1 beta](https://github.com/k0nkupa369/Cuqe/releases/tag/v0.1-beta) · [Model card](MODEL_CARD.md)

## Try it locally

Start [Ollama](https://ollama.com/download), clone this repository, and download `cuqe-v0.1-beta-q4_k_m.gguf` and `SHA256SUMS` from the release into the repository directory. Run these commands there. The example uses Python 3.10 or newer and connects only to localhost.

```sh
shasum -a 256 -c SHA256SUMS
ollama create cuqe-verifier:v0.1-beta -f Modelfile
python3 verify.py "Close the window I'm currently using." "Close only the currently focused window."
python3 verify.py "Close the window I'm currently using." "Minimize the focused window without closing it."
```

The examples test accept and decline without touching any windows. The script compares the token log probabilities at the model's decision field and accepts at a margin of 2.2131806164979935 or higher. It reports an error when the server does not return both scores. A caller should treat errors and declines as no action.
