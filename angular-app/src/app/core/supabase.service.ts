import { Injectable } from "@angular/core";
import { SUPABASE_URL, SUPABASE_KEY } from "./config";

export interface ScoreRow {
  id?: number;
  name: string;
  score: number;
  date?: string;
  client_id?: string | null;
  replay?: string;
  hidden?: boolean;
  reports?: number;
  suspicious?: boolean;
  created_at?: string;
  replay_bytes?: number;
}

export interface SubmitResult { ok: boolean; status?: number; viaRound?: boolean; reason?: string; }

/**
 * Сетевой слой: Supabase (общий рейтинг, античит-подача, присутствие,
 * модерация). Точный порт логики single-file версии v1.6.0.
 */
@Injectable({ providedIn: "root" })
export class SupabaseService {
  readonly SB = !!(SUPABASE_URL && SUPABASE_KEY);
  readonly ON_NET = /^https?:$/.test(location.protocol);
  readonly headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json",
  };

  board: ScoreRow[] = [];
  online: Set<string> = new Set();
  mode = "local";            // supabase | server | local
  myKey = "";
  savedThisRound = false;
  cid = "";

  constructor() { this.cid = this.ensureCid(); }

  // «устройство»-id для индикации онлайн (зелёная точка у имени в таблице)
  private ensureCid(): string {
    let cid = "";
    try { cid = localStorage.getItem("xmasCid") || ""; } catch { /* iOS private mode — localStorage бросает */ }
    if (!/^[0-9a-zA-Z-]{10,40}$/.test(cid)) {
      const c: Crypto = (window as any).crypto;
      cid = ((typeof c !== "undefined" && c.randomUUID) ? c.randomUUID()
        : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12))
        .replace(/[^0-9a-zA-Z-]/g, "").slice(0, 40);
      try { localStorage.setItem("xmasCid", cid); } catch { /* приватный режим — живём без cid */ }
    }
    return cid;
  }
  pingOnline() {
    if (!this.SB) return;
    fetch(SUPABASE_URL + "/functions/v1/ping", {
      method: "POST", headers: this.headers, body: JSON.stringify({ cid: this.cid }),
    }).catch(() => {});
  }
  startPresence() {
    if (!this.SB) return;
    this.pingOnline();
    setInterval(() => this.pingOnline(), 25000);
    addEventListener("visibilitychange", () => { if (!document.hidden) this.pingOnline(); });
  }

  sanitizeName(raw: string): string {
    return (raw || "").replace(/[<>&"'\\]/g, "").trim().slice(0, 24) || "Аноним";
  }

  boardNote(): string {
    return this.mode === "supabase" ? "🌍 Общая таблица для всех игроков"
      : this.mode === "server" ? "🌍 Общая таблица для всех, кто играет с этого сервера"
      : "⚠ Локальная таблица. Для общей: включите Supabase или node server.js";
  }

  async loadBoard(): Promise<void> {
    if (this.SB) {
      try {
        const cutoff = encodeURIComponent(new Date(Date.now() - 70 * 1000).toISOString());
        const [r, pr] = await Promise.all([
          fetch(SUPABASE_URL + "/rest/v1/scores?select=id,name,score,date,client_id&hidden=eq.false&order=score.desc&limit=20", { headers: this.headers }),
          fetch(SUPABASE_URL + "/rest/v1/presence?select=client_id&seen_at=gte." + cutoff, { headers: this.headers }),
        ]);
        if (r.ok) {
          this.board = await r.json(); this.mode = "supabase";
          try { this.online = new Set(pr.ok ? (await pr.json()).map((x: any) => x.client_id) : []); }
          catch { this.online = new Set(); }
          return;
        }
      } catch { /* уйдём в fallback */ }
    }
    if (this.ON_NET) {
      try {
        const r = await fetch("/api/scores");
        if (r.ok) { this.board = await r.json(); this.mode = "server"; return; }
      } catch { /* уйдём в fallback */ }
    }
    this.mode = "local";
    try { this.board = JSON.parse(localStorage.getItem("xmasTop") || "[]"); } catch { this.board = []; }
  }

  private pushLocal(item: ScoreRow) {
    this.board.push(item);
    this.board.sort((a, b) => b.score - a.score);
    this.board = this.board.slice(0, 50);
    localStorage.setItem("xmasTop", JSON.stringify(this.board));
  }

  // регистрация раунда: id + seed для детерминированной симуляции (3 попытки — мобильная сеть капризна)
  async startRound(): Promise<any> {
    if (!this.SB) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(SUPABASE_URL + "/functions/v1/start-round",
          { method: "POST", headers: this.headers, body: "{}", signal: ctl.signal });
        clearTimeout(to);
        if (r.ok) { const j = await r.json(); if (j && j.roundId) return j; }
      } catch { /* retry */ }
      if (attempt < 2) await new Promise(res => setTimeout(res, 400 * (attempt + 1)));
    }
    return null;
  }

  /**
   * Подача результата — только через Edge-функцию submit-score: она сверяет
   * replay с серверным seed и суммой событий. Прямая запись анонимом закрыта (RLS).
   */
  async submitScore(rawName: string, score: number, time: number, round: any, rpStr: string | null): Promise<SubmitResult> {
    if (this.savedThisRound || score <= 0) return { ok: false };
    const name = this.sanitizeName(rawName);
    try { localStorage.setItem("xmasName", name); } catch { /* приватный режим iOS */ }
    const item: ScoreRow = { name, score, date: new Date().toISOString().slice(0, 10) };
    this.myKey = name + "|" + score;
    if (this.mode === "supabase") {
      // честная подача: без раунда/реплея НЕ делаем «фейковую» локальную запись —
      // иначе на iOS казалось, что «✓ Сохранено», а в таблице не появлялось
      if (!round) return { ok: false, status: 0, reason: "no-round" };
      if (!rpStr) return { ok: false, status: 0, reason: "no-replay" };
      try {
        const r = await fetch(SUPABASE_URL + "/functions/v1/submit-score", {
          method: "POST", headers: this.headers,
          body: JSON.stringify({ name, score, time, roundId: round.roundId, replay: rpStr, cid: this.cid }),
        });
        if (r.ok) {
          this.board = await r.json();
          this.online.add(this.cid);  // страница открыта и результат принят — я точно онлайн
          return { ok: true, viaRound: true };
        }
        let reason = "";
        try { reason = String(((await r.json()) || {}).error || ""); } catch { /* не json */ }
        return { ok: false, status: r.status, reason };
      } catch { return { ok: false, status: 0, reason: "network" }; }
    } else if (this.mode === "server") {
      try {
        const r = await fetch("/api/scores", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...item, time }),
        });
        if (r.ok) { this.board = await r.json(); return { ok: true }; }
        if (r.status === 400) return { ok: false, status: 400 };
      } catch { /* fallback ниже */ }
    }
    this.pushLocal(item);
    return { ok: true };
  }

  async fetchReplay(id: string): Promise<ScoreRow> {
    const r = await fetch(SUPABASE_URL + "/rest/v1/scores?select=name,score,replay&id=eq." + encodeURIComponent(id),
      { headers: this.headers });
    const rows: ScoreRow[] = r.ok ? await r.json() : [];
    if (!rows.length || !rows[0].replay) throw new Error("not found");
    return rows[0];
  }

  async reportReplay(id: string): Promise<any> {
    const r = await fetch(SUPABASE_URL + "/functions/v1/report-replay",
      { method: "POST", headers: this.headers, body: JSON.stringify({ id }) });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  }

  async devCheck(pass: string): Promise<boolean> {
    try {
      const r = await fetch(SUPABASE_URL + "/functions/v1/admin", {
        method: "POST", headers: { ...this.headers, "x-admin-pass": pass },
        body: JSON.stringify({ action: "dev" }),
      });
      return r.ok;
    } catch { throw new Error("network"); }
  }

  async admin(action: string, id: any, pass: string): Promise<any> {
    const r = await fetch(SUPABASE_URL + "/functions/v1/admin", {
      method: "POST", headers: { ...this.headers, "x-admin-pass": pass },
      body: JSON.stringify({ action, id }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.error) || "http " + r.status);
    return j;
  }
}
