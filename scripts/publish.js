"use strict";
// Публикация файлов игры на GitHub Pages через Contents API.
// Использование: node scripts/publish.js <ghp_token> [files...]
// По умолчанию: index.html admin.html
const fs = require("fs");
const path = require("path");

const TOK = process.argv[2];
if (!TOK) { console.log("usage: node publish.js <github_token> [files...]"); process.exit(1); }
const files = process.argv.slice(3).length ? process.argv.slice(3) : ["index.html", "admin.html"];
const OWNER = "alexmelk", REPO = "newyear-game", BRANCH = "main";
const H = {
  Authorization: "Bearer " + TOK,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "newyear-game-publisher",
};
const root = path.join(__dirname, "..");

async function gh(url, init = {}) {
  const r = await fetch("https://api.github.com" + url, { ...init, headers: H });
  const t = await r.text();
  return { status: r.status, json: (() => { try { return JSON.parse(t); } catch { return t; } })(), text: t };
}

(async () => {
  for (const f of files) {
    const fp = path.join(root, f);
    if (!fs.existsSync(fp)) { console.log("skip (нет файла):", f); continue; }
    const content = fs.readFileSync(fp).toString("base64");
    const cur = await gh(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(f)}?ref=${BRANCH}`);
    const sha = cur.status === 200 ? cur.json.sha : undefined;
    const body = {
      message: "update " + f + " (replays + moderation)",
      content,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    };
    const put = await gh(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(f)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    const ok = put.status === 200 || put.status === 201;
    console.log(
      (ok ? "OK   " : "FAIL ") + f + " -> http " + put.status +
      (ok ? " commit " + (put.json.commit && put.json.commit.sha.slice(0, 8)) : " " + put.text.slice(0, 300))
    );
    if (!ok) process.exit(1);
  }
  console.log("Pages обычно обновляется в течение ~1 минуты:");
  console.log("  https://" + OWNER + ".github.io/" + REPO + "/  и  /admin.html");
})().catch(e => { console.log("ERR", e); process.exit(1); });
