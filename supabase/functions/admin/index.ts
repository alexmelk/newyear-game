// admin: модерация таблицы рекордов.
// Доступ по паролю (заголовок x-admin-pass == env ADMIN_PASSWORD).
// Действия (POST json {action, ...}):
//   list    — последние 60 записей (со скрытыми, флагами и жалобами)
//   replay  — {id} → полный реплей для просмотра
//   hide/show/delete — {id}
//   verify  — {id} → снять флаг suspicious и обнулить жалобы (проверка пройдена)
//   dev     — подтверждение пароля для меню разработчика в игре (client)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-pass",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PASS = Deno.env.get("ADMIN_PASSWORD") ?? "";

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
  if (!PASS) return json({ error: "ADMIN_PASSWORD not set" }, 500);
  if ((req.headers.get("x-admin-pass") || "") !== PASS) return json({ error: "wrong password" }, 401);

  try {
    const body = await req.json();
    const action = String(body.action || "");
    if (action === "dev") return json({ ok: true });   // пароль уже проверен выше
    const id = String(body.id || "");
    if (!/^[0-9a-fA-F-]{1,40}$/.test(id) && action !== "list") return json({ error: "bad id" }, 400);

    if (action === "list") {
      const r = await rest("scores?select=id,name,score,date,hidden,suspicious,replay_bytes,reports,client_id,created_at&order=created_at.desc&limit=60");
      return json(r.ok ? await r.json() : []);
    }
    if (action === "replay") {
      const r = await rest("scores?select=name,score,date,replay&id=eq." + id);
      const rows = r.ok ? await r.json() : [];
      return rows.length ? json(rows[0]) : json({ error: "not found" }, 404);
    }
    if (action === "hide" || action === "show") {
      const r = await rest("scores?id=eq." + id, {
        method: "PATCH", headers: { prefer: "return=minimal" },
        body: JSON.stringify({ hidden: action === "hide" }),
      });
      return json({ ok: r.ok });
    }
    if (action === "verify") {
      const r = await rest("scores?id=eq." + id, {
        method: "PATCH", headers: { prefer: "return=minimal" },
        body: JSON.stringify({ suspicious: false, reports: 0 }),
      });
      return json({ ok: r.ok });
    }
    if (action === "delete") {
      const r = await rest("scores?id=eq." + id, { method: "DELETE", headers: { prefer: "return=minimal" } });
      return json({ ok: r.ok });
    }
    return json({ error: "unknown action" }, 400);
  } catch {
    return json({ error: "invalid request" }, 400);
  }
});
