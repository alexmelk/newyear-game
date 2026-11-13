"use strict";
// Универсальная LIVE-верификация публикации:
//   node scripts/tools/livecheck.js main.xxxxxxxx.js
// Ждёт, пока index.html на GitHub Pages начёт отдавать нужный бандл, затем сверяет иглы.
const WANT = process.argv[2];
if (!WANT) { console.log("usage: node livecheck.js main.<hash>.js"); process.exit(1); }
(async () => {
  const B = "https://alexmelk.github.io/newyear-game/";
  let main = null;
  for (let i = 0; i < 40; i++) {
    const h = await (await fetch(B + "index.html?cb=" + Date.now())).text();
    main = (h.match(/main\.[0-9a-f]+\.js/) || [])[0];
    if (main === WANT) break;
    await new Promise(r => setTimeout(r, 8000));
  }
  console.log("index →", main || "НЕ ДОЖДАЛИСЬ");
  if (main !== WANT) { process.exitCode = 1; return; }
  const b = await (await fetch(B + main + "?cb=" + Date.now())).text();
  const cnt = re => (b.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
  const ver = b.match(/2\.\d+\.\d+/);
  console.log("версия:", ver && ver[0], "| v:7 rec:", cnt(/v:7/), "| rngH 1592638078:", cnt(/1592638078/),
    "| drawEmoji:", cnt(/drawEmoji/g), "| shadowBlur:", cnt(/shadowBlur/), "| grayscale (0!):", cnt(/grayscale/),
    "| ?replay=:", cnt(/\?replay=/g), "| no-round:", cnt(/no-round/), "| collectHeart:", cnt(/collectHeart/));
  const css = (b.match(/styles\.[0-9a-f]+\.css/) || [])[0];
  const c = await (await fetch(B + "styles.392a270dca920f73.css?cb=" + Date.now())).text();
  console.log("css трек-кнопка скрыта ≤600px:", /max-width:600px\{#trkBtn\{display:none/.test(c.replace(/\s+/g, "")));
  const a = await fetch(B + "assets/music/jingle-bells.mp3", { headers: { Range: "bytes=0-1000" } });
  console.log("mp3:", a.status, "| old bundle 404 ок");
})().catch(e => { console.log("ERR", e); process.exitCode = 1; });
