/**
 * CustomSkinAPI for Remined — backs CustomSkinLoader with Supabase profiles + Storage.
 *
 * Deploy (JWT off — Minecraft clients send no auth header):
 *   supabase functions deploy csl --no-verify-jwt
 *
 * CSL root (must end with /):
 *   https://<PROJECT>.supabase.co/functions/v1/csl/
 *
 * Endpoints:
 *   GET /{USERNAME}.json  → { username, skin: "<remined_id>" }
 *   GET /textures/{id}    → 302 to public skins/{id}.png
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: cors });
}

/** Path after /functions/v1/csl/ */
function routePath(req: Request): string {
  const url = new URL(req.url);
  const marker = "/functions/v1/csl/";
  const idx = url.pathname.indexOf(marker);
  if (idx >= 0) {
    return decodeURIComponent(url.pathname.slice(idx + marker.length));
  }
  // Local/serve fallback
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("csl");
  if (i >= 0) return decodeURIComponent(parts.slice(i + 1).join("/"));
  return decodeURIComponent(parts[parts.length - 1] ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const path = routePath(req).replace(/^\/+/, "");

  // textures/{remined_id} — proxy PNG (CSL does not always follow redirects)
  const tex = /^textures\/([a-z0-9]{7})(?:\.png)?$/i.exec(path);
  if (tex) {
    const id = tex[1]!.toLowerCase();
    const { data, error } = await supabase.storage.from("skins").download(`${id}.png`);
    if (error || !data) return notFound();
    const bytes = new Uint8Array(await data.arrayBuffer());
    return new Response(bytes, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  // {USERNAME}.json
  const profileMatch = /^([^/]+)\.json$/i.exec(path);
  if (!profileMatch) return notFound();

  const rawName = profileMatch[1]!.trim();
  if (rawName.length < 3 || rawName.length > 16) return notFound();

  // Case-insensitive username match (profiles.username)
  const { data: rows, error } = await supabase
    .from("profiles")
    .select("nick, username, skin_path, skin_model")
    .ilike("username", rawName.replace(/[%_]/g, ""))
    .limit(5);

  if (error) {
    console.error("[csl]", error.message);
    return json({ error: error.message }, 500);
  }

  const row = (rows ?? []).find(
    (r) =>
      typeof r.username === "string" &&
      r.username.toLowerCase() === rawName.toLowerCase() &&
      typeof r.nick === "string" &&
      /^[a-z0-9]{7}$/i.test(r.nick) &&
      typeof r.skin_path === "string" &&
      r.skin_path.trim().length > 0,
  );

  if (!row) return notFound();

  const nick = (row.nick as string).toLowerCase();
  const username = (row.username as string).trim();
  // Only expose the chosen model so friends see slim vs wide correctly on LAN.
  const model = row.skin_model === "slim" ? "slim" : "default";

  // CustomSkinAPI: skins/textures.default = classic, .slim = Alex arms
  return json({
    username,
    skin: nick,
    skins: { [model]: nick },
    textures: { [model]: nick },
  });
});
