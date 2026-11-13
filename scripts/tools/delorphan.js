"use strict";
// Удаление осиротевших файлов из репо (GitHub Contents API)
const TOK = process.argv[2];
if (!TOK) { console.log("usage: node delorphan.js <github_token> <file...>"); process.exit(1); }
const OWNER = "alexmelk", REPO = "newyear-game", BRANCH = "main";
const H = { Authorization: "Bearer " + TOK, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cleanup" };
const targets = process.argv.slice(3);
(async () => {
  for (const p of targets) {
    const g = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(p)}?ref=${BRANCH}`, { headers: H });
    if (g.status === 404) { console.log("нет в репо (уже удалён):", p); continue; }
    const info = await g.json();
    const d = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(p)}`, {
      method: "DELETE",
      headers: H,
      body: JSON.stringify({ message: "chore: remove orphan " + p, sha: info.sha, branch: BRANCH }),
    });
    console.log(d.status === 200 ? "удалён: " + p : "ОШИБКА " + d.status + " " + (await d.text()).slice(0, 200));
  }
})().catch(e => { console.log("ERR", e); process.exitCode = 1; });
