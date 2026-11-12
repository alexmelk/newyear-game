// Деплой Edge-функции в ваш Supabase-проект.
// Нужен Management API токен (Supabase → Profile → Access Tokens), НЕ git-токен.
// Запуск:  node scripts/deploy-function.js <sbp_токен> [slug]   (по умолчанию submit-score)
"use strict";
const fs = require("fs");
const path = require("path");

const REF = "txysdosoenhgzhjsmffm";               // ref вашего проекта Supabase
const SLUG = process.argv[3] || "submit-score";
const tok = process.argv[2];
if (!tok) { console.log("использование: node deploy-function.js <sbp_токен> [slug]"); process.exit(1); }

const code = fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", SLUG, "index.ts"), "utf8");
const fd = new FormData();
fd.append("name", SLUG);
fd.append("metadata", JSON.stringify({ entrypoint_path: "index.ts", imported_modules: {} }));
fd.append("file", new Blob([code], { type: "application/typescript" }), "index.ts");

fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${SLUG}`, {
  method: "POST",
  headers: { Authorization: "Bearer " + tok },   // Content-Type сам поставится с boundary
  body: fd,
}).then(async r => {
  console.log("deploy:", r.status);
  console.log((await r.text()).slice(0, 400));
}).catch(e => { console.log("ERR", e.message); process.exit(1); });
