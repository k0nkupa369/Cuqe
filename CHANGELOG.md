# Changelog

## v0.4-beta

- Added reusable Sites Workers and deployment instructions for a private ChatGPT connection.
- The pairing page shows the relay URL from your deployment and links to the matching release.
- Put local CLI and Codex setup first in the README, with separate instructions for Tailscale and private ChatGPT.

## v0.3-beta

- Added a private Tailscale MCP path for the startup disk read.
- Added a Mac companion for an authorized hosted relay, with relay-scoped Keychain storage, one-time pairing, and revocation.
- Added the Cuqe skill for agent tool selection.
- Updated the local Python MCP SDK to 1.30.0.
- Included the archived v21 training and evaluation documentation already published on GitHub. The verifier weights have the same version.

## v0.2-beta

- Added an Apple silicon CLI for startup-disk space and the installed Node.js version.
- Added Node onboarding, saved executable selection, and structured Node observations.
- Added local Codex MCP tools. Explicit read IDs work without a model runtime.
- Added optional free-form verification for the same two reads with the existing v21 checkpoint.
- Added a macOS arm64 archive and SHA-256 checksum.

## v0.1-beta

- Published the Qwen3 0.6B v21 Q4_K_M verifier weights, checksum, attribution, and model card.
- Added an Ollama Modelfile and a Python verifier simulation.
