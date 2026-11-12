// ping: heartbeat «игрок онлайн». Анонимы не имеют права писать в таблицы —
// heartbeat пишет только эта функция (service role) через upsert по client_id.
// Борд читает presence напрямую (RLS select для всех) и подсвечивает зелёной
// точкой записи, у которых cid виден в последних ~70 секундах.
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
    const cid = String(body.cid ?? "");
    if (!/^[0-9a-zA-Z-]{10,40}$/.test(cid)) return json({ error: "bad cid" }, 400);

    const up = await rest("presence", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ client_id: cid, seen_at: new Date().toISOString() }),
    });
    if (!up.ok) return json({ error: "db", detail: (await up.text()).slice(0, 200) }, 500);

    // ~2% вызовов чистят строки старше 3 суток — таблица не разрастается
    if (Math.random() < 0.02) {
      await rest("presence?seen_at=lt." + new Date(Date.now() - 3 * 864e5).toISOString(), {
        method: "DELETE", headers: { prefer: "return=minimal" },
      });
    }
    return json({ ok: true });
  } catch {
    return json({ error: "invalid request" }, 400);
  }
});
