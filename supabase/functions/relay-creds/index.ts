/**
 * Remined Relay credentials for authenticated launcher clients.
 *
 * Returns frps addr/port/token so the shared frps auth secret is never baked
 * into the public app binary or git history.
 *
 * Deploy (JWT on — Remined session required):
 *   supabase secrets set RELAY_FRPS_ADDR=... RELAY_FRPS_PORT=7000 RELAY_FRPS_TOKEN=...
 *   supabase functions deploy relay-creds --project-ref <ref>
 *
 * Secrets (Dashboard → Edge Functions → Secrets, or CLI above):
 *   RELAY_FRPS_ADDR   e.g. 194.35.112.123
 *   RELAY_FRPS_PORT   e.g. 7000
 *   RELAY_FRPS_TOKEN  frps auth.token
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const auth = req.headers.get("Authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anon) {
    return json({ error: "server misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: auth } },
  });
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return json({ error: "unauthorized" }, 401);
  }

  const serverAddr = (Deno.env.get("RELAY_FRPS_ADDR") ?? "").trim();
  const portRaw = (Deno.env.get("RELAY_FRPS_PORT") ?? "7000").trim();
  const token = (Deno.env.get("RELAY_FRPS_TOKEN") ?? "").trim();
  const serverPort = Number.parseInt(portRaw, 10);

  if (!serverAddr || !token || !Number.isFinite(serverPort) || serverPort <= 0) {
    return json({ error: "relay secrets not configured" }, 503);
  }

  // Hint only — frps itself uses a static token; clients should refresh on each
  // host/join so a future rotation does not require an app update.
  const ttlSec = 3600;

  return json({
    serverAddr,
    serverPort,
    token,
    ttlSec,
  });
});
