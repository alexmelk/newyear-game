"use strict";
// Публикация собранного Angular-дистрибутива (и доп. файлов) на GitHub Pages.
// Использование:
//   node scripts/publish-dist.js <ghp_token> <distDir> [localPath[:repoPath] ...]
// Пример:
//   node scripts/publish-dist.js ghp_xxx angular-app/dist/angular-app/browser admin-redirect.html:admin.html
// Все файлы из distDir попадают в корень репозитория с сохранением относительных путей.
const fs = require("fs");
const path = require("path");

const TOK = process.argv[2];
const DIST = process.argv[3];
if (!TOK || !DIST) {
  console.log("usage: node publish-dist.js <github_token> <distDir> [local[:repo] ...]");
  process.exit(1);
}
const extras = process.argv.slice(4).map(a => {
  const [local, repo] = a.split(":");
  return { local, repo: repo || local };
});
const OWNER = "alexmelk", REPO = "newyear-game", BRANCH = "main";
const H = {
  Authorization: "Bearer " + TOK,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "newyear-game-publisher",
};
const root = path.join(__dirname, "..");
const encPath = p => p.split("/").map(encodeURIComponent).join("/");

async function gh(url, init = {}) {
  const r = await fetch("https://api.github.com" + url, { ...init, headers: H });
  const t = await r.text();
  return { status: r.status, json: (() => { try { return JSON.parse(t); } catch { return t; } })(), text: t };
}

function walk(dir, base = "") {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const rel = base ? base + "/" + name : name;
    if (fs.statSync(fp).isDirectory()) out.push(...walk(fp, rel));
    else out.push({ abs: fp, rel });
  }
  return out;
}

async function putFile(abs, repoPath, msg) {
  const content = fs.readFileSync(abs).toString("base64");
  const cur = await gh(`/repos/${OWNER}/${REPO}/contents/${encPath(repoPath)}?ref=${BRANCH}`);
  const sha = cur.status === 200 ? cur.json.sha : undefined;
  const put = await gh(`/repos/${OWNER}/${REPO}/contents/${encPath(repoPath)}`, {
    method: "PUT",
    body: JSON.stringify({ message: msg, content, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
  const ok = put.status === 200 || put.status === 201;
  console.log((ok ? "OK   " : "FAIL ") + repoPath + " -> http " + put.status +
    (ok ? " commit " + (put.json.commit && put.json.commit.sha.slice(0, 8)) : " " + put.text.slice(0, 250)));
  if (!ok) process.exit(1);
}

(async () => {
  const distAbs = path.isAbsolute(DIST) ? DIST : path.join(root, DIST);
  if (!fs.existsSync(distAbs)) { console.log("нет dist-папки:", distAbs); process.exit(1); }
  const files = walk(distAbs);
  console.log("файлов в dist: " + files.length);
  for (const f of files) await putFile(f.abs, f.rel, "angular build: " + f.rel);
  for (const e of extras) {
    const lp = path.isAbsolute(e.local) ? e.local : path.join(root, e.local);
    if (!fs.existsSync(lp)) { console.log("skip extra (нет файла):", e.local); continue; }
    await putFile(lp, e.repo, "angular build: " + e.repo);
  }
  console.log("Готово. Pages обновится ~за минуту:");
  console.log("  https://" + OWNER + ".github.io/" + REPO + "/  и  /#/admin");
})().catch(e => { console.log("ERR", e); process.exit(1); });
