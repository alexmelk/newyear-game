"use strict";
// Честное сравнение ev vs sim с запасом на квантование 0.1с; разбивка по зонам и секундам
const fs = require("fs");
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
  const cfg = fs.readFileSync(__dirname + "/../../angular-app/src/app/core/config.ts", "utf8");
  const url = cfg.match(/SUPABASE_URL = "([^"]+)"/)[1];
  const key = (cfg.match(/SUPABASE_KEY =\s*\n?\s*"([^"]+)"/) || [])[1];
  const H = { headers: { apikey: key, Authorization: "Bearer " + key } };
  const row = (await (await fetch(url + "/rest/v1/scores?select=id,name,score,replay&order=id.desc&limit=1", H)).json())[0];
  const d = JSON.parse(row.replay), ev = d.ev;
  const expAt = (t) => ev.reduce((s, e) => s + (e[0] <= t ? (e[1] === "b" ? 50 : 10) : 0), 0);
  const e = new GameEngine(makeCv(), {});
  e.scripted = { data: d, name: row.name, target: row.score, ptr: 0 };
  e.REPLAYING = true; e.round = null; e.reset();
  e.seed0 = (d.seed || 0) >>> 0; e.rng = e.mulberry32(d.seed || 0); e.rec = null; e.state = "play";
  const segs = [[0, "2d"], [60, "3d"], [120, "zu"], [180, "2d"]];
  let si = 0, firstReal = -1, lastRow = -1;
  while (e.time < (d.dur || 0) + 1 && e.state === "play") {
    e.update(1 / 60);
    const t = Math.floor(e.time);
    // расхождение с запасом 0.25с: exp к моменту t, sim к моменту t (с учётом задержки записи)
    const exp = expAt(t - 0.15), sim = e.score;
    if (firstReal < 0 && sim < exp - 0.01) {
      // устойчивое? проверим на t+0.3 позже; фиксируем кандидата
      if (firstReal < 0) firstReal = t;
    }
    if (t % 30 === 0 && t !== lastRow && e.time < 200) { lastRow = t; }
    if (lastRow === t) {
      console.log(`t=${t} [${segs[si][1]}] sim=${sim} exp=${expAt(t)} Δ=${sim - expAt(t)} lives=${e.lives}`);
      if (e.time > t) lastRow = -1;
    }
    if (si + 1 < segs.length && e.time >= segs[si + 1][0]) { si++; console.log(`— сегмент ${segs[si][1]} — sim=${e.score} exp=${expAt(e.time)}`); }
  }
  console.log(`END sim=${e.score} exp=${expAt(e.time)} lives=${e.lives} t=${e.time.toFixed(1)} state=${e.state}`);
  console.log(`ИТОГО target=${row.score}`);
  console.log(`сердечки ev: ${ev.filter(x => x[1] === "h").map(x => x[0]).join(", ")}`);
})().catch(e => { console.log("ERR", e); process.exitCode = 1; });
