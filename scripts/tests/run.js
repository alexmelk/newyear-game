"use strict";
// Тесты движка (32 проверки). Перед запуском собрать engine.cjs из исходников:
//   cd angular-app && npx esbuild src/app/core/engine.ts --bundle --platform=node --format=cjs --outfile=../scripts/tests/engine.cjs
//   node scripts/tests/run.js
// ---- DOM-стабы ----
const grad = { addColorStop() {} };
function makeCtx() {
  return new Proxy({}, {
    get(t, k) { if (k in t) return t[k]; return (...a) => grad; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCv() {
  return { width: 0, height: 0, style: {},
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 800 }),
    addEventListener() {}, removeEventListener() {} };
}
global.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 480, innerHeight: 800, devicePixelRatio: 1 };
global.document = { addEventListener() {}, removeEventListener() {}, hidden: false, createElement: (t) => t === "canvas" ? makeCv() : { style: {} } };
global.localStorage = { getItem: () => null, setItem() {} };
// performance в Node 18 есть настоящий — не трогаем, иначе ломается fetch/undici
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = () => {};

const { GameEngine } = require("./engine.cjs");
let pass = 0, fail = 0;
const T = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (extra !== undefined ? "  [" + extra + "]" : "")); };

function mk(seed) {
  const e = new GameEngine(makeCv(), {});
  e.round = { seed, id: "test" };
  e.startGame(e.round);
  e.debug.on = true; e.debug.inflives = true;      // долгая симуляция без game over
  return e;
}
function drive(e, until, fn) {
  while (e.time < until && e.state === "play") { if (fn) fn(e.time, e); e.update(1 / 60); }
}

