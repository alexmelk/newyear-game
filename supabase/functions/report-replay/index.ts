// report-replay: жалоба «🚨 Читер!» на запись из просмотра реплея.
// У анонимов нет права UPDATE на scores — счётчик increment-ит только эта
// функция (service role). Число ориентировочное: гонка редка и не критична.
// POST {id} → {ok, reports}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const rest = (path: string, init: RequestInit = {}) =>
  fetch(SB_URL + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: "Bearer " + SB_KEY,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const id = String(body.id || "");
    if (!/^[0-9a-fA-F-]{1,40}$/.test(id)) return json({ error: "bad id" }, 400);
    const r = await rest("scores?select=reports&id=eq." + id);
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) return json({ error: "not found" }, 404);
    const n = (rows[0].reports || 0) + 1;
    const p = await rest("scores?id=eq." + id, {
      method: "PATCH", headers: { prefer: "return=minimal" },
      body: JSON.stringify({ reports: n }),
    });
    if (!p.ok) return json({ error: "update failed" }, 500);
    return json({ ok: true, reports: n });
  } catch {
    return json({ error: "invalid request" }, 400);
  }
});
