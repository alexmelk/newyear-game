"use strict";
const fs = require("fs");
const path = require("path");
(async () => {
  const cfg = fs.readFileSync(path.join(__dirname, "../../angular-app/src/app/core/config.ts"), "utf8");
  const url = cfg.match(/SUPABASE_URL = "([^"]+)"/)[1];
  const key = (cfg.match(/SUPABASE_KEY =\s*\r?\n?\s*"([^"]+)"/) || [])[1];
  const H = { headers: { apikey: key, Authorization: "Bearer " + key } };
  const r = await fetch(url + "/rest/v1/scores?select=id,name,score,date&order=id.desc&limit=15", H);
  console.log("http", r.status);
  for (const x of await r.json()) console.log(x.id, x.score, JSON.stringify(x.name), x.date);
})().catch(e => { console.log("ERR", e); process.exitCode = 1; });
