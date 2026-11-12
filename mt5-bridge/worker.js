/**
 * SMC Sniper Pro APA — MT5 heartbeat Worker
 *
 * Deploy as a NEW Cloudflare Worker. Do not replace the Deriv OAuth Worker.
 * Required bindings:
 *   Secret: MT5_BRIDGE_TOKEN
 *   KV namespace: MT5_HEARTBEATS
 *
 * Read-only API. No trading or broker-order endpoints exist here.
 */

const MAX_BODY_BYTES = 4096;
const HEARTBEAT_TTL_SECONDS = 7 * 24 * 60 * 60;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function validText(value, maxLength) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001F\u007F]/.test(value);
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
  return match ? match[1] : "";
}

async function terminalKey(company, server) {
  const bytes = new TextEncoder().encode(company + "\n" + server);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return "terminal:" + hex;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/mt5/heartbeat" && url.pathname !== "/mt5/status") {
      return json({ error: "Not found" }, 404);
    }

    if (request.method !== "POST" && !(request.method === "GET" && url.pathname === "/mt5/status")) {
      return json({ error: "Method not allowed" }, 405);
    }

    if (!env.MT5_BRIDGE_TOKEN || env.MT5_BRIDGE_TOKEN.length < 24 ||
        !env.MT5_HEARTBEATS) {
      return json({ error: "Bridge server is not configured" }, 503);
    }

    const supplied = bearerToken(request);
    if (!safeEqual(supplied, env.MT5_BRIDGE_TOKEN)) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (request.method === "GET") {
      const latest = await env.MT5_HEARTBEATS.get("latest", "json");
      if (!latest) return json({ status: "NO_HEARTBEAT_RECEIVED" }, 404);
      return json({ status: "OK", heartbeat: latest });
    }

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }

    let raw;
    try {
      raw = await request.text();
    } catch {
      return json({ error: "Could not read request body" }, 400);
    }
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (!body || body.service !== "SMC Sniper Pro APA" ||
        !validText(body.agentVersion, 20) ||
        typeof body.terminalConnected !== "boolean" ||
        typeof body.tradeAllowed !== "boolean" ||
        !validText(body.brokerCompany, 120) ||
        !validText(body.server, 120) ||
        !Number.isInteger(body.terminalBuild) ||
        body.terminalBuild < 1 || body.terminalBuild > 1000000) {
      return json({ error: "Invalid heartbeat fields" }, 400);
    }

    const receivedAt = new Date().toISOString();
    const heartbeat = {
      service: "SMC Sniper Pro APA",
      agentVersion: body.agentVersion,
      terminalConnected: body.terminalConnected,
      tradeAllowed: body.tradeAllowed,
      brokerCompany: body.brokerCompany,
      server: body.server,
      terminalBuild: body.terminalBuild,
      receivedAt
    };

    const key = await terminalKey(body.brokerCompany, body.server);
    await Promise.all([
      env.MT5_HEARTBEATS.put(key, JSON.stringify(heartbeat), {
        expirationTtl: HEARTBEAT_TTL_SECONDS
      }),
      env.MT5_HEARTBEATS.put("latest", JSON.stringify(heartbeat), {
        expirationTtl: HEARTBEAT_TTL_SECONDS
      })
    ]);

    return json({
      accepted: true,
      status: body.terminalConnected ? "CONNECTED" : "TERMINAL_DISCONNECTED",
      brokerCompany: heartbeat.brokerCompany,
      server: heartbeat.server,
      receivedAt
    }, 200);
  }
};
