const readLifetimeMs = 8000;
const codeLifetimeMs = 300_000;
const tokenPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const codePattern = /^Q1\.(\d{13})\.([a-f0-9]{64})\.([a-f0-9]{64})$/;
const results = new Map([
  ["read_startup_disk", /^\d{1,3}\.\d% free \(\d+\.\d GiB available of \d+\.\d GiB total\) on \/System\/Volumes\/Data$/],
  ["read_node_version", /^v\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]{1,60})?$/],
]);
const active = "SELECT 1 FROM paired_macs WHERE device = ? AND revoked_at IS NULL";

function reply(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function equal(left, right) {
  if (typeof right !== "string" || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function hashToken(request) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  return token ? hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))) : null;
}

async function codeTag(payload, secret) {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", bytes.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, bytes.encode(payload)));
}

async function redeem(db, code, owner, now, secret) {
  const parts = typeof code === "string" ? codePattern.exec(code) : null;
  if (!parts) return reply({ error: "invalid_or_expired" }, 400);
  const [, expiry, device, tag] = parts;
  if (+expiry <= now || +expiry > now + codeLifetimeMs ||
      !equal(tag, await codeTag(`Q1.${expiry}.${device}`, secret))) {
    return reply({ error: "invalid_or_expired" }, 400);
  }
  const paired = await db.prepare(`
    INSERT INTO paired_macs (device, owner) VALUES (?, ?)
    ON CONFLICT DO NOTHING RETURNING device
  `).bind(device, owner).first();
  return paired ? reply({ paired: true }) : reply({ error: "already_used_or_mac_active" }, 409);
}

async function read(db, route, device, body, now) {
  await db.prepare("DELETE FROM machine_reads WHERE expires_at <= ?").bind(now).run();
  if (route === "/pilot/request") {
    if (!results.has(body.operation)) return reply({ error: "unsupported_operation" }, 400);
    const row = await db.prepare(`
      INSERT INTO machine_reads (id, device, operation, expires_at, status)
      SELECT ?, ?, ?, ?, 'pending' WHERE EXISTS (${active})
      ON CONFLICT(device) DO NOTHING RETURNING id
    `).bind(crypto.randomUUID(), device, body.operation, now + readLifetimeMs, device).first();
    return row ? reply(row) : reply({ error: "device_busy_or_revoked" }, 409);
  }
  if (route === "/device/next") {
    const row = await db.prepare(`
      UPDATE machine_reads SET status = 'claimed'
      WHERE device = ? AND status = 'pending' AND expires_at > ? AND EXISTS (${active})
      RETURNING id, operation
    `).bind(device, now, device).first();
    return reply({ job: row ?? null });
  }
  if (typeof body.id !== "string" || !idPattern.test(body.id)) {
    return reply({ error: "invalid_request" }, 400);
  }
  if (route === "/device/result") {
    const { operation, result } = body;
    if (!results.has(operation) || (result !== null &&
        (typeof result !== "string" || !results.get(operation).test(result)))) {
      return reply({ error: "invalid_result" }, 400);
    }
    const row = await db.prepare(`
      UPDATE machine_reads SET status = 'done', result = ?
      WHERE id = ? AND device = ? AND operation = ? AND status = 'claimed'
        AND expires_at > ? AND EXISTS (${active})
      RETURNING id
    `).bind(result, body.id, device, operation, now, device).first();
    return row ? reply({ accepted: true }) : reply({ error: "expired_or_unknown" }, 409);
  }
  const row = await db.prepare(`
    DELETE FROM machine_reads WHERE id = ? AND device = ? AND status = 'done'
      AND expires_at > ? AND EXISTS (${active})
    RETURNING result
  `).bind(body.id, device, now, device).first();
  if (row) return reply(row);
  const pending = await db.prepare(`
    SELECT id FROM machine_reads WHERE id = ? AND device = ?
      AND expires_at > ? AND EXISTS (${active})
  `).bind(body.id, device, now, device).first();
  return pending ? reply({ pending: true }, 202) : reply({ error: "expired_or_unknown" }, 404);
}

const deviceRoutes = new Set(["/device/pair-code", "/device/status", "/device/next", "/device/result"]);
const pilotRoutes = new Set(["/pilot/pair", "/pilot/status", "/pilot/revoke", "/pilot/request", "/pilot/result"]);

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || (!deviceRoutes.has(path) && !pilotRoutes.has(path))) {
      return reply({ error: "not_found" }, 404);
    }
    const device = await hashToken(request);
    if (!device || (pilotRoutes.has(path) && !equal(device, env.CUQE_PILOT_HASH))) {
      return reply({ error: "unauthorized" }, 401);
    }
    if (!tokenPattern.test(env.CUQE_PILOT_HASH ?? "")) return reply({ error: "unavailable" }, 503);

    const db = env.DB;
    const now = Date.now();
    if (path === "/device/pair-code") {
      const payload = `Q1.${now + codeLifetimeMs}.${device}`;
      return reply({ code: payload + "." + await codeTag(payload, env.CUQE_PILOT_HASH) });
    }
    if (deviceRoutes.has(path)) {
      const paired = await db.prepare(active).bind(device).first();
      if (!paired) return reply({ error: "device_unpaired_or_revoked" }, 403);
      if (path === "/device/status") return reply({ paired: true });
      const body = path === "/device/result" ? await request.json().catch(() => null) : {};
      return body ? read(db, path, device, body, now) : reply({ error: "invalid_request" }, 400);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body.owner !== "string" || !body.owner || body.owner.length > 200) {
      return reply({ error: "invalid_request" }, 400);
    }
    if (path === "/pilot/pair") return redeem(db, body.code, body.owner, now, env.CUQE_PILOT_HASH);
    const mac = await db.prepare("SELECT device FROM paired_macs WHERE owner = ? AND revoked_at IS NULL")
      .bind(body.owner).first();
    if (path === "/pilot/status") return reply({ paired: Boolean(mac) });
    if (!mac) return reply({ error: "no_paired_mac" }, 404);
    if (path === "/pilot/revoke") {
      await db.batch([
        db.prepare("UPDATE paired_macs SET revoked_at = ? WHERE owner = ? AND device = ? AND revoked_at IS NULL")
          .bind(now, body.owner, mac.device),
        db.prepare("DELETE FROM machine_reads WHERE device = ?").bind(mac.device),
      ]);
      return reply({ revoked: true });
    }
    return read(db, path, mac.device, body, now);
  },
};
