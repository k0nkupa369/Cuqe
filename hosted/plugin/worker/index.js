const version = "2026-07-28";
const macAgentSource = null;
const releaseUrl = "https://github.com/k0nkupa369/Cuqe/releases/tag/v0.4-beta";

function relayOrigin(value) {
  try {
    const url = new URL(value);
    const host = /^[a-z0-9.-]+$/;
    if (url.protocol === "https:" && host.test(url.hostname) && !url.username && !url.password &&
        url.pathname === "/" && !url.search && !url.hash) return url.origin;
  } catch {}
  return null;
}

function macCommand(origin, command) {
  return `<pre tabindex="0"><code>python3 cuqe_hosted.py ${origin} ${command} --bin ./cuqe</code></pre>`;
}
const tools = [
  ["read_startup_disk", "Read free disk space on your paired Mac."],
  ["read_node_version", "Read the installed Node.js version on your paired Mac."],
].map(([name, description]) => ({
  name,
  description,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
}));

const formLifetimeMs = 600_000;

async function formToken(owner, secret, expiry = Date.now() + formLifetimeMs) {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", bytes.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const tag = await crypto.subtle.sign("HMAC", key, bytes.encode(JSON.stringify([owner, expiry])));
  return expiry + "." + Array.from(new Uint8Array(tag), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function validForm(token, owner, secret) {
  if (typeof token !== "string" || !/^\d{13}\.[a-f0-9]{64}$/.test(token)) return false;
  const expiry = Number(token.split(".", 1)[0]);
  const now = Date.now();
  if (expiry <= now || expiry > now + formLifetimeMs) return false;
  const expected = await formToken(owner, secret, expiry);
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function pairingPage(origin, owner, secret, paired, message = "", status = 200) {
  const field = `<input type="hidden" name="csrf" value="${await formToken(owner, secret)}">`;
  const controls = paired
    ? `<p>Your Mac is paired. In Terminal on that Mac, start the relay connection and leave it running.</p>
      ${macCommand(origin, "run")}<p>Open the plugin created for this Site in ChatGPT and ask for startup disk space or the installed Node.js version.</p>` +
      '<form method="post" action="/revoke">' + field + '<button>Revoke Mac access</button></form>'
    : `<ol>
      <li>Download and extract <a href="${releaseUrl}">Cuqe v0.4 beta for Apple silicon</a>. Follow the release instructions to verify the archive.</li>
      <li><a href="/mac-agent" download="cuqe_hosted.py">Download the Mac pairing script</a> and put it beside the <code>cuqe</code> executable.</li>
      <li>Open Terminal in that folder and run the command below. Paste the code it prints within five minutes.</li>
      </ol>${macCommand(origin, "pair")}` +
      '<form method="post" action="/pair">' + field + '<label for="code">One-time pairing code</label>' +
      '<input id="code" name="code" required maxlength="160" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<button>Pair Mac</button></form>';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair a Mac with Cuqe</title>
<style>
body{margin:0;background:#fafbff;color:#1b2030;font:1rem/1.55 system-ui,sans-serif}
main{max-width:42rem;margin:10vh auto;padding:1.5rem}h1{line-height:1.1;margin:.6rem 0 1rem}
ol{padding-left:1.5rem}li+li{margin-top:.6rem}a{color:#344fbc}pre{overflow:auto;background:#edf1fb;padding:.8rem;border-radius:.5rem}
form{display:grid;gap:.75rem}input,button{box-sizing:border-box;font:inherit;padding:.7rem;border-radius:.5rem}
input{width:100%;border:1px solid #75819e}button{justify-self:start;background:#344fbc;color:white;border:1px solid #344fbc;cursor:pointer}
:focus-visible{outline:2px solid #344fbc;outline-offset:3px}
</style></head><body><main><p>Cuqe Private</p><h1>Pair a Mac</h1>
${message ? `<p role="status">${message}</p>` : ""}${controls}</main></body></html>`;
  return new Response(html, { status, headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
  } });
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function toolResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function callRelay(env, action, body) {
  return fetch(new URL("/pilot/" + action, env.CUQE_RELAY), {
    method: "POST",
    headers: {
      authorization: "Bearer " + env.CUQE_PILOT_TOKEN,
      "content-type": "application/json",
      "user-agent": "CuqePrivatePlugin/0.1",
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(3000),
  });
}

async function readMachine(env, owner, operation) {
  try {
    const requested = await callRelay(env, "request", { owner, operation });
    if (requested.status === 404) return toolResult("Pair a Mac in the private Cuqe Site first.", true);
    if (!requested.ok) return toolResult("Cuqe could not start a new Mac read.", true);
    const { id } = await requested.json();
    const deadline = Date.now() + 8200;
    while (Date.now() < deadline) {
      const response = await callRelay(env, "result", { owner, id });
      if (response.status === 200) {
        const { result } = await response.json();
        return result ? toolResult(result) : toolResult("The Mac could not complete that read.", true);
      }
      if (response.status !== 202) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    return toolResult("The paired Mac did not return a result before the deadline.", true);
  } catch (error) {
    console.warn("Cuqe relay request failed", error instanceof Error ? error.name : "unknown");
    return toolResult("Cuqe could not reach the Mac relay.", true);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const owner = request.headers.get("oai-authenticated-user-id");
    const origin = relayOrigin(env.CUQE_RELAY);
    if (path === "/mac-agent" && request.method === "GET") {
      if (!owner) return json({ error: "sign_in_required" }, 401);
      if (macAgentSource === null) return json({ error: "download_unavailable" }, 503);
      return new Response(macAgentSource, { headers: {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="cuqe_hosted.py"',
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      } });
    }
    if (path === "/" || path === "/pair" || path === "/revoke") {
      if (!owner) return new Response(null, { status: 302, headers: { location: "/signin-with-chatgpt?return_to=%2F" } });
      const secret = env.CUQE_PILOT_TOKEN;
      if (!origin || !/^[a-f0-9]{64}$/.test(secret ?? "")) return new Response("Pairing is unavailable.", { status: 503 });
      try {
        if (path === "/" && request.method === "GET") {
          const state = await callRelay(env, "status", { owner });
          if (!state.ok) return new Response("Pairing status is unavailable.", { status: 503 });
          const { paired } = await state.json();
          return pairingPage(origin, owner, secret, paired);
        }
        if (path === "/" || request.method !== "POST") {
          return json({ error: "forbidden" }, 403);
        }
        const form = await request.formData();
        if (!await validForm(form.get("csrf"), owner, secret)) return json({ error: "forbidden" }, 403);
        if (path === "/revoke") {
          const result = await callRelay(env, "revoke", { owner });
          if (!result.ok && result.status !== 404) return new Response("Could not revoke the Mac.", { status: 503 });
          return new Response(null, { status: 303, headers: { location: "/" } });
        }
        const code = form.get("code");
        const result = await callRelay(env, "pair", { owner, code: typeof code === "string" ? code.trim() : null });
        if (result.ok) return new Response(null, { status: 303, headers: { location: "/" } });
        if (result.status === 400) return pairingPage(origin, owner, secret, false, "The code is invalid or expired. Generate a fresh code on the Mac.", 400);
        if (result.status === 409) return pairingPage(origin, owner, secret, false, "The code was already used or a Mac is already paired. Check your pairing on the home page.", 409);
        return new Response("Pairing is unavailable.", { status: 503 });
      } catch {
        return new Response("Pairing is unavailable.", { status: 503 });
      }
    }
    if (request.method !== "POST" || path !== "/mcp") return json({ error: "not_found" }, 404);

    const call = await request.json().catch(() => null);
    const id = call?.id ?? null;
    const send = result => json({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => json({ jsonrpc: "2.0", id, error: { code, message } });
    if (call?.jsonrpc !== "2.0" || typeof call.method !== "string") return fail(-32600, "Invalid MCP request.");

    switch (call.method) {
      case "server/discover":
        return send({ supportedVersions: [version], capabilities: { tools: {} } });
      case "initialize":
        return send({
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "Cuqe Private", version: "0.1.0" },
        });
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "ping":
        return send({});
      case "tools/list":
        return send({ tools });
      case "tools/call": {
        if (!owner) {
          return send(toolResult("Sign in with the private pilot account to read the Mac.", true));
        }
        const args = call.params?.arguments;
        const operation = call.params?.name;
        if (!tools.some(tool => tool.name === operation) || (args !== undefined && (
          !args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== 0
        ))) return fail(-32602, "Choose a supported read without arguments.");
        if (!origin) return send(toolResult("The private Mac relay is not configured.", true));
        return send(await readMachine(env, owner, operation));
      }
      default:
        return fail(-32601, "Unknown MCP method.");
    }
  },
};
