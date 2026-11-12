// Мини-сервер для новогодней игры: раздаёт index.html и хранит общий рейтинг.
// Запуск: node server.js   →   http://localhost:8080
// Зависимостей нет — нужен только установленный Node.js.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const FILE = path.join(DIR, "scores.json");
const TOP = 20;

let scores = [];
try { scores = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { scores = []; }
if (!Array.isArray(scores)) scores = [];
const ipHits = new Map();

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(scores, null, 1)); } catch (e) { /* ignore */ }
}
function sortCut() {
  scores.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  scores = scores.slice(0, 50);
}
function json(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");

  // ---- API общего рейтинга ----
  if (u.pathname === "/api/scores") {
    if (req.method === "OPTIONS") return json(res, 200, {});
    if (req.method === "GET") return json(res, 200, scores.slice(0, TOP));
    if (req.method === "POST") {
      let body = "";
      req.on("data", c => { body += c; if (body.length > 10000) req.destroy(); });
      req.on("end", () => {
        let it;
        try { it = JSON.parse(body); } catch (e) { return json(res, 400, { error: "bad json" }); }

        // --- валидация как в Edge-функции Supabase ---
        const score = Math.floor(Number(it.score));
        const time = Number(it.time);
        if (!Number.isInteger(score) || score < 0 || score > 1000000) return json(res, 400, { error: "bad score" });
        if (!(Number.isFinite(time) && time >= 3 && time <= 86400)) return json(res, 400, { error: "bad time" });
        if (score > Math.min(60000, Math.floor(time) * 60 + 200)) return json(res, 400, { error: "impossible score" });

        // --- анти-спам: не больше 30 отправок в минуту с одного IP ---
        const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0];
        const now = Date.now();
        const arr = (ipHits.get(ip) || []).filter(t => now - t < 60000);
        if (arr.length >= 30) return json(res, 429, { error: "too many requests" });
        arr.push(now); ipHits.set(ip, arr);

        const name = String(it.name || "Аноним").replace(/[<>&"'\\]/g, "").trim().slice(0, 24) || "Аноним";
        scores.push({ name, score, date: new Date().toISOString().slice(0, 10) });
        sortCut(); save();
        json(res, 200, scores.slice(0, TOP));
      });
      return;
    }
    return json(res, 405, { error: "method" });
  }

  // ---- статика (сама игра) ----
  let p = u.pathname === "/" ? "/index.html" : u.pathname;
  const file = path.join(DIR, path.normalize(p).replace(/^([.][/\\])+/, "").replace(/^[./\\]+/, ""));
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404"); }
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
                    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(process.env.PORT || 8080, () => {
  console.log("🎄 Новогодняя игра доступна: http://localhost:8080");
});