(async () => {
  // 1) расписание v2
  {
    const e = mk(12345); const seen = {};
    drive(e, 245, () => { const z = e.mode3d ? "3d" : e.zuma ? "zuma" : "2d"; (seen[z] = seen[z] || []).push(e.time); });
    T("v2: зумба появилась с 120с", !!seen.zuma && Math.min(...seen.zuma) >= 120, seen.zuma && Math.min(...seen.zuma).toFixed(1));
    T("v2: 3D-зона была до зумбы", !!seen["3d"], "ok");
    T("v2: после зумбы снова 2D", !!seen["2d"] && Math.max(...(seen["2d"] || [])) > 180, "ok");
  }
  // 2) зумба: цепочка живёт, укусы, выстрел пишется в рекорд
  {
    const e = mk(999); let maxChain = 0;
    drive(e, 185, () => { if (e.zc) maxChain = Math.max(maxChain, e.zc.chain.length); });
    T("зумба: цепочка породилась (>=14)", maxChain >= 14, maxChain);
    const e2 = mk(777); let bites = 0, fired = false;
    drive(e2, 190, (t) => {
      if (e2.zc && !fired && t > 125) { e2.zc.pending = -1.0; fired = true; }
      if (e2.zc && e2.zc.stall > 0.95) bites++;
    });
    T("зумба: выстрел попал в inputs", !!(e2.rec && e2.rec.inputs.some(v => typeof v[1] === "number" && v[1] <= -120 &&
      (v[1] >= -3200 || (v[1] <= -10000 && v[1] >= -16400)))));
    T("зумба: цепочка укусила деда", bites > 0, bites);
  }
  // 3) детерминизм v2 + ev-сумма == score
  {
    const act = (t, en) => { if (en.zc && Math.abs(t % 4 - 2) < 0.01) en.zc.pending = -(t % 2) - 0.3; };
    const a = mk(4242), b = mk(4242);
    drive(a, 175, act); drive(b, 175, act);   // конец внутри зумба-зоны
    T("v2 детерминизм score+lives+chain", a.score === b.score && a.lives === b.lives && !!(a.zc && b.zc) && a.zc.chain.length === b.zc.chain.length, a.score + " vs " + b.score + ", chain " + (a.zc && a.zc.chain.length) + " vs " + (b.zc && b.zc.chain.length));
    let sum = 0; for (const ev of a.rec.ev) sum += ev[1] === "b" ? 50 : ev[1] === "g" ? 10 : 0;
    T("v2 ev-сумма == score", sum === a.score, sum + " vs " + a.score);
  }
  // 4) v2 replay roundtrip
  {
    const a = mk(20001);
    drive(a, 200, (t, en) => { if (en.zc && Math.abs(t % 5 - 1) < 0.01) en.zc.pending = -0.8; });
    const rp = JSON.parse(a.snapshotReplay());
    const e = new GameEngine(makeCv(), {});
    e.enterReplay({ name: "t", score: a.score, replay: JSON.stringify(rp) });
    e.debug.on = true; e.debug.inflives = true;    // зеркалим mk(): сим без смертей, чистая сверка таймингов
    drive(e, rp.dur);   // ровно то же число шагов, что у live (на exact-grid шаг в шаг)
    T("v2+ replay: симV>=2 (актуальная версия записи)", e.simV >= 2, e.simV);
    T("v7 replay: ТОЧНОЕ совпадение очков", e.score === a.score, e.score + " vs " + a.score + " (simV=" + e.simV + ")");
  }
  // 5) живой старый реплей id=17 (v1) — совместимость
  {
    const fs = require("fs");
    const cfg = fs.readFileSync(__dirname + "/../../angular-app/src/app/core/config.ts", "utf8");
    const url = cfg.match(/SUPABASE_URL = "([^"]+)"/)[1];
    const key = (cfg.match(/SUPABASE_KEY =\s*\n?\s*"([^"]+)"/) || cfg.match(/SUPABASE_KEY = "([^"]+)"/))[1];
    const row = await (await fetch(url + "/rest/v1/scores?select=id,name,score,replay&id=eq.17", { headers: { apikey: key, Authorization: "Bearer " + key } })).json();
    if (!row || !row.length || !row[0].replay) T("v1 compat: нет id=17 (пропуск)", true);
    else {
      const data = JSON.parse(row[0].replay);
      T("v1 compat: запись v<=1", (data.v | 0) <= 1, data.v);
      const e = new GameEngine(makeCv(), {});
      e.scripted = { data, name: row[0].name, target: row[0].score, ptr: 0 };
      e.REPLAYING = true; e.round = null; e.reset();
      e.seed0 = data.seed >>> 0; e.rng = e.mulberry32(e.seed0); e.rec = null; e.state = "play";
      e.debug.on = true; e.debug.inflives = true;
      drive(e, data.dur + 1);
      const tol = Math.max(30, Math.floor(row[0].score * 0.08));
      T("v1 replay id=17: в допуске вьюера", Math.abs(e.score - row[0].score) <= tol, e.score + " vs target " + row[0].score);
      T("v1 replay: зумба НЕ включается", e.simV === 1 && !e.zuma);
    }
  }
  // 6) smoke отрисовки всех режимов на стабах
  {
    const e = mk(31337); let err = null;
    try {
      for (let i = 0; i < 60 * 135 && e.state === "play"; i++) { e.update(1 / 60); if (i % 900 === 0) e.draw(); }
      e.draw();
    } catch (x) { err = x.message; }
    T("draw() 2D/3D/зумба не падают", !err, err || "ok");
  }
  // 7) форс зоны из dev-меню: зумба сразу, без ожидания 120с
  {
    const e = mk(5150);
    e.debug.force3d = "zuma";
    let ok = false, err = null;
    try { drive(e, 5, () => { if (e.zuma && e.zc && e.zc.chain.length >= 14 && !e.mode3d) ok = true; }); } catch (x) { err = x.message; }
    T("dev: force зумба работает с 0с", ok, err || "ok");
    // цикл переключателя (стартуем с чистого auto)
    const d = e.debug; d.force3d = "auto"; let states = [];
    for (let i = 0; i < 4; i++) { e.cycleForce3d(); states.push(d.force3d); }
    T("dev: цикл зоны auto→on→off→zuma→auto", states.join(",") === "on,off,zuma,auto", states.join(","));
  }
  // 8) скорость цепочки по версиям симуляции: v2 (старые реплеи) быстрее всех, v3 средняя
  {
    const mkz = (ver) => {
      const e = mk(606); e.debug.force3d = "zuma"; e.simV = ver;
      e.zPath = ver >= 4 ? e.zPathSp : e.zPathS; e.zLen = ver >= 4 ? e.zLenSp : e.zLenS;
      return e;
    };
    const a = mkz(2), b = mkz(3);
    drive(a, 12); drive(b, 12);
    T("скорость: simV=2 цепочка быстрее simV=3", a.zc.chain[0].s > b.zc.chain[0].s + 40, a.zc.chain[0].s.toFixed(0) + " vs " + b.zc.chain[0].s.toFixed(0));
  }
  // 9) v4: спираль, дед в центре, без групп «3 подряд» в генерации, ещё медленнее, выход из зоны — дед на полу
  {
    const e = mk(707); e.debug.force3d = "zuma";
    drive(e, 6);
    const ch = e.zc.chain;
    let runs = true; for (let i = 2; i < ch.length; i++) if (ch[i].t === ch[i - 1].t && ch[i].t === ch[i - 2].t) runs = false;
    T("v4: стартовая цепочка без групп 3-подряд", runs, runs);
    T("v4: дед в центре спирали", e.player.x === 240 && e.player.y === 400, e.player.x + "," + e.player.y);
    T("v4: спираль selected (zLen=спираль)", e.zPath === e.zPathSp && e.zLen === e.zLenSp, e.zLen.toFixed(0));
    e.debug.force3d = "off"; drive(e, 10);
    T("v4: выход из зумбы — дед вернулся на пол", e.player.y === e.H - 110, e.player.y);
    const mkz = (ver) => {
      const x = mk(909); x.debug.force3d = "zuma"; x.simV = ver;
      x.zPath = ver >= 4 ? x.zPathSp : x.zPathS; x.zLen = ver >= 4 ? x.zLenSp : x.zLenS;
      return x;
    };
    const b3 = mkz(3), b4 = mkz(4);
    drive(b3, 0.2); const s30 = b3.zc.chain[0].s; drive(b3, 20); const d3 = b3.zc.chain[0].s - s30;
    drive(b4, 0.2); const s40 = b4.zc.chain[0].s; drive(b4, 20); const d4 = b4.zc.chain[0].s - s40;
    T("v4 цепочка медленнее v3", d4 > 0 && d4 < d3 - 40, d3.toFixed(0) + " vs " + d4.toFixed(0));
    const e5 = mk(5); e5.simV = 3; const r3old = e5.run3(); e5.simV = 4; const r3new = e5.run3();
    T("v4: 3D замедлен (run3)", r3new < r3old - 10, r3old.toFixed(0) + " -> " + r3new.toFixed(0));
  }
  // 10) v4: точный roundtrip реплея со знакомыми выстрелами (кодировка со знаком)
  {
    const a = mk(31000);
    drive(a, 150, (t, en) => {
      if (en.zc && Math.abs(t % 3 - 1) < 0.01) en.zc.pending = (t % 6) < 3 ? 1 : -2.5;   // в т.ч. положительный угол (вниз) — проверка знака
    });
    const rp = JSON.parse(a.snapshotReplay());
    const e = new GameEngine(makeCv(), {});
    e.enterReplay({ name: "t4", score: a.score, replay: JSON.stringify(rp) });
    e.debug.on = true; e.debug.inflives = true;    // зеркалим mk()
    drive(e, rp.dur);   // шаг в шаг
    T("v4+ replay: симV=7", e.simV === 7, e.simV);
    T("v4 replay: ТОЧНОЕ совпадение очков (v7 сетка шагов)", e.score === a.score, e.score + " vs " + a.score);
  }
  // 11) v6: сердечки здоровья во всех зонах
  {
    // 2D: спавнит, подбирается
    const e = mk(8100); let spawned = false; const before = e.lives;
    drive(e, 60, () => {
      if (e.hearts.length && e.hearts[0].k === "2") { spawned = true; const h = e.hearts[0]; e.player.tx = h.x; e.player.x = h.x; }
    });
    T("v6: сердечко появился в 2D", spawned, spawned);
    T("v6: подбор сердечка = +1 жизнь", e.lives > before, before + " -> " + e.lives);
    T("v6: жизнь не больше 5", e.lives <= 5, e.lives);
    // 3D: в 3D-зоне летит по полосе
    const e3 = mk(8200); let in3d = false;
    drive(e3, 100, () => { if (e3.mode3d && e3.hearts.some(h => h.k === "3")) in3d = true; });
    T("v6: сердечко есть и в 3D-зоне", in3d, in3d);
    // зумба: снаряд сбивает сердечко у тропки
    const ez = mk(8300); ez.debug.force3d = "zuma"; const lv0 = ez.lives; let got = false;
    drive(ez, 60, () => {
      const h = ez.hearts.find(x => x.k === "z");
      if (h && ez.zc && ez.zc.loaded && ez.zc.tFire <= 0) ez.zc.pending = Math.atan2(h.y - ez.zShotY(), h.x - ez.player.x);
      if (ez.lives > lv0) got = true;
    });
    T("v6: в зумбе сердечко сбивается выстрелом", got, got);
    // v5 и старше — сердечек нет (совместимость реплеев)
    const e5 = mk(8400); e5.simV = 5; drive(e5, 40);
    T("v<=5: сердечки не спавнятся (реплеи целы)", e5.hearts.length === 0, e5.hearts.length);
    // smoke: отрисовка зон с сердечками не падает
    let derr = null;
    try { ed: { const eh = mk(8500); eh.debug.force3d = "zuma"; for (let i = 0; i < 60 * 30; i++) { eh.update(1 / 60); if (i % 600 === 0) eh.draw(); } } } catch (x) { derr = x.message; }
    T("draw(): сердечки в зонах не ломают рендер", !derr, derr || "ok");
  }
  console.log("\n== PASS:" + pass + " FAIL:" + fail + " ==");
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log("ERR", e); process.exitCode = 1; });
