# Cuqe

Read startup-disk space and the installed Node.js version on an Apple silicon Mac. Cuqe supports a terminal and local Codex through MCP. The named reads work without a model service.

## Install on an Apple silicon Mac

Download `cuqe-v0.2-beta-macos-arm64.tar.gz` and `SHA256SUMS` from the [v0.2 beta release](https://github.com/k0nkupa369/Cuqe/releases/tag/v0.2-beta). In the download directory, verify and extract the archive.

```sh
shasum -a 256 -c SHA256SUMS
tar -xzf cuqe-v0.2-beta-macos-arm64.tar.gz
cd cuqe-v0.2-beta-macos-arm64
./cuqe --version
```

The binary is a beta build. If macOS blocks it, build from the tagged source with Rust 1.92 or later and the Xcode command-line tools.

```sh
git clone --branch v0.2-beta https://github.com/k0nkupa369/Cuqe.git
cd Cuqe
cargo build --release --locked
./target/release/cuqe --version
```

## Read disk space and Node.js

Run these in the extracted directory. For a source build, use `./target/release/cuqe` in place of `./cuqe`.

```sh
./cuqe --read disk_space
./cuqe --onboard-node
./cuqe --read node_version
```

Activate your preferred Node.js installation in the terminal before onboarding. Cuqe resolves the first executable `node` on your shell's `PATH`, probes its version, and saves the resolved path in `~/Library/Application Support/Cuqe/node.json`. Subsequent reads use that executable and report its version, path, scope, and observation time. Refresh onboarding if a package-manager upgrade removes the saved binary. Cuqe uses its own process's `PATH` before onboarding. Set `CUQE_CONFIG_DIR` to use a separate profile.

## Use Cuqe from Codex

Install [uv](https://docs.astral.sh/uv/) and open a terminal in the extracted package or source checkout. Register the local MCP server in Codex.

```sh
codex mcp add cuqe -- "$(command -v uv)" run --python 3.12 --with mcp==1.29.0 "$PWD/scripts/cuqe_mcp.py"
```

In a new Codex session, ask “Use Cuqe to check free space on my startup disk” or “Use Cuqe to check my installed Node.js version.” The `cuqe.read_machine` tool accepts only `disk_space` and `node_version`. It runs the corresponding read on this Mac. If you set a separate profile, give the MCP server the same `CUQE_CONFIG_DIR`.

## Optional free-form verification

Use a local Ollama instance that returns decision token log probabilities. Keep it on loopback. Get the GGUF and its checksum file from the [v0.1 beta model release](https://github.com/k0nkupa369/Cuqe/releases/tag/v0.1-beta). Place the GGUF and its checksum file next to the supplied Modelfile, then run the following commands.

```sh
shasum -a 256 -c SHA256SUMS
ollama pull qwen3:0.6b
ollama create cuqe-verifier:v0.1-beta -f Modelfile
./cuqe --verified "How much free space is on my startup disk?"
./cuqe --verified-node "What is the installed Node.js version?"
```

Set `CUQE_OLLAMA_PORT` to use a different local port. The optional MCP tools `cuqe.disk_space` and `cuqe.node_version` take the original request and use this path. The verifier can decline valid wording or accept an incorrect proposal. Use explicit action IDs when the caller already knows which read to perform. The [model card](MODEL_CARD.md) describes the fixed v21 checkpoint. See [the changelog](CHANGELOG.md) for release history.
