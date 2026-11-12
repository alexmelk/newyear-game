// submit-score v2: приём результата ТОЛЬКО для зарегистрированного раунда.
// Проверки: раунд существует, не использован, не просрочен; replay привязан
// к серверному seed; сумма событий == score; hits == 3; время реплея ==
// реальному времени с момента старта; плюс прежние потолки и анти-спам.
// Replay хранится в таблице и доступен для просмотра (топ) и модерации.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

function cleanName(raw: unknown): string {
  let s = String(raw ?? "");
  s = s.replace(/[<>"'`{}\\|@#$%^&*()\[\]=+;:~?\/]/g, "");
  s = s.replace(/[\u0000-\u0020]+/g, " ").trim().slice(0, 24);
  return s.length > 0 ? s : "Аноним";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const name = cleanName(body.name);
    const score = Math.floor(Number(body.score));
    const time = Number(body.time);
    const roundId = String(body.roundId ?? "");
    const replayStr = String(body.replay ?? "");
    const cidRaw = String(body.cid ?? "");
    const cid = /^[0-9a-zA-Z-]{10,40}$/.test(cidRaw) ? cidRaw : null;   // для зелёной точки «онлайн»

    if (!Number.isInteger(score) || score < 0 || score > 1000000) return json({ error: "bad score" }, 400);
    if (!Number.isFinite(time) || time < 3 || time > 86400) return json({ error: "bad time" }, 400);
    if (score > Math.min(60000, Math.floor(time) * 60 + 200)) return json({ error: "impossible score" }, 400);
    if (replayStr.length < 20 || replayStr.length > 150000) return json({ error: "bad replay size" }, 400);
    if (!/^[0-9a-f-]{36}$/i.test(roundId)) return json({ error: "bad roundId" }, 400);

    // --- раунд: существует, свежий, не использованный ---
    const rr = await rest("rounds?select=seed,started_at,used&id=eq." + roundId);
    if (!rr.ok) return json({ error: "db" }, 500);
    const rounds = await rr.json();
    if (!Array.isArray(rounds) || rounds.length === 0) return json({ error: "unknown round" }, 400);
    const round = rounds[0];
    if (round.used) return json({ error: "round already used" }, 400);

    // --- replay: parse + привязка к серверному seed + сверка событий ---
    let rp: any = null;
    try { rp = JSON.parse(replayStr); } catch { return json({ error: "replay not json" }, 400); }
    if (!rp || typeof rp !== "object") return json({ error: "bad replay" }, 400);
    if ((rp.seed >>> 0) !== (round.seed >>> 0)) return json({ error: "seed mismatch" }, 400);
    if (!Array.isArray(rp.ev) || rp.ev.length > 6000) return json({ error: "bad events" }, 400);
    if (!Array.isArray(rp.inputs) || rp.inputs.length > 6000) return json({ error: "bad inputs" }, 400);

    let sum = 0, hits = 0;
    let lastT = -1;
    for (const e of rp.ev) {
      const t = Number(e[0]);
      if (!(t >= 0) || t < lastT - 0.01) return json({ error: "events not sorted" }, 400);
      lastT = t;
      if (e[1] === "g") sum += 10;            // обычный подарок
      else if (e[1] === "b") sum += 50;       // бонус-звезда
      else if (e[1] === "h") hits++;          // попадание снежка
      else return json({ error: "bad event type" }, 400);
    }
    if (sum !== score) return json({ error: "score != replay events" }, 400);
    if (hits !== 3) return json({ error: "replay not finished" }, 400);

    // --- временное окно: сколько реально прошло с момента старта раунда ---
    const dur = Number(rp.dur);
    if (!Number.isFinite(dur) || dur < 3 || dur > 86400) return json({ error: "bad dur" }, 400);
    if (Math.abs(dur - time) > 2) return json({ error: "time mismatch" }, 400);
    const elapsed = (Date.now() - new Date(round.started_at).getTime()) / 1000;
    if (dur > elapsed + 10) return json({ error: "replay longer than real time" }, 400);
    if (elapsed > 900) return json({ error: "round expired" }, 400);

    // --- анти-спам: не больше 6 записей с одного имени за 10 минут ---
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recent = await rest("scores?select=id&name=eq." + encodeURIComponent(name) + "&created_at=gte." + since + "&limit=10");
    if (recent.ok) {
      const rows = await recent.json();
      if (Array.isArray(rows) && rows.length >= 6) return json({ error: "too many requests" }, 429);
    }

    const suspicious = score / Math.max(1, dur) > 35; // аномальная плотность очков -> на модерацию

    const ins = await rest("scores?columns=name,score,date,created_at,replay,replay_bytes,hidden,suspicious,round_id,client_id", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify([{
        name, score,
        date: new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
        replay: replayStr,
        replay_bytes: replayStr.length,
        hidden: false,
        suspicious,
        round_id: roundId,
        client_id: cid,
      }]),
    });
    if (!ins.ok) return json({ error: "insert failed", detail: (await ins.text()).slice(0, 200) }, 500);

    await rest("rounds?id=eq." + roundId, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ used: true }),
    });

    const top = await rest("scores?select=id,name,score,date,client_id&hidden=eq.false&order=score.desc&limit=20");
    return json(top.ok ? await top.json() : []);
  } catch {
    return json({ error: "invalid request" }, 400);
  }
});
