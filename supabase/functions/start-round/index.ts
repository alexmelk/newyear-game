// start-round: выдаёт раунду id + серверный seed.
// Клиент обязан начать игру с этим seed (детерминированный спавн)
// и финишировать этим roundId — submit-score проверит привязку.
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
    // очистка протухших раундов (таблица не разрастается)
    rest("rounds?expires_at=lt." + new Date().toISOString(), { method: "DELETE" });

    const seed = Math.floor(Math.random() * 4294967296) >>> 0;
    const r = await rest("rounds?select=id", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify([{
        seed,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }]),
    });
    if (!r.ok) return json({ error: "db" }, 500);
    const rows = await r.json();
    return json({ roundId: rows[0].id, seed });
  } catch {
    return json({ error: "bad request" }, 400);
  }
});
