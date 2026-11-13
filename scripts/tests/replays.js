"use strict";
// Симуляция реплеев из БД точно как вьюер (enterReplay): гонка до dur, сверка с target
// Запуск: node scripts/tests/replays.js  (engine.cjs рядом — см. build в run.js)
const fs = require("fs");
const path = require("path");
const grad = { addColorStop() {} };
function makeCtx() { return new Proxy({}, { get(t, k) { if (k in t) return t[k]; return (...a) => grad; }, set(t, k, v) { t[k] = v; return true; } }); }
function makeCv() { return { width: 0, height: 0, style: {}, getContext: () => makeCtx(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 800 }), addEventListener() {}, removeEventListener() {} }; }
global.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 480, innerHeight: 800, devicePixelRatio: 1 };
global.document = { addEventListener() {}, removeEventListener() {}, hidden: false, createElement: (t) => t === "canvas" ? makeCv() : { style: {} } };
global.localStorage = { getItem: () => null, setItem() {} };
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = () => {};
const { GameEngine } = require("./engine.cjs");

(async () => {
  const cfg = fs.readFileSync(path.join(__dirname, "../../angular-app/src/app/core/config.ts"), "utf8");
  const url = cfg.match(/SUPABASE_URL = "([^"]+)"/)[1];
  const key = (cfg.match(/SUPABASE_KEY =\s*\n?\s*"([^"]+)"/) || [])[1];
  const H = { headers: { apikey: key, Authorization: "Bearer " + key } };
  const rows = await (await fetch(url + "/rest/v1/scores?select=id,name,score,replay&order=id.desc&limit=6", H)).json();
  for (const x of rows) {
    if (!x.replay) { console.log("id=" + x.id, "без реплея"); continue; }
    const data = JSON.parse(x.replay);
    const e = new GameEngine(makeCv(), {});
    e.enterReplay({ name: x.name, score: x.score, replay: x.replay });
    let err = null;
    try { while (e.time < (data.dur || 0) + 1 && e.state === "play") { e.update(1 / 60); if (Math.round(e.time * 60) % 90 === 0) e.draw(); } } catch (x2) { err = x2.message + " @" + e.time.toFixed(1); }
    const tol = Math.max(30, Math.floor(x.score * 0.08));
    const ok = !err && Math.abs(e.score - x.score) <= tol;
    console.log(`id=${x.id} v=${data.v} target=${x.score} sim=${e.score} lives=${e.lives} dur=${(data.dur||0).toFixed(0)} ${err ? "КРАШ: " + err : ok ? "В ДОПУСКЕ ✓" : "РАСХОЖДЕНИЕ ✗ (tol=" + tol + ")"}`);
  }
})().catch(e => { console.log("ERR", e); process.exitCode = 1; });
