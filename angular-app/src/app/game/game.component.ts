import {
  Component, ElementRef, NgZone, OnInit, OnDestroy, AfterViewInit,
  ChangeDetectorRef, ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { GameEngine } from "../core/engine";
import { SupabaseService } from "../core/supabase.service";
import { BoardComponent } from "../board/board.component";
import { VERSION, SUPABASE_URL } from "../core/config";

/**
 * Экран игры: канвас + движок, меню, финал, реплеи, dev-панель (гейт паролем),
 * онлайн-рейтинг. Порт single-file версии v1.6.0 на Angular-компоненты.
 */
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, BoardComponent],
  selector: "app-game",
  template: `
  <div id="wrap">
    <canvas id="game" #cv></canvas>

    <!-- ================= МЕНЮ ================= -->
    <div id="menu" class="overlay" *ngIf="uiState === 'menu'">
      <h1>🎄 Новогодний бегун</h1>
      <p>Помоги Деду Морозу 🎅 собрать побольше подарков 🎁 и уворачиваться от снежков ❄!<br>
      Чем дольше играешь — тем быстрее всё летит. Не замерзни!</p>
      <button (click)="startGame()" [disabled]="starting">▶ Начать игру</button>
      <div class="bTitle">🏆 Таблица рекордов</div>
      <div class="board">
        <app-board [rows]="sb.board" [online]="sb.online" [myKey]="sb.myKey"
                   [error]="boardError" (open)="openReplay($event)"></app-board>
      </div>
      <div class="small">Управление: ← → / A D / мышь / палец · P — пауза<br>
      С 60-й секунды бывают 🌀 3D-зоны, а дальше по кругу — 🎯 зумба-зона:<br>
      кликай, чтобы стрелять шариками в цепочку — три одинаковых подряд лопаются!<br>
      ❤️ во всех зонах появляются сердечки здоровья — подбери или подстрели: +1 жизнь (до 5)!<br>
      Перед сменой зоны идёт 3-секундный отсчёт!<br>
      ▶ у топ-3 рекордов — можно посмотреть реплей игрока</div>
    </div>

    <!-- ================= ФИНАЛ / КОНЦЕВКА РЕПЛЕЯ ================= -->
    <div id="over" class="overlay" *ngIf="uiState === 'over'">
      <h1>❄️ Игра окончена</h1>
      <div class="score-line" *ngIf="lastOver">
        {{ lastOver.replay ? 'Очки в реплее: ' + lastOver.score : 'Счёт: ' + lastOver.score }}
      </div>
      <div class="record" *ngIf="lastOver"
           [style.color]="lastOver.replay ? (lastOver.okExact || lastOver.okNear ? '#9dffb0' : '#ff6b6b') : ''">
        <ng-container *ngIf="lastOver.replay; else recNormal">
          📼 {{ lastOver.name }} — записано {{ lastOver.target }}
        </ng-container>
        <ng-template #recNormal>
          {{ lastOver.isRec ? '🎉 Личный рекорд!' : '🏆 Ваш рекорд: ' + lastOver.prevHigh }}
        </ng-template>
      </div>
      <button (click)="engine?.REPLAYING ? exitReplay() : startGame()" [disabled]="starting">
        {{ engine?.REPLAYING ? '⬅ В меню' : (starting ? '⏳' : '▶ Играть снова') }}
      </button>

      <div id="saveArea" *ngIf="lastOver && !lastOver.replay && lastOver.score > 0">
        <input id="nameInput" maxlength="20" placeholder="Ваше имя" autocomplete="off"
               [(ngModel)]="nameInput" (keydown.enter)="save()">
        <button id="saveBtn" [disabled]="saveDisabled" (click)="save()">{{ saveBtnText }}</button>
      </div>

      <div class="bTitle">🏆 Таблица рекордов</div>
      <div class="board">
        <app-board [rows]="sb.board" [online]="sb.online" [myKey]="sb.myKey" (open)="openReplay($event)"></app-board>
      </div>
      <div class="note">{{ sb.boardNote() }}</div>
      <div class="small" *ngIf="lastOver">
        <ng-container *ngIf="lastOver.replay; else statsNormal">
          {{ lastOver.okExact ? '✓ Реплей воспроизвёл результат один-в-один'
            : lastOver.okNear ? '✓ Результат сошёлся в пределах погрешности записи'
            : '⚠ Расхождение: реплей не воспроизводит очки — возможен чит' }}
        </ng-container>
        <ng-template #statsNormal>
          Подарков собрано: {{ lastOver.giftsGot }} · Время: {{ lastOver.time }} с
        </ng-template>
      </div>
    </div>

    <!-- ================= КНОПКИ/ТАГІ ================= -->
    <button id="sndBtn" class="mini" *ngIf="uiState !== 'menu'" (click)="toggleMusic()">
      {{ engine && engine.musicOn ? '🔊 Музыка' : '🔇 Музыка' }}
    </button>
    <button id="trkBtn" class="mini" *ngIf="mp3On && trackIdx >= 0" (click)="nextTrack()">🎵 {{ tracks[trackIdx].t }} ⏭</button>
    <div id="verTag">v{{ version }}</div>
    <button id="exitRep" class="mini" *ngIf="engine?.REPLAYING" (click)="exitReplay()">✕ Выйти из реплея</button>
    <button id="repCheat" class="mini" *ngIf="engine?.REPLAYING && replayId"
            [disabled]="cheatDisabled" (click)="reportCheat()">{{ cheatText }}</button>

    <!-- ================= DEV-ПАНЕЛЬ (F2, пароль администратора) ================= -->
    <div id="dev" *ngIf="engine && engine.debug.on">
      <div id="devHead">🛠 Режим разработчика (F2) <button (click)="engine?.setDebug(false)">✕</button></div>
      <div class="devBtns">
        <button [class.on]="engine.debug.inv" (click)="engine.debugToggle('inv')">🛡 неуязв. (I)</button>
        <button [class.on]="engine.debug.inflives" (click)="engine.debugToggle('inflives')">∞ жизни</button>
        <button [class.on]="engine.debug.slow" (click)="engine.debugToggle('slow')">🐢 слоу-мо (K)</button>
        <button [class.on]="engine.debug.boxes" (click)="engine.debugToggle('boxes')">☐ хитбоксы (H)</button>
        <button [class.on]="engine.debug.force3d !== 'auto'" (click)="engine.cycleForce3d()">🎮 зона: {{ engine.debug.force3d === 'on' ? '3D' : engine.debug.force3d === 'off' ? '2D' : engine.debug.force3d }} (T)</button>
        <button (click)="engine.devJump()">⏩ +30с (J)</button>
        <button (click)="engine.devSpawnGift()">🎁 спавн (G)</button>
        <button (click)="engine.devSpawnSnow()">❄ спавн (N)</button>
        <button (click)="engine.devClearSnow()">🧹 снежки (X)</button>
        <button (click)="engine.devSpawnHeart()">❤ сердечко</button>
        <button (click)="devTestBoard()">📡 борд</button>
      </div>
      <div id="devInfo">{{ devInfo }}</div>
      <div id="devLog">{{ devLog }}</div>
    </div>

    <div id="errBar" *ngIf="err" [style.display]="'block'">⚠ {{ err }}</div>
  </div>
  `,
})
export class GameComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild("cv", { static: true }) cvRef!: ElementRef<HTMLCanvasElement>;

  engine: GameEngine | null = null;
  version = VERSION;

  uiState = "menu";                      // menu | play | over
  starting = false;
  lastOver: any = null;
  boardError = "";
  replayId = "";

  nameInput = "";
  saveDisabled = false;
  saveBtnText = "💾 В таблицу";

  cheatDisabled = false;
  cheatText = "🚨 Читер!";

  err = "";
  private errTimer: any = null;
  devInfo = "";
  devLog = "";
  private devTimer: any = null;

  constructor(public sb: SupabaseService, private zone: NgZone, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    // вход в просмотр реплея по ссылке ?replay=<id>
    const q = new URLSearchParams(location.search).get("replay");
    if (!q) this.sb.loadBoard();
  }

  ngAfterViewInit() {
    // Движок живёт ВНЕ зоны Angular: rAF-цикл 60fps не должен запускать CD.
    // В зону возвращаемся через hooks (там markForCheck).
    this.zone.runOutsideAngular(() => {
      this.engine = new GameEngine(this.cvRef.nativeElement, {
        onState: (s) => this.zone.run(() => {
          this.uiState = s as any;
          if (s === "menu") this.sb.loadBoard().then(() => this.cdr.markForCheck());
          this.cdr.markForCheck();
        }),
        onGameOver: (d) => this.zone.run(() => this.handleGameOver(d)),
        onMusic: () => { this.syncMp3Volume(); this.cdr.markForCheck(); },
        onError: (m) => this.zone.run(() => this.showError(m)),
        onDevToggle: () => this.zone.run(() => this.toggleDev()),
        onDebugChange: () => this.cdr.markForCheck(),
      });
    });
    // ?debug=1 — как раньше, но всё равно требует пароль
    if (/(\?|&)debug=1/.test(location.search)) this.toggleDev();
    const q = new URLSearchParams(location.search).get("replay");
    if (q) this.loadReplay(q);
    this.devTimer = setInterval(() => {
      if (this.engine && this.engine.debug.on) {
        this.devInfo = this.engine.devStatusLine(this.sb.mode);
        this.devLog = this.engine.debug.log.join("\n");
      }
    }, 500);
    window.addEventListener("error", this.onWinErr);
    this.zone.runOutsideAngular(() => {           // MP3-фон стартует при первом жесте (политика автоплея)
      window.addEventListener("pointerdown", this.tryStartMp3);
      window.addEventListener("keydown", this.tryStartMp3);
    });
  }

  ngOnDestroy() {
    if (this.engine) this.engine.destroy();
    if (this.devTimer) clearInterval(this.devTimer);
    window.removeEventListener("error", this.onWinErr);
    window.removeEventListener("pointerdown", this.tryStartMp3);
    window.removeEventListener("keydown", this.tryStartMp3);
    if (this.mp3) { this.mp3.pause(); this.mp3.src = ""; }
  }
  private onWinErr = (e: ErrorEvent) => this.showError(e.message || "JS error");

  showError(msg: string) {
    this.err = String(msg).slice(0, 120);
    if (this.errTimer) clearTimeout(this.errTimer);
    this.errTimer = setTimeout(() => { this.err = ""; }, 8000);
  }

  handleGameOver(d: any) {
    this.uiState = "over";
    this.lastOver = d;
    if (!d.replay) {
      this.sb.savedThisRound = false;
      this.sb.myKey = "";
      this.nameInput = localStorage.getItem("xmasName") || "";
      this.saveDisabled = false;
      this.saveBtnText = "💾 В таблицу";
      this.sb.loadBoard().then(() => this.cdr.markForCheck());
    }
    this.cdr.markForCheck();
  }

  /* ---------- старт раунда ---------- */
  async startGame() {
    const e = this.engine;
    if (!e || this.starting) return;
    this.starting = true;
    try {
      // регистрируем раунд на сервере: id + seed. Без roundId submit-score отклонит результат.
      const round = await this.sb.startRound();
      if (e.debug.on) e.dlog(round ? "round ok, seed=" + round.seed : "round FAIL (сеть/http)");
      this.lastOver = null;
      e.startGame(round);
      this.uiState = "play";
      if (!round) this.showError("⚠️ Раунд не зарегистрирован (нет связи) — счёт в таблицу не попадёт");
    } catch (err: any) {
      this.showError((err && err.message) || String(err));
    } finally {
      this.starting = false;
    }
  }

  /* ---------- подача результата ---------- */
  async save() {
    const e = this.engine;
    if (!e || this.sb.savedThisRound || e.score <= 0) return;
    const rpStr = e.snapshotReplay();
    const time = Math.floor(e.time);
    const res = await this.sb.submitScore(this.nameInput, e.score, time, e.round, rpStr);
    if (res.ok) {
      this.sb.savedThisRound = true;
      if (res.viaRound) e.afterScoreAccepted();
      this.saveDisabled = true;
      this.saveBtnText = "✓ Сохранено";
      if (e.debug.on) e.dlog("board: score accepted");
    } else {
      if (e.debug.on) e.dlog("board REJECT " + (res.status || "?") + " " + (res.reason || ""));
      const REASONS: Record<string, string> = {
        "no-round": "нет раунда 😕", "no-replay": "нет реплея", "network": "нет связи 📡",
        "round expired": "долгая пауза 😴", "round already used": "уже сохранён",
        "unknown round": "нет раунда 😕", "time mismatch": "время", "seed mismatch": "seed",
        "score != replay events": "очки ≠ события", "replay not finished": "реплей",
        "bad inputs": "слишком долго", "bad events": "слишком долго",
        "impossible score": "аномалия", "too many requests": "часто", "db": "сервер",
        "bad replay size": "реплей", "bad dur": "время",
      };
      const why = REASONS[res.reason || ""] || (res.reason ? String(res.reason).slice(0, 20) : "Отклонено");
      this.saveBtnText = res.status === 429 ? "Позже попробуй ⏳" : "⛔ " + why;
      setTimeout(() => { this.saveBtnText = "💾 В таблицу"; }, 6000);
    }
    this.cdr.markForCheck();
  }

  /* ---------- музыка ---------- */
  toggleMusic() { if (this.engine) this.engine.setMusic(!this.engine.musicOn); }

  /* ---------- MP3-фон: случайный трек, переключение кнопкой ---------- */
  tracks = [
    { f: "assets/music/jingle-bells.mp3", t: "Jingle Bells — F. Sinatra" },
    { f: "assets/music/let-it-snow.mp3", t: "Let It Snow — F. Sinatra" },
    { f: "assets/music/perviy-sneg.mp3", t: "Первый снег пошёл" },
  ];
  mp3: HTMLAudioElement | null = null;
  mp3On = false;            // MP3 играет → синтеж-мелодия движка выключена (SFX остаются)
  trackIdx = -1;
  private mp3Started = false;

  tryStartMp3 = () => {
    if (this.mp3Started) return;
    if (!this.mp3) {
      const a = new Audio();
      a.preload = "auto"; a.volume = 0.85;
      a.addEventListener("ended", () => this.nextTrack());
      a.addEventListener("error", () => {          // файл недоступен — остаёмся на синтеж-музыке
        this.mp3Started = true; this.mp3On = false;
        this.engine?.setMp3Mode(false);
        window.removeEventListener("pointerdown", this.tryStartMp3);
        window.removeEventListener("keydown", this.tryStartMp3);
        this.cdr.markForCheck();
      });
      this.trackIdx = Math.floor(Math.random() * this.tracks.length);   // старт со случайного трека
      a.src = this.tracks[this.trackIdx].f;
      this.mp3 = a;
    }
    Promise.resolve(this.mp3.play()).then(() => {
      this.mp3Started = true; this.mp3On = true;
      this.engine?.setMp3Mode(true);
      this.syncMp3Volume();
      window.removeEventListener("pointerdown", this.tryStartMp3);
      window.removeEventListener("keydown", this.tryStartMp3);
      this.cdr.markForCheck();
    }).catch(() => { /* автоплей ещё нельзя — ждём следующего клика/клавиши */ });
  };

  nextTrack() {
    if (!this.mp3 || !this.mp3Started) return;
    this.trackIdx = (this.trackIdx + 1) % this.tracks.length;
    this.mp3.src = this.tracks[this.trackIdx].f;
    Promise.resolve(this.mp3.play()).catch(() => {});
    this.cdr.markForCheck();
  }

  syncMp3Volume() {
    if (this.mp3 && this.engine) this.mp3.volume = this.engine.musicOn ? 0.85 : 0;
  }

  /* ---------- реплеи ---------- */
  openReplay(id: number | string) {
    // SPA-навигация без перезагрузки: на iOS Safari присваивание location.href с query-параметром
    // от страницы "#/" иногда не перезагружает документ — реплей «не открывался».
    const s = "?replay=" + encodeURIComponent(id);
    try { history.pushState(null, "", s); } catch { location.href = s; return; }
    this.loadReplay(String(id));
  }

  async loadReplay(id: string) {
    this.boardError = "⏳ Загружаю реплей…";
    try {
      const row = await this.sb.fetchReplay(id);
      this.replayId = String(id);
      this.cheatText = "🚨 Читер!";
      this.cheatDisabled = false;
      this.engine!.enterReplay(row as any);
      this.uiState = "play";
      this.boardError = "";
    } catch {
      this.boardError = "Реплей не найден 😕";
      await this.sb.loadBoard();
      this.boardError = "";
      this.cdr.markForCheck();
    }
  }
  exitReplay() {
    this.replayId = "";
    if (location.search) { try { history.pushState(null, "", location.pathname + "#/"); } catch { /* ignore */ } }
    this.engine?.exitReplay();     // hook onState("menu") перезагрузит борд
  }
  async reportCheat() {
    if (!this.replayId || !this.sb.SB) return;
    this.cheatDisabled = true;
    this.cheatText = "…";
    try {
      const j = await this.sb.reportReplay(this.replayId);
      if (j) this.cheatText = j.reports != null ? "🚨 Учтено (" + j.reports + ")" : "🚨 Жалоба учтена";
      else { this.cheatDisabled = false; this.cheatText = "🚨 Читер!"; }
    } catch { this.cheatDisabled = false; this.cheatText = "🚨 Читер!"; }
    this.cdr.markForCheck();
  }

  /* ---------- dev: гейт паролем администратора ---------- */
  async toggleDev() {
    const e = this.engine;
    if (!e) return;
    if (!e.debug.on && !sessionStorage.getItem("xmasDevAuth")) {
      const p = window.prompt("🛠 Меню разработчика защищено.\nВведите пароль администратора:");
      if (p === null) return;
      let ok = false;
      try { ok = await this.sb.devCheck(p); }
      catch { window.alert("Нет связи с сервером — пароль не проверить 😕"); return; }
      if (!ok) { window.alert("Неверный пароль ❌"); return; }
      sessionStorage.setItem("xmasDevAuth", "1");
    }
    e.setDebug(!e.debug.on);
  }
  async devTestBoard() {
    const e = this.engine; if (!e) return;
    e.dlog("борд-тест...");
    try {
      let u: string | null = null, init: any = {};
      if (this.sb.SB) { u = SUPABASE_URL + "/rest/v1/scores?select=name,score&order=score.desc&limit=3"; init = { headers: this.sb.headers }; }
      else if (this.sb.ON_NET) u = "/api/scores";
      if (!u) { e.dlog("board mode = local (нет API)"); return; }
      const r = await fetch(u, init);
      const j = r.ok ? await r.json() : null;
      e.dlog("HTTP " + r.status + " mode=" + this.sb.mode +
        (j ? " top1=" + (j[0] ? j[0].name + ":" + j[0].score : "пусто") : ""));
    } catch (err: any) { e.dlog("ОШИБКА: " + err.message); }
  }
}
