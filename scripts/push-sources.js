"use strict";
// Кладёт исходники проекта в репозиторий одним коммитом (git trees API).
// Использование: node scripts/push-sources.js <ghp_token>
// Берутся: angular-app/ (без node_modules/dist/.angular), supabase/functions,
// scripts/*.js, SETUP-Supabase.md, server.js, admin-redirect.html.
const fs = require("fs");
const path = require("path");

const TOK = process.argv[2];
if (!TOK) { console.log("usage: node push-sources.js <github_token>"); process.exit(1); }
const OWNER = "alexmelk", REPO = "newyear-game", BRANCH = "main";
const H = {
  Authorization: "Bearer " + TOK,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "newyear-game-sources",
};
const root = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".angular", ".vscode"]);
const MAX_SIZE = 5 * 1024 * 1024;   // mp3-ассеты источника (ранее 900 КБ — из-за чего трэки пропускались)

async function gh(url, init = {}) {
  const r = await fetch("https://api.github.com" + url, { ...init, headers: H });
  const t = await r.text();
  return { status: r.status, json: (() => { try { return JSON.parse(t); } catch { return t; } })(), text: t };
}

function collect(relDir) {
  const dir = path.join(root, relDir);
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const fp = path.join(dir, name);
    const rel = relDir.split(path.sep).join("/") + "/" + name;
    if (fs.statSync(fp).isDirectory()) out.push(...collect(rel));
    else if (name !== "package-lock.json") out.push(rel); // lock большой и не нужен для сборки с совместимыми версиями
  }
  return out;
}

(async () => {
  const paths = [
    ...collect("angular-app"),
    ...collect(path.join("supabase", "functions")),
    "scripts/publish.js", "scripts/publish-dist.js", "scripts/deploy-function.js", "scripts/push-sources.js",
    "SETUP-Supabase.md", "server.js", "admin-redirect.html",
  ];
  const ref = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  if (ref.status !== 200) { console.log("ref FAIL", ref.text.slice(0, 200)); process.exit(1); }
  const parent = ref.json.object.sha;
  // base_tree ОБЯЗАТЕЛЕН: иначе новый tree заменит всё содержимое репо
  const parentCommit = await gh(`/repos/${OWNER}/${REPO}/git/commits/${parent}`);
  const baseTree = parentCommit.json.tree && parentCommit.json.tree.sha;
  if (!baseTree) { console.log("base_tree FAIL", parentCommit.text.slice(0, 200)); process.exit(1); }

  const tree = [];
  for (const rel of paths) {
    const fp = path.join(root, rel.split("/").join(path.sep));
    if (!fs.existsSync(fp)) { console.log("skip (нет файла):", rel); continue; }
    const buf = fs.readFileSync(fp);
    if (buf.length > MAX_SIZE) { console.log("skip (слишком большой):", rel); continue; }
    const bl = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: "POST", body: JSON.stringify({ content: buf.toString("base64"), encoding: "base64" }),
    });
    if (bl.status !== 201) { console.log("blob FAIL", rel, bl.text.slice(0, 150)); process.exit(1); }
    tree.push({ path: rel, mode: "100644", type: "blob", sha: bl.json.sha });
    process.stdout.write(".");
  }
  console.log("\nблобов: " + tree.length);

  const tr = await gh(`/repos/${OWNER}/${REPO}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree }) });
  if (tr.status !== 201) { console.log("tree FAIL", tr.text.slice(0, 300)); process.exit(1); }
  const cm = await gh(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: "sources: Angular app + edge functions + scripts (v2.0.1)", tree: tr.json.sha, parents: [parent] }),
  });
  if (cm.status !== 201) { console.log("commit FAIL", cm.text.slice(0, 300)); process.exit(1); }
  const rf = await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH", body: JSON.stringify({ sha: cm.json.sha }),
  });
  console.log(rf.status === 200 ? "OK commit " + cm.json.sha.slice(0, 8) : "ref FAIL " + rf.text.slice(0, 300));
})().catch(e => { console.log("ERR", e); process.exit(1); });
