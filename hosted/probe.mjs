import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

async function worker(path) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  return (await import("data:text/javascript;base64," + bytes.toString("base64"))).default;
}

const [relay, plugin] = await Promise.all([
  worker("./relay/worker/index.js"),
  worker("./plugin/dist/server/index.js"),
]);
const database = new DatabaseSync(":memory:");
for (const file of ["0000_disk_reads.sql", "0001_pairing.sql"]) {
  database.exec(readFileSync(new URL("relay/drizzle/" + file, import.meta.url), "utf8"));
}
function prepare(sql) {
  return {
    bind(...args) {
      const query = database.prepare(sql);
      return { first: () => query.get(...args), run: () => query.run(...args) };
    },
  };
}
const pilot = "a".repeat(64);
const mac = "b".repeat(64);
const outsider = "c".repeat(64);
const signedIn = "site-owner";
const relayOrigin = "https://relay.example";
const pluginOrigin = "https://plugin.example";
const relayEnv = {
  CUQE_PILOT_HASH: createHash("sha256").update(pilot).digest("hex"),
  DB: { prepare, batch: statements => statements.map(statement => statement.run()) },
};
globalThis.fetch = (url, options) => relay.fetch(new Request(url, options), relayEnv);
const pluginEnv = { CUQE_RELAY: relayOrigin, CUQE_PILOT_TOKEN: pilot };

async function relayPost(path, token, body = {}) {
  return relay.fetch(new Request(relayOrigin + path, {
    method: "POST",
    headers: token ? { authorization: "Bearer " + token } : {},
    body: JSON.stringify(body),
  }), relayEnv);
}

async function pageAction(path, form, owner = signedIn, includeToken = true) {
  if (includeToken) {
    const page = await plugin.fetch(new Request(pluginOrigin, { headers: { "oai-authenticated-user-id": owner } }), pluginEnv);
    form = { ...form, csrf: (await page.text()).match(/name="csrf" value="([^"]+)"/)[1] };
  }
  return plugin.fetch(new Request(pluginOrigin + path, {
    method: "POST",
    headers: { "oai-authenticated-user-id": owner },
    body: new URLSearchParams(form),
  }), pluginEnv);
}

async function rpc(method, params) {
  return (await plugin.fetch(new Request(pluginOrigin + "/mcp", {
    method: "POST",
    headers: { "oai-authenticated-user-id": signedIn },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), pluginEnv)).json();
}

const anonymous = await plugin.fetch(new Request(pluginOrigin), pluginEnv);
assert.equal(anonymous.status, 302);
assert.match(anonymous.headers.get("location"), /signin-with-chatgpt/);
const signedInHeaders = { "oai-authenticated-user-id": signedIn };
const downloadUrl = pluginOrigin + "/mac-agent";
assert.equal((await plugin.fetch(new Request(downloadUrl), pluginEnv)).status, 401);
const download = await plugin.fetch(new Request(downloadUrl, { headers: signedInHeaders }), pluginEnv);
assert.equal(download.status, 200);
assert.equal(await download.text(), readFileSync(new URL("../scripts/cuqe_hosted.py", import.meta.url), "utf8"));
const setupPage = await plugin.fetch(new Request(pluginOrigin, { headers: signedInHeaders }), pluginEnv);
const setupHtml = await setupPage.text();
assert.ok(setupHtml.includes("python3 cuqe_hosted.py " + relayOrigin + " pair --bin ./cuqe"));
assert.ok(setupHtml.includes("/releases/tag/v0.4-beta"));
const badRelay = await plugin.fetch(new Request(pluginOrigin, { headers: signedInHeaders }), {
  ...pluginEnv, CUQE_RELAY: relayOrigin + "/unexpected",
});
assert.equal(badRelay.status, 503);

assert.equal((await relayPost("/device/pair-code", null)).status, 401);
assert.equal((await relayPost("/pilot/pair", mac, { owner: signedIn })).status, 401);
assert.equal((await relayPost("/device/next", mac)).status, 403);
const { code } = await (await relayPost("/device/pair-code", mac)).json();
assert.equal((await pageAction("/pair", { code }, signedIn, false)).status, 403);
assert.equal((await pageAction("/pair", { code: code.slice(0, -1) + (code.endsWith("a") ? "b" : "a") })).status, 400);
assert.equal((await pageAction("/pair", { code })).status, 303);
const pairedPage = await plugin.fetch(new Request(pluginOrigin, { headers: signedInHeaders }), pluginEnv);
assert.match(await pairedPage.text(), /python3 cuqe_hosted.py .* run --bin \.\/cuqe/);
assert.equal((await pageAction("/pair", { code })).status, 409);
assert.equal((await relayPost("/pilot/request", pilot, { owner: "a-different-owner", operation: "read_startup_disk" })).status, 404);
assert.deepEqual((await rpc("tools/list")).result.tools.map(tool => tool.name), ["read_startup_disk", "read_node_version"]);
assert.equal((await rpc("tools/call", { name: "shell" })).error.code, -32602);

for (const [operation, action] of [["read_startup_disk", "disk_space"], ["read_node_version", "node_version"]]) {
  const local = execFileSync("./target/release/cuqe", ["--read", action], { encoding: "utf8" }).trim();
  const expected = action === "node_version" ? JSON.parse(local).version : local;
  const caller = rpc("tools/call", { name: operation, arguments: {} });
  let job;
  for (let attempt = 0; !job && attempt < 40; attempt++) {
    ({ job } = await (await relayPost("/device/next", mac)).json());
    if (!job) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(job?.operation, operation);
  assert.equal((await relayPost("/device/result", outsider, { ...job, result: expected })).status, 403);
  assert.equal((await relayPost("/device/result", mac, { ...job, result: "invalid" })).status, 400);
  assert.equal((await relayPost("/device/result", mac, { ...job, result: expected })).status, 200);
  assert.equal((await caller).result.content[0].text, expected);
  assert.equal((await relayPost("/pilot/result", pilot, { owner: signedIn, id: job.id })).status, 404);
}

assert.equal((await pageAction("/revoke", {})).status, 303);
assert.equal((await relayPost("/device/next", mac)).status, 403);
assert.equal((await pageAction("/pair", { code })).status, 409);
const { code: expired } = await (await relayPost("/device/pair-code", outsider)).json();
const realNow = Date.now;
try {
  Date.now = () => realNow() + 300_001;
  assert.equal((await pageAction("/pair", { code: expired })).status, 400);
} finally {
  Date.now = realNow;
}
console.log("Pairing, expiry, replay, owner isolation, both Mac reads, one-time results, and revocation passed.");
