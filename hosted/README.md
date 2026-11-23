# Run Cuqe privately in ChatGPT

Start with a [local Cuqe installation](../README.md#install-on-an-apple-silicon-mac). Check that both reads work on your Mac. If you only need Terminal or Codex on that Mac, use the [local MCP setup](../README.md#use-cuqe-from-codex).

The private ChatGPT setup uses two Sites. The **pairing Site** stays owner-only and uses built-in ChatGPT sign-in. The **device relay** has a public HTTPS address so the Mac can reach it. The relay requires credentials for every device and service request. These Workers are for your own deployment and do not depend on any shared Cuqe Site.

## Deploy the two Sites

You need access to ChatGPT Sites and permission to use Sites-hosted plugins in your workspace. Start from a checkout of [v0.4-beta](https://github.com/k0nkupa369/Cuqe/releases/tag/v0.4-beta). Node.js 22 or later builds the Workers. The Mac companion uses Python 3.9 or later.

1. Create a Sites project for [the relay](relay). Preserve the `DB` binding and include `hosted/relay/drizzle` when publishing. Build with `node hosted/relay/build.mjs`. The entry point is `hosted/relay/dist/server/index.js`. Set the relay audience to **Public**. Leave its MCP capability off.
2. Create a separate Sites project for [the pairing Site](plugin). Keep it **owner-only**. Preserve the `mcp` capability and leave storage disabled. Build with `node hosted/plugin/build.mjs`. This embeds the Mac companion in `hosted/plugin/dist/server/index.js`.
3. Use the Sites environment settings to configure the values below before publishing. Set a unique project ID in each project's `.openai/hosting.json` as part of Sites registration. Publish the relay first and use its HTTPS origin to configure the pairing Site.

| Site | Variable | Value |
| --- | --- | --- |
| Relay | `CUQE_PILOT_HASH` | SHA-256 of the service token as lowercase hexadecimal. Mark it secret. |
| Pairing Site | `CUQE_PILOT_TOKEN` | The service token. Mark it secret. |
| Pairing Site | `CUQE_RELAY` | Your relay HTTPS origin, such as `https://your-cuqe-relay.example`. Use the origin alone. |

Generate a 32-byte token and hash the lowercase hexadecimal string without a newline. Run this on your own Mac and copy the values directly into the respective Sites secret fields. Keep them out of Git and chat.

```sh
cuqe_token="$(openssl rand -hex 32)"
printf 'CUQE_PILOT_TOKEN=%s\n' "$cuqe_token"
printf 'CUQE_PILOT_HASH=%s\n' "$(printf '%s' "$cuqe_token" | shasum -a 256 | cut -d ' ' -f 1)"
unset cuqe_token
```

You can also do the deployment from Codex with Sites enabled. Open this checkout and ask:

> Deploy the two Cuqe Workers from `hosted/relay` and `hosted/plugin` using ChatGPT Sites. Set the relay to Public. Keep the pairing Site owner-only. Follow `hosted/README.md` for the builds, storage, and secrets. Return my two Site URLs.

## Pair and use your Mac

1. Open your pairing Site and sign in with the ChatGPT account that owns it.
2. Follow the page to download Cuqe and the Mac companion. Put both files in the same directory. Run the pairing command shown on your page with your relay URL, then paste the one-time code back into that page within five minutes.
3. Run the command shown after pairing and leave it running. If macOS asks for Keychain access, select **Allow**.
4. In ChatGPT, open **Plugins**, then **Personal**, then **Created by you**. Install or connect the plugin created for your pairing Site. In a new chat, select it and ask for startup disk space or your installed Node.js version. Compare both results with the local CLI. [Sites plugin hosting](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)

The companion accepts `pair`, `status`, and `run`. For a source build, pass `--bin ./target/release/cuqe` and use `scripts/cuqe_hosted.py` as the companion path. The Mac must be online and running the companion for fresh reads.

To disconnect, choose **Revoke Mac access** on the pairing page. Confirm that the plugin reports no paired Mac before pairing again. If you change the relay origin, pair again so the Mac stores a credential for the new origin.

## Check a source change locally

Build the release binary, then run `node hosted/plugin/build.mjs && node hosted/probe.mjs`. This integration check uses local SQLite and demo credentials to exercise pairing, both Mac reads, and revocation. It does not require a deployed Site.
