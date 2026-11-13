"use strict";
// Живой тест submit-score: replay с 4 "h" (подобрал сердечки) — принимает ли ДЕПЛОЙНУТАЯ функция?
const fs = require("fs");
(async () => {
  const cfg = fs.readFileSync(__dirname + "/../../angular-app/src/app/core/config.ts", "utf8");
  const url = cfg.match(/SUPABASE_URL = "([^"]+)"/)[1];
  const key = (cfg.match(/SUPABASE_KEY =\s*\n?\s*"([^"]+)"/) || cfg.match(/SUPABASE_KEY = "([^"]+)"/))[1];
  const H = { headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" } };
  const nh = Number(process.argv[2] || 4);
  const rr = await (await fetch(url + "/functions/v1/start-round", { method: "POST", headers: H.headers, body: "{}" })).json();
  console.log("round:", JSON.stringify(rr).slice(0, 120));
  const ev = [];
  let t = 0.5, ng = 0;
  for (let i = 0; i < 8; i++) { ev.push([t, "g"]); t += 0.3; ng++; }
  const ev2 = [];
  let hi = 0;
  for (const e of ev) {
    ev2.push(e);
    if (hi < nh && e[0] > 1 + hi * 1.1) { ev2.push([e[0] + 0.05, "h"]); hi++; }
  }
  while (hi < nh) { ev2.push([4.5 + (hi++ - nh) * 0.1, "h"]); }
  ev2.sort((a, b) => a[0] - b[0]);
  const score = ng * 10;
  const replay = { seed: rr.seed, v: 6, dur: 5.0, inputs: [1, 2, 3, 0, -0.5, 0.5], ev: ev2 };
  const resp = await fetch(url + "/functions/v1/submit-score", {
    method: "POST", headers: H.headers,
    body: JSON.stringify({ name: "Тест", score, time: 5, roundId: rr.roundId, replay: JSON.stringify(replay), cid: "testcid-0000000000000000000000" }),
  });
  const body = await resp.text();
  console.log("hits=" + nh + " -> http " + resp.status + ": " + body.slice(0, 200));
})().catch(e => { console.log("ERR", e); process.exitCode = 1; });
