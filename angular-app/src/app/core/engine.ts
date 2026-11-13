// @ts-nocheck
/* ============================================================================
   Игровой движок — точный порт симуляции из single-file версии (v1.6.0).
   Детерминизм сохранён намеренно: те же константы, тот же порядок вызовов —
   старые реплеи обязаны воспроизводиться один-в-один (античит сверяет seed).
   DOM-оверлеи убраны: движок общается с Angular через hooks-колбэки.
   ========================================================================== */

export interface EngineHooks {
  onState?(state: string): void;                       // menu | play | over
  onGameOver?(data: any): void;                        // снимок финала (см. gameOver)
  onMusic?(on: boolean): void;                         // подпись кнопки 🔊
  onError?(msg: string): void;                         // плашка «⚠»
  onDevToggle?(): void;                                // F2: компонент делает гейт пароля
  onDebugChange?(on: boolean): void;
}

export class GameEngine {
  static W = 480;
  static H = 800;

  // ---- мир ----
  W = 480; H = 800;
  ctx: CanvasRenderingContext2D;
  scale = 1;
  EMOJI_FONT = "'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
  glowOk = true;   // ctx.shadowBlur вокруг эмодзи только на десктопе: в iOS Safari тени/фильтры превращают их в размытые блобы
  px = 1;          // device-пикселей на логический пиксель (scale×DPR) — для рендера эмодзи-спрайтов
  emojiCache = new Map<string, HTMLCanvasElement>();

  state = "menu";
  time = 0; score = 0; giftsGot = 0; lives = 3; shakeT = 0;
  hearts: any[] = []; rngH: any = null; nextHeartT = 0;   // v6: сердечки здоровья (отдельный rng-поток — старые реплеи не сдвигаются)
  player: any = null;
  gifts: any[] = []; snow: any[] = []; parts: any[] = []; pops: any[] = [];
  trees: any[] = []; flakes: any[] = []; tGift = 0; tSnow = 0;

  // ---- 3D ----
  mode3d = false; lane = 0; laneF = 0; prepT = 0; zoff = 0; trees3: any[] = [];
  LANE_W = 3; Z_PL = 2.6; Z_FAR = 100; FOC = 360; HOR = 800 * 0.40; KY = 990;

  // ---- зумба (3-я зона, расписание v2) ----
  zuma = false; wasZone = "2d"; simV = 4; zc: any = null;
  zPath: any[] = []; zLen = 0; zPathS: any[] = []; zLenS = 0; zPathSp: any[] = []; zLenSp = 0;
  zAim: any = { x: 240, y: 300 };
  static ZEMOJI: any = { g: "🎁", s: "❄️", t: "🎄", b: "⭐" };

  // ---- детерминизм / реплеи ----
  seed0 = (Math.random() * 4294967296) >>> 0;
  rng = this.mulberry32(this.seed0);
  round: any = null;            // {roundId, seed} от start-round
  REPLAYING = false;
  scripted: any = null;         // {data, name, target, ptr}
  rec: any = null;              // рекордер текущего раунда

  // ---- музыка ----
  ac: any = null; master: any = null; musicOn = true; loopStartT = 0; schedTimer: any = null;
  melodyOn = true; musicNodes: any[] = [];   // синтеж-мелодия выключается, когда играет MP3-фон
  BPM = 138; BEAT = 60 / 138;
  MELODY = [
    [0,1,64],[1,1,64],[2,2,64],[4,1,64],[5,1,64],[6,2,64],
    [8,1,64],[9,1,67],[10,1,60],[11,1,62],[12,4,64],
    [16,1,65],[17,1,65],[18,2,65],[20,1,65],[21,1,65],[22,2,65],[24,1,65],[25,1,64],[26,1,64],
    [27,2,64],[29,1,64],[30,1,62],[31,1,62],[32,1,64],[33,4,62],[37,2,60]
  ];
  LOOP_BEATS = 39;
  BASS = [48,43,48,43,48,43,41,48,43,41,48,43,48,43];

  // ---- dev ----
  debug = {
    on: false, inv: false, inflives: false, slow: false, boxes: false,
    force3d: "auto", fps: 0, log: [] as string[],   // auto | on (3D) | off (2D) | zuma — форс зоны в дев-режиме
  };
  devInfo = "";

  // ---- цикл ----
  FIXED = 1 / 60;
  last = performance.now(); acc = 0; steps = 0; rafId: any = null;
  keys: any = {};
  private disposed = false;

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target && (e.target as any).tagName === "INPUT") return;
    if (e.key === "Escape" && this.REPLAYING) { this.exitReplay(); return; }
    if (["ArrowLeft", "ArrowRight", "a", "d", "A", "D", " "].includes(e.key)) e.preventDefault();
    this.keys[e.key.toLowerCase()] = true;
    if (this.state === "play" && this.mode3d && !e.repeat && !this.REPLAYING) {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") this.changeLane(-1);
      if (k === "arrowright" || k === "d") this.changeLane(1);
    }
    if (e.key === "F2") { e.preventDefault(); if (this.hooks.onDevToggle) this.hooks.onDevToggle(); }
    const d = this.debug;
    if (d.on && this.state === "play" && !e.repeat) {
      const k2 = e.key.toLowerCase();
      if (k2 === "i") { d.inv = !d.inv; this.dlog("неуязвимость = " + d.inv); }
      if (k2 === "j") { this.time += 30; this.dlog("time → " + Math.floor(this.time) + "с"); }
      if (k2 === "k") { d.slow = !d.slow; this.dlog("слоу-мо = " + d.slow); }
      if (k2 === "h") { d.boxes = !d.boxes; }
      if (k2 === "t") this.cycleForce3d();
      if (k2 === "g") this.devSpawnGift();
      if (k2 === "n") this.devSpawnSnow();
      if (k2 === "x") { this.snow = []; this.dlog("снежки убраны"); }
    }
    if (e.key.toLowerCase() === "p") {
      if (this.state === "play") this.state = "pause";
      else if (this.state === "pause") this.state = "play";
    }
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.key.toLowerCase()] = false; };
  private onResize = () => this.resize();
  private onVisibility = () => { if (document.hidden && this.state === "play") this.state = "pause"; };
  pointerX(e: any) {
    const r = this.cv.getBoundingClientRect();
    return ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / this.scale;
  }
  pointerY(e: any) {
    const r = this.cv.getBoundingClientRect();
    return ((e.touches ? e.touches[0].clientY : e.clientY) - r.top) / this.scale;
  }
  pdX = 0;
  private onPointerDown = (e: any) => {
    this.pdX = this.pointerX(e);
    if (this.state === "play" && !this.REPLAYING) {
      if (this.zuma) { this.zAim = { x: this.pdX, y: this.pointerY(e) }; if (this.zc) this.zc.pending = this.zAimAng(); }
      else if (!this.mode3d) this.player.tx = this.pdX;
    }
  };
  private onPointerMove = (e: any) => {
    if (this.state !== "play" || this.REPLAYING) return;
    if (this.zuma) { this.zAim = { x: this.pointerX(e), y: this.pointerY(e) }; return; }
    if (!this.mode3d && (e.buttons || e.pointerType === "touch")) this.player.tx = this.pointerX(e);
  };
  private onPointerUp = (e: any) => {
    if (this.state !== "play" || !this.mode3d || this.REPLAYING) return;
    const x = this.pointerX(e), d = x - this.pdX;
    if (Math.abs(d) > 24) this.changeLane(d > 0 ? 1 : -1);
    else this.changeLane(x < this.W / 2 ? -1 : 1);
  };

  constructor(public cv: HTMLCanvasElement, public hooks: EngineHooks = {}) {
    this.ctx = cv.getContext("2d");
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const ua = (nav && nav.userAgent) || "";
    this.glowOk = !(/iP(hone|ad|od)/.test(ua) || (nav && (nav as any).platform === "MacIntel" && (nav as any).maxTouchPoints > 1));
    this.resize();
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("visibilitychange", this.onVisibility);
    cv.addEventListener("pointerdown", this.onPointerDown);
    cv.addEventListener("pointermove", this.onPointerMove);
    cv.addEventListener("pointerup", this.onPointerUp);
    this.makeBack();
    this.buildZPath();
    this.player = { x: this.W / 2, tx: this.W / 2, y: this.H - 110, r: 38, inv: 0 };
    const loop = (now: number) => { this.frame(now); if (!this.disposed) this.rafId = requestAnimationFrame(loop); };
    this.rafId = requestAnimationFrame(loop);
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.cv.removeEventListener("pointerdown", this.onPointerDown);
    this.cv.removeEventListener("pointermove", this.onPointerMove);
    this.cv.removeEventListener("pointerup", this.onPointerUp);
    if (this.schedTimer) clearInterval(this.schedTimer);
  }

  resize() {
    const ww = window.innerWidth, wh = window.innerHeight;
    this.scale = Math.min(ww / this.W, wh / this.H);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = Math.round(this.W * this.scale * dpr);
    this.cv.height = Math.round(this.H * this.scale * dpr);
    this.cv.style.width = (this.W * this.scale) + "px";
    this.cv.style.height = (this.H * this.scale) + "px";
    this.ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, 0, 0);
    this.px = this.scale * dpr;
  }

  /* ================= музыка ================= */
  midiF(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }
  tone(t: number, freq: number, dur: number, type: string, vol: number, det: number, collect?: any[]) {
    const ac = this.ac as any;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; if (det) o.detune.value = det;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
    if (collect) collect.push({ g, o, end: t + dur + 0.05 });
  }
  scheduleLoop(t0: number) {
    for (const [b, d, m] of this.MELODY as any[]) {
      const t = t0 + b * this.BEAT;
      this.tone(t, this.midiF(m), d * this.BEAT * 0.9, "triangle", 0.24, 0, this.musicNodes);
      this.tone(t, this.midiF(m + 12), d * this.BEAT * 0.9, "sine", 0.06, 6, this.musicNodes);
    }
    for (let i = 0; i < this.LOOP_BEATS; i += 2) {
      this.tone(t0 + i * this.BEAT, this.midiF(this.BASS[Math.floor(i / 4) % this.BASS.length] - 12), this.BEAT * 1.6, "sine", 0.16, 0, this.musicNodes);
    }
  }
  ensureMusic() {
    if (!this.ac || !this.musicOn) return;
    if (this.melodyOn) {
      const horizon = this.ac.currentTime + 5;
      while (this.loopStartT < horizon) { this.scheduleLoop(this.loopStartT); this.loopStartT += this.LOOP_BEATS * this.BEAT; }
    }
    const now = this.ac.currentTime;
    while (this.musicNodes.length && this.musicNodes[0].end < now) this.musicNodes.shift();
  }
  startMusic() {
    if (!this.ac) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      this.ac = new AC();
      this.master = this.ac.createGain(); this.master.gain.value = 0.6; this.master.connect(this.ac.destination);
      this.loopStartT = this.ac.currentTime + 0.1;
      this.schedTimer = setInterval(() => this.ensureMusic(), 1000);
    }
    if (this.ac.state === "suspended") this.ac.resume();
    this.ensureMusic();
  }
  sfx(freqs: number[], dur: number, type?: string, vol?: number) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    freqs.forEach((f, i) => this.tone(t + i * dur, f, dur * 1.5, type || "square", vol || 0.18, 0));
  }
  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.master) this.master.gain.value = on ? 0.6 : 0;
    if (this.hooks.onMusic) this.hooks.onMusic(on);
  }
  setMp3Mode(on: boolean) {
    // играет MP3-фон: синтеж-мелодия гаснет немедленно (заготовленные ноты обрываются), SFX остаются
    this.melodyOn = !on;
    if (on && this.ac) {
      const now = this.ac.currentTime;
      for (const n of this.musicNodes) { try { n.g.gain.cancelScheduledValues(now); n.g.gain.setTargetAtTime(0.0001, now, 0.04); n.o.stop(now + 0.2); } catch (e) { /* уже остановлен */ } }
      this.musicNodes = [];
    } else if (!on && this.ac) this.loopStartT = Math.max(this.loopStartT, this.ac.currentTime + 0.1);
  }

  /* ================= мир ================= */
  mulberry32(a: number) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  recT() { return Math.round(this.time * 10) / 10; }
  // v7: таймстемпы inputs = целый номер шага симуляции (сетка 1/60 с, она же у живого ранга
  // и у вьюера — both шагают update(1/60)). Квантование в 0.1 с (v≤6) сдвигало инпуты на
  // ±3 шага, а интервалы выстрелов могли улезть под кулдаун 0.3 — вьюер терял выстрелы,
  // в зумбе это каскадом ломало всю симуляцию. ev и dur остаются в секундах.
  recTs() { return this.simV >= 7 ? Math.max(0, this.steps - 1) : this.recT(); }
  recTsEvt() { return this.simV >= 7 ? this.steps : this.recT(); }   // события между шагами: применятся на следующем шаге
  vt() { return this.simV >= 7 ? this.steps - 1 : this.time; }
  diff() { return Math.min(3, 1 + this.time / 50); }
  fallSpeed() { return 240 * this.diff(); }

  makeBack() {
    this.trees = []; this.flakes = [];
    for (let i = 0; i < 9; i++) this.trees.push({ x: Math.random() * this.W, y: Math.random() * this.H, s: 0.5 + Math.random() * 0.7 });
    for (let i = 0; i < 70; i++) this.flakes.push({ x: Math.random() * this.W, y: Math.random() * this.H, r: 0.7 + Math.random() * 1.5, v: 25 + Math.random() * 55, p: Math.random() * 6.28 });
  }
  reset() {
    this.time = 0; this.steps = 0; this.score = 0; this.giftsGot = 0; this.lives = 3; this.shakeT = 0;
    this.player = { x: this.W / 2, tx: this.W / 2, y: this.H - 110, r: 38, inv: 0 };
    this.gifts = []; this.snow = []; this.parts = []; this.pops = [];
    this.tGift = 0.6; this.tSnow = 1.4;
    this.mode3d = this.zuma = false; this.wasZone = "2d"; this.zc = null;
    this.lane = this.laneF = 0; this.prepT = 0; this.zoff = 0;
    this.simV = this.REPLAYING && this.scripted ? Math.min(7, Math.max(1, this.scripted.data.v | 0) || 1) : 7;
    this.zPath = this.simV >= 4 ? this.zPathSp : this.zPathS;
    this.zLen = this.simV >= 4 ? this.zLenSp : this.zLenS;
    this.seed0 = (this.round ? this.round.seed : Math.random() * 4294967296) >>> 0;
    this.rng = this.mulberry32(this.seed0);
    this.rngH = this.mulberry32((this.seed0 ^ 0x5EEDBA7E) >>> 0);
    this.nextHeartT = 10 + this.rngH() * 10; this.hearts = [];
    if (!this.REPLAYING) this.rec = { v: 7, seed: this.seed0, dur: 0, inputs: [[0, Math.round(this.W / 2)]], ev: [], lastV: this.W / 2, lastT: 0 };
    this.makeBack();
  }

  spawnGift() {
    const rng = this.rng, W = this.W;
    const bonus = rng() < 0.07;
    this.gifts.push({ x: 30 + rng() * (W - 60), y: -40, r: 26, rot: rng() * 0.5 - 0.25,
      vy: this.fallSpeed() * (0.55 + rng() * 0.2), bonus, p: rng() * 6.28 });
  }
  spawnSnow() {
    const rng = this.rng, W = this.W;
    this.snow.push({ x: 25 + rng() * (W - 50), y: -30, r: 15 + rng() * 9,
      vy: this.fallSpeed() * (0.85 + rng() * 0.4), amp: 12 + 20 * rng() * this.diff(), p: rng() * 6.28, sp: 1.5 + rng() * 2 });
  }
  burst(x: number, y: number, colors: string[]) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, v = 60 + Math.random() * 220;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.6 + Math.random() * 0.4, c: colors[i % colors.length], r: 2 + Math.random() * 3 });
    }
  }

  /* ================= 3D ================= */
  proj(xRel: number, z: number) { return { X: this.W / 2 + xRel * this.FOC / z, Y: this.HOR + this.KY / z, s: this.FOC / z }; }
  fade(z: number) { return Math.max(0.05, Math.min(1, (this.Z_FAR - z) / 45)); }
  relX(o: any) { return (o.lane - this.laneF) * this.LANE_W + (o.ox || 0); }
  run3() { return this.simV >= 4 ? 30 + 8 * this.diff() : 42 + 12 * this.diff(); }   // v4 — 3D медленнее
  makeTrees3() {
    this.trees3 = [];
    for (let i = 0; i < 18; i++) this.trees3.push({ x: (Math.random() < .5 ? -1 : 1) * (5.4 + Math.random() * 5), z: Math.random() * this.Z_FAR, s: .7 + Math.random() * .9 });
  }
  spawn3dGift() { const rng = this.rng; this.gifts.push({ lane: (rng() * 3 | 0) - 1, ox: 0, z: this.Z_FAR, bonus: rng() < .08, seed: rng() * 6.28, r: 26 }); }
  spawn3dSnow() { const rng = this.rng; this.snow.push({ lane: (rng() * 3 | 0) - 1, ox: 0, z: this.Z_FAR, r: 20 + rng() * 10, seed: rng() * 6.28 }); }
  changeLane(d: number) {
    this.lane = Math.max(-1, Math.min(1, this.lane + d));
    if (this.rec && !this.REPLAYING && this.rec.inputs.length < 5900) this.rec.inputs.push([this.recTsEvt(), this.lane]);
  }

  update3d(dt: number) {
    if (this.REPLAYING && this.scripted) {
      const ins = this.scripted.data.inputs;
      while (this.scripted.ptr < ins.length - 1 && ins[this.scripted.ptr + 1][0] <= this.vt()) this.scripted.ptr++;
      const lv = ins[this.scripted.ptr][1];
      if (this.simV <= 1 || (lv >= -1 && lv <= 1)) this.lane = lv | 0;   // v2: не брать мусорные значения (выстрелы зумбы)
    }
    this.laneF += (this.lane - this.laneF) * Math.min(1, dt * 9);
    this.player.x = this.W / 2; this.player.tx = this.W / 2;
    this.zoff = (this.zoff + this.run3() * dt) % 6;
    const rng = this.rng;
    this.tGift -= dt; if (this.tGift <= 0 && this.prepT <= 0) { this.spawn3dGift(); this.tGift = Math.max(.5, 1.2 - this.time / 260); }
    this.tSnow -= dt; if (this.tSnow <= 0 && this.prepT <= 0) { if (this.snow.length < 8) this.spawn3dSnow(); if (this.diff() > 1.8 && rng() < .4 && this.snow.length < 8) this.spawn3dSnow(); this.tSnow = Math.max(.38, .95 - this.time / 380); }
    const v = this.run3() * dt;
    for (const t of this.trees3) { t.z -= v; if (t.z < 1.5) { t.z += this.Z_FAR; t.x = (Math.random() < .5 ? -1 : 1) * (5.4 + Math.random() * 5); t.s = .7 + Math.random() * .9; } }
    for (let i = this.gifts.length - 1; i >= 0; i--) {
      const g = this.gifts[i]; g.z -= v; g.ox = Math.sin(this.time * 2 + g.seed) * .35;
      if (g.z <= this.Z_PL && Math.abs(g.lane - this.laneF) < .55) {
        const p = this.proj(this.relX(g), this.Z_PL);
        const val = g.bonus ? 50 : 10; this.score += val; this.giftsGot++;
        if (this.rec && !this.REPLAYING && this.rec.ev.length < 5900) this.rec.ev.push([this.recT(), g.bonus ? "b" : "g"]);
        this.pops.push({ x: p.X, y: p.Y - 40, t: 0, txt: "+" + val, c: g.bonus ? "#ffd75e" : "#9dffb0" });
        this.burst(p.X, p.Y - 30, g.bonus ? ["#ffd75e", "#fff3b0", "#ffb347"] : ["#ff5d5d", "#ffd75e", "#7ec8ff"]);
        this.sfx(g.bonus ? [1046, 1318, 1568, 2093] : [880, 1318], .07, "square", .14);
        this.gifts.splice(i, 1); continue;
      }
      if (g.z < 1) this.gifts.splice(i, 1);
    }
    for (let i = this.snow.length - 1; i >= 0; i--) {
      const s = this.snow[i]; s.z -= v; s.ox = Math.sin(this.time * 3 + s.seed) * .5;
      if (s.z <= this.Z_PL && this.canHit() && Math.abs(s.lane - this.laneF) < .5) {
        this.snow.splice(i, 1);
        this.burst(this.W / 2, this.HOR + this.KY / this.Z_PL - 60, ["#ffffff", "#bfe4ff", "#7ec8ff"]);
        this.sfx([180, 120, 90], .09, "sawtooth", .2);
        this.takeHit();
        continue;
      }
      if (s.z < 1) this.snow.splice(i, 1);
    }
  }

  canHit() { return this.player.inv <= 0 && !(this.debug.on && this.debug.inv); }

  /* ---- сердечки здоровья (v6): бывают во всех зонах, дают +1 жизнь (до 5) ---- */
  updateHeartSpawns(dt: number) {
    if (this.prepT > 0 || this.time < this.nextHeartT) return;
    this.nextHeartT = this.time + 22 + this.rngH() * 14;
    if (this.hearts.length || this.lives >= 5) return;
    this.spawnHeart();
  }
  spawnHeart() {
    const r = this.rngH;
    if (this.zuma) {
      // сердечко ставится ВПЕРЕДИ головы цепочки (там тропка чиста) — дострелимо или соберётся сама, когда цепочка дойдёт
      const ch = this.zc ? this.zc.chain : null;
      const headS = ch && ch.length ? ch[0].s : 0;
      const hs = Math.min(this.zLen * 0.95, headS + 90 + r() * 160);
      const p = this.zPos(hs), q = this.zPos(Math.min(this.zLen, hs + 12));
      const dx = q.x - p.x, dy = q.y - p.y, L2 = Math.hypot(dx, dy) || 1, side = r() < .5 ? -1 : 1;
      this.hearts.push({ k: "z", x: p.x - dy / L2 * 30 * side, y: p.y + dx / L2 * 30 * side, ttl: 22, seed: r() * 6.28 });
    } else if (this.mode3d) {
      this.hearts.push({ k: "3", lane: (r() * 3 | 0) - 1, ox: 0, z: this.Z_FAR, seed: r() * 6.28 });
    } else {
      this.hearts.push({ k: "2", x: 40 + r() * (this.W - 80), y: -34, vy: 150 + 25 * this.diff(), p: r() * 6.28 });
    }
    if (this.debug.on) this.dlog("❤ сердечко появился");
  }
  updateHearts(dt: number) {
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      if (h.k === "2") {
        h.y += h.vy * dt; h.p += dt * 2; h.x += Math.sin(h.p) * 18 * dt;
        if (Math.hypot(h.x - this.player.x, h.y - (this.player.y - 30)) < 44 + this.player.r * .5) this.collectHeart(h, h.x, h.y - 16);
        else if (h.y > this.H + 40) this.hearts.splice(i, 1);
      } else if (h.k === "3") {
        h.z -= this.run3() * dt; h.ox = Math.sin(this.time * 2 + h.seed) * .35;
        if (h.z <= this.Z_PL && Math.abs(h.lane - this.laneF) < .55) {
          const p = this.proj(this.relX(h), this.Z_PL); this.collectHeart(h, p.X, p.Y - 60);
        } else if (h.z < 1) this.hearts.splice(i, 1);
      } else {
        h.ttl -= dt;
        let touch = false;
        if (this.zc) {
          for (const p of this.zc.projs) if (Math.hypot(p.x - h.x, p.y - h.y) < 32) { touch = true; break; }
          if (!touch) for (const b of this.zc.chain) {    // цепочка тоже смахивает сердечко — гарантированно собираемо
            if (b.s < 0) continue;
            const q = this.zPos(b.s);
            if (Math.hypot(q.x - h.x, q.y - h.y) < 30) { touch = true; break; }
          }
        }
        if (touch) this.collectHeart(h, h.x, h.y - 18);
        else if (h.ttl <= 0) this.hearts.splice(i, 1);
      }
    }
  }
  collectHeart(h: any, X: number, Y: number) {
    this.hearts.splice(this.hearts.indexOf(h), 1);
    this.lives = Math.min(5, this.lives + 1);
    this.pops.push({ x: X, y: Y, t: 0, txt: "+❤️", c: "#ff9db0" });
    this.burst(X, Y, ["#ff5d8a", "#ffd7e2", "#ff9db0"]);
    this.sfx([784, 988, 1175, 1568], 0.08, "sine", 0.16);   // очки НЕ начисляем — ev-инвариант рейтинга не трогаем
    if (this.debug.on) this.dlog("❤ +1 жизнь → " + this.lives);
  }
  devSpawnHeart() { if (this.simV >= 6) { this.spawnHeart(); this.dlog("❤ dev-спавн"); } }
  takeHit() {
    this.player.inv = 1.6; this.shakeT = 0.35;
    if (this.rec && !this.REPLAYING && this.rec.ev.length < 5900) this.rec.ev.push([this.recT(), "h"]);
    if (this.debug.on && this.debug.inflives) { this.dlog("hit! (∞ жизни)"); return; }
    this.lives--;
    if (this.debug.on) this.dlog("hit, lives=" + this.lives);
    if (this.lives <= 0) this.gameOver();
  }
  gameOver() {
    this.state = "over";
    if (this.debug.on) this.dlog("GAME OVER score=" + this.score + " (t=" + this.time.toFixed(0) + "с)");
    this.sfx([660, 550, 440, 330, 262], 0.16, "triangle", 0.2);
    if (this.REPLAYING) {
      const okExact = this.scripted && this.score === this.scripted.target;
      const okNear = this.scripted && Math.abs(this.score - this.scripted.target) <= Math.max(30, this.scripted.target * 0.08);
      if (this.hooks.onGameOver) this.hooks.onGameOver({
        replay: true, score: this.score,
        target: this.scripted ? this.scripted.target : 0,
        name: this.scripted ? this.scripted.name : "",
        okExact, okNear,
      });
      return;
    }
    const prevHigh = +(localStorage.getItem("xmasHigh") || 0);
    const isRec = this.score > prevHigh;
    if (isRec) localStorage.setItem("xmasHigh", String(this.score));
    if (this.hooks.onGameOver) this.hooks.onGameOver({
      replay: false, score: this.score, isRec, prevHigh,
      giftsGot: this.giftsGot, time: Math.floor(this.time),
    });
  }

  dlog(msg: string) {
    if (!this.debug.on) return;
    this.debug.log.push("[" + (typeof this.time === "number" ? this.time.toFixed(1) : "0") + "s] " + msg);
    if (this.debug.log.length > 12) this.debug.log.shift();
  }
  setDebug(on: boolean) {
    this.debug.on = !!on;
    if (this.debug.on) this.dlog("dev panel ON — F2 выключить");
    if (this.hooks.onDebugChange) this.hooks.onDebugChange(this.debug.on);
  }
  debugToggle(key: "inv" | "inflives" | "slow" | "boxes") {
    this.debug[key] = !this.debug[key];
    this.dlog(key + " = " + this.debug[key]);
  }
  cycleForce3d() {
    const d = this.debug;
    d.force3d = d.force3d === "auto" ? "on" : d.force3d === "on" ? "off" : d.force3d === "off" ? "zuma" : "auto";
    this.dlog("зона: " + d.force3d);
  }
  devJump() { this.time += 30; this.dlog("time → " + Math.floor(this.time) + "с"); }
  devSpawnGift() {
    if (this.zuma && this.zc) { this.zc.chain.push({ t: "g", s: 0, seed: 0 }); this.dlog("+шарик в цепочку"); return; }
    this.mode3d ? this.spawn3dGift() : this.spawnGift(); this.dlog("+подарок");
  }
  devSpawnSnow() {
    if (this.zuma && this.zc) { this.zc.chain.push({ t: this.zPick(), s: 0, seed: 0 }); this.dlog("+шарик в цепочку"); return; }
    this.mode3d ? this.spawn3dSnow() : this.spawnSnow(); this.dlog("+снежок");
  }
  devClearSnow() { this.snow = []; this.dlog("снежки убраны"); }
  // строка статуса для dev-панели (компонент обновляет её своим интервалом)
  devStatusLine(boardMode: string) {
    return "state:" + this.state + " | " + (this.mode3d ? "3D" : this.zuma ? "ZUMA" : "2D") + " | fps:" + this.debug.fps +
      " | board:" + boardMode + "\nt:" + this.time.toFixed(0) + "с diff:" + this.diff().toFixed(2) +
      " g:" + this.gifts.length + " s:" + this.snow.length + " p:" + this.parts.length;
  }

  /* ================= обновление ================= */
  update(dt: number) {
    const time = this.time, diff = this.diff();
    for (const f of this.flakes) {
      f.y += f.v * dt * (this.state === "play" ? diff * 0.6 + 0.4 : 0.5);
      f.x += Math.sin(time * 0.7 + f.p) * 12 * dt;
      if (f.y > this.H + 5) { f.y = -5; f.x = Math.random() * this.W; }
    }
    if (this.state !== "play") return;
    if (!this.zuma) for (const t of this.trees) {
      t.y += this.fallSpeed() * 0.22 * t.s * dt;
      if (t.y > this.H + 60) { t.y = -70; t.x = Math.random() * this.W; t.s = 0.5 + Math.random() * 0.7; }
    }

    this.time += dt; this.steps++;
    this.player.inv = Math.max(0, this.player.inv - dt);
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.prepT = Math.max(0, this.prepT - dt);

    // расписание зон: v1 (старые реплеи) — 2D/3D по 60с; v2 — цикл 2D→3D→зумба по 60с
    if (this.simV <= 1) { this.mode3d = this.time >= 60 && Math.floor(this.time / 60) % 2 === 1; this.zuma = false; }
    else { const blk = this.time >= 60 ? Math.floor(this.time / 60) % 3 : 0; this.mode3d = blk === 1; this.zuma = blk === 2; }
    if (this.debug.on && this.debug.force3d !== "auto" && !this.REPLAYING) {
      const fz = this.debug.force3d;   // принудительная зона из dev-меню: 2D / 3D / зумба
      this.mode3d = fz === "on"; this.zuma = fz === "zuma";
    }
    const zone = this.mode3d ? "3d" : this.zuma ? "zuma" : "2d";
    if (zone !== this.wasZone) {
      this.wasZone = zone; this.prepT = 3; this.gifts = []; this.snow = []; this.tGift = .5; this.tSnow = 1.2;
      this.zc = null; this.hearts = [];
      if (this.mode3d) this.makeTrees3();
      else { this.player.tx = this.W / 2; }
      if (this.zuma) this.zInit();
      else this.player.y = this.H - 110;   // вернуть деда на пол (после центра спирали v4)
    }

    if (this.mode3d) this.update3d(dt); else if (this.zuma) this.updateZuma(dt); else this.update2d(dt);
    if (this.simV >= 6) { this.updateHeartSpawns(dt); this.updateHearts(dt); }   // сердечки во всех зонах

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt;
      if (p.life <= 0) this.parts.splice(i, 1);
    }
    for (let i = this.pops.length - 1; i >= 0; i--) { this.pops[i].t += dt; this.pops[i].y -= 45 * dt; if (this.pops[i].t > 1) this.pops.splice(i, 1); }
  }

  update2d(dt: number) {
    const W = this.W, player = this.player;
    if (this.REPLAYING && this.scripted) {
      const ins = this.scripted.data.inputs;
      while (this.scripted.ptr < ins.length - 1 && ins[this.scripted.ptr + 1][0] <= this.vt()) this.scripted.ptr++;
      const tv = ins[this.scripted.ptr][1];
      if (this.simV <= 1 || (tv > 20 && tv < this.W + 20)) player.tx = tv;   // v2: игнорируем lane/выстрелы других зон
    } else {
      const kl = this.keys["arrowleft"] || this.keys["a"], kr = this.keys["arrowright"] || this.keys["d"];
      if (kl || kr) player.tx += ((kr ? 1 : 0) - (kl ? 1 : 0)) * 560 * this.diff() * dt;
    }
    player.tx = Math.max(40, Math.min(W - 40, player.tx));
    player.x += (player.tx - player.x) * Math.min(1, dt * 14);
    const rec = this.rec;
    if (rec && !this.REPLAYING && rec.inputs.length < 5900 && this.time - rec.lastT >= 0.05 &&
        (Math.abs(player.tx - rec.lastV) > 6 || this.time - rec.lastT > 4)) {
      rec.lastV = player.tx; rec.lastT = this.time;
      rec.inputs.push([this.recTs(), Math.round(player.tx)]);
    }

    const rng = this.rng;
    this.tGift -= dt; if (this.tGift <= 0 && this.prepT <= 0) { this.spawnGift(); this.tGift = Math.max(0.28, 0.8 - this.time / 150); }
    this.tSnow -= dt; if (this.tSnow <= 0 && this.prepT <= 0) { this.spawnSnow(); if (this.diff() > 1.8 && rng() < 0.35) this.spawnSnow(); this.tSnow = Math.max(0.16, 0.55 - this.time / 240); }

    for (let i = this.gifts.length - 1; i >= 0; i--) {
      const g = this.gifts[i]; g.y += g.vy * dt; g.p += dt * 2;
      g.x += Math.sin(g.p) * 20 * dt;
      const d = Math.hypot(g.x - player.x, g.y - player.y);
      if (d < g.r + player.r * 0.75) {
        const val = g.bonus ? 50 : 10;
        this.score += val; this.giftsGot++;
        if (this.rec && !this.REPLAYING && this.rec.ev.length < 5900) this.rec.ev.push([this.recT(), g.bonus ? "b" : "g"]);
        this.pops.push({ x: g.x, y: g.y, t: 0, txt: "+" + val, c: g.bonus ? "#ffd75e" : "#9dffb0" });
        this.burst(g.x, g.y, g.bonus ? ["#ffd75e", "#fff3b0", "#ffb347"] : ["#ff5d5d", "#ffd75e", "#7ec8ff"]);
        this.sfx(g.bonus ? [1046, 1318, 1568, 2093] : [880, 1318], 0.07, "square", 0.14);
        this.gifts.splice(i, 1); continue;
      }
      if (g.y > this.H + 50) this.gifts.splice(i, 1);
    }
    for (let i = this.snow.length - 1; i >= 0; i--) {
      const s = this.snow[i]; s.y += s.vy * dt; s.p += dt * s.sp;
      const d = Math.hypot(s.x + Math.sin(s.p) * s.amp - player.x, s.y - player.y);
      if (this.canHit() && d < s.r + player.r * 0.62) {
        this.snow.splice(i, 1);
        this.burst(player.x, player.y - 10, ["#ffffff", "#bfe4ff", "#7ec8ff"]);
        this.sfx([180, 120, 90], 0.09, "sawtooth", 0.2);
        this.takeHit();
        continue;
      }
      if (s.y > this.H + 40) this.snow.splice(i, 1);
    }
  }

  /* ================= зумба (3-я зона) ================= */
  buildZPath() {
    // --- тропка v2/v3: S-изгибы сверху вниз ---
    const pts = [[240, -40], [70, 90], [420, 150], [430, 300], [150, 330], [60, 480], [300, 520], [430, 640], [240, 655]];
    const cat = (p0: any, p1: any, p2: any, p3: any, t: number) => {
      const t2 = t * t, t3 = t2 * t;
      return [
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)];
    };
    const P = [pts[0], ...pts, pts[pts.length - 1]];
    const lut: any[] = []; let len = 0, prev = P[1].slice();
    for (let i = 1; i < P.length - 2; i++) {
      for (let j = 0; j <= 8; j++) {
        const q = cat(P[i - 1], P[i], P[i + 1], P[i + 2], j / 8);
        len += Math.hypot(q[0] - prev[0], q[1] - prev[1]); lut.push({ x: q[0], y: q[1], d: len }); prev = q;
      }
    }
    this.zPathS = lut; this.zLenS = len;
    // --- тропка v4+: спираль ~3 витков с краю к центру, конец — точно у деда ---
    const cx = this.W / 2, cy = this.H / 2, thEnd = 2 * Math.PI * 3, r0 = 245, r1 = 34;
    const raw: any[] = [];
    for (let i = 0; i <= 540; i++) {
      const th = (i / 540) * thEnd, r = r1 + (r0 - r1) * (1 - th / thEnd);
      raw.push({ x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) });
    }
    raw.push({ x: cx, y: cy });   // финальная точка — центр, где стоит Дед Мороз
    const sp: any[] = []; let len2 = 0; let p2 = raw[0];
    for (const q of raw) { len2 += Math.hypot(q.x - p2.x, q.y - p2.y); sp.push({ x: q.x, y: q.y, d: len2 }); p2 = q; }
    this.zPathSp = sp; this.zLenSp = len2;
    this.zPath = this.zPathS; this.zLen = this.zLenS;   // reset() выберет по simV
  }
  zPos(s: number) {
    const lut = this.zPath; if (!lut.length) return { x: this.W / 2, y: -40 };
    s = Math.max(0, Math.min(this.zLen, s));
    let lo = 0, hi = lut.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (lut[mid].d < s) lo = mid + 1; else hi = mid; }
    const b = lut[lo], a = lut[Math.max(0, lo - 1)], seg = (b.d - a.d) || 1, t = (s - a.d) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  zPick() { const r = this.rng(); return r < 0.34 ? "g" : r < 0.64 ? "s" : r < 0.85 ? "t" : "b"; }
  zNewType(ch: any[]) {
    let t = this.zPick();
    // v4+: цепочка не рождается с готовой группой «3 одинаковых подряд» — иначе они выглядят «схлопывающимися сами»
    if (this.simV >= 4) for (let g = 0; g < 4 && ch.length >= 2 && ch[ch.length - 1].t === t && ch[ch.length - 2].t === t; g++) t = this.zPick();
    return t;
  }
  zShotY() { return this.player.y - (this.simV >= 4 ? 60 : 34); }
  zAimAng() {
    const dx = this.zAim.x - this.player.x, dy = this.zAim.y - this.zShotY();
    let a = Math.atan2(dy, dx);
    if (this.simV < 4 && a > -0.12) a = dx >= 0 ? -0.12 : -Math.PI + 0.12;   // старая раскладка: вниз не стреляем
    return a;
  }
  zInit() {
    const sp = this.simV >= 4;
    const chain: any[] = [];
    // v6: спираль длинная, а зона 60 с — голова стартует ближе к центру, чтобы успевать кусать деда
    const startS = this.zLen * (this.simV >= 6 ? 0.62 : this.simV >= 4 ? 0.55 : 0.32);
    for (let i = 0; i < 14; i++) chain.push({ t: this.zNewType(chain), s: startS - i * 36, seed: this.rng() * 6.28 });
    this.zc = { chain, projs: [], loaded: null, tFire: 0, stall: 0, pending: null, iptr: 0, pauseT: 0, warned: false };
    this.zAim = { x: this.W / 2, y: 300 };
    this.player.x = this.player.tx = this.W / 2;
    if (sp) this.player.y = this.H / 2;   // Дед Мороз — в центре спирали
  }
  zFire(ang: number) {
    const zc = this.zc; if (!zc || zc.tFire > 0 || !zc.loaded || this.prepT > 0) return;
    const oy = this.zShotY();
    zc.projs.push({ x: this.player.x, y: oy, vx: Math.cos(ang) * 620, vy: Math.sin(ang) * 620, t: zc.loaded });
    zc.loaded = null; zc.tFire = 0.3;
    if (this.rec && !this.REPLAYING && this.rec.inputs.length < 5900) {
      // v4: полный круг (угол со знаком), код = -(10000 + (ang+π)*1000); старые версии: -|ang|*1000
      const code = this.simV >= 4 ? -(10000 + Math.round((ang + Math.PI) * 1000)) : -Math.round(Math.abs(ang) * 1000);
      this.rec.inputs.push([this.recTs(), code]);
    }
    this.sfx([560, 920], 0.06, "square", 0.18);
  }
  zMatch(i: number) {
    const ch = this.zc.chain; if (i < 0 || i >= ch.length) return false;
    const t = ch[i].t; let a = i, b = i;
    while (a > 0 && ch[a - 1].t === t) a--;
    while (b + 1 < ch.length && ch[b + 1].t === t) b++;
    if (b - a + 1 < 3) return false;
    const val = t === "b" ? 50 : 10;
    for (let k = a; k <= b; k++) {
      const p = this.zPos(Math.max(0, ch[k].s));
      this.score += val;
      if (t === "g") this.giftsGot++;
      if (this.rec && !this.REPLAYING && this.rec.ev.length < 5900) this.rec.ev.push([this.recT(), t === "b" ? "b" : "g"]);
      this.pops.push({ x: p.x, y: p.y - 10, t: 0, txt: "+" + val, c: t === "b" ? "#ffd75e" : "#9dffb0" });
      this.burst(p.x, p.y, t === "b" ? ["#ffd75e", "#fff3b0", "#ffb347"] : t === "s" ? ["#ffffff", "#bfe4ff"] : t === "t" ? ["#8fe6a5", "#dfffe6"] : ["#ff5d5d", "#ffd75e"]);
    }
    ch.splice(a, b - a + 1);
    if (!ch.length) {   // цепочка полностью разрушена — бонус + передышка
      this.score += 50;
      if (this.rec && !this.REPLAYING && this.rec.ev.length < 5900) this.rec.ev.push([this.recT(), "b"]);
      this.pops.push({ x: this.W / 2, y: this.H / 2, t: 0, txt: "🧹 +50", c: "#ffd75e" });
      this.burst(this.player.x, this.player.y - 60, ["#ffd75e", "#fff3b0", "#ffb347"]);
      zc.pauseT = this.time + 4.5;
      this.sfx([784, 1046, 1318, 1568], 0.09, "square", 0.2);
    }
    const n = b - a + 1;   // тем громче и выше, чем больше группа лопнула
    this.sfx(t === "b" ? [1046, 1568, 2093].slice(0, Math.min(3, n - 1)) : [880, 1318, 1760].slice(0, Math.min(3, n - 1)),
      0.075, "square", 0.15 + Math.min(0.09, (n - 3) * 0.025));
    return true;
  }
  zAutoCollapse() {
    // группа из 3+ одинаковых «съехалась» (соседи сошлись после лопнувшей дыры) — схлопывается сама; после попа — перезапуск (цепочка комбо)
    const ch = this.zc.chain, gap = 36;
    for (let i = 0; i < ch.length;) {
      let j = i; while (j + 1 < ch.length && ch[j + 1].t === ch[i].t) j++;
      if (j - i + 1 >= 3 && ch[i].s - ch[j].s <= (j - i) * gap + 4) { this.zMatch(i); i = 0; }
      else i = j + 1;
    }
  }
  updateZuma(dt: number) {
    const zc = this.zc; if (!zc) return;
    const ch = zc.chain, gap = 36, L = this.zLen;
    this.player.x = this.player.tx = this.W / 2;
    // выстрелы: в реплее — из записанных инпутов (знак «выстрела» — отрицательное значение),
    // вживую — из pending-клика, чтобы очерёдность rng совпадала с записью
    if (this.REPLAYING && this.scripted) {
      const ins = this.scripted.data.inputs;
      while (zc.iptr < ins.length && ins[zc.iptr][0] <= this.vt()) {
        const v = ins[zc.iptr++][1];
        if (this.simV >= 4 && typeof v === "number" && v <= -10000 && v >= -16400) this.zFire((-v - 10000) / 1000 - Math.PI);
        else if (typeof v === "number" && v <= -120 && v >= -3200) this.zFire(v / 1000);
      }
    } else if (zc.pending != null) {
      const a = zc.pending; zc.pending = null; this.zFire(a);
    }
    if (!zc.loaded) { zc.loaded = this.zPick(); this.sfx([660], 0.03, "square", 0.08); }   // щелчок перезарядки
    zc.tFire = Math.max(0, zc.tFire - dt); zc.stall = Math.max(0, zc.stall - dt);
    // скорость цепочки по версиям: v5 — ещё медленнее, v4 — спираль 14+3*diff, v3 — 20+4*diff, v2 — историческая 30+8*diff
    const zs = this.simV >= 5 ? 12 + 2.5 * this.diff() : this.simV >= 4 ? 14 + 3 * this.diff() : this.simV >= 3 ? 20 + 4 * this.diff() : 30 + 8 * this.diff();
    const v = this.prepT > 0 || zc.stall > 0 ? 0 : zs;
    for (const b of ch) b.s += v * dt;
    for (let i = 1; i < ch.length; i++) {
      if (ch[i].s > ch[i - 1].s - gap) ch[i].s = ch[i - 1].s - gap;
      else if (ch[i].s < ch[i - 1].s - gap - 1.5) ch[i].s = Math.min(ch[i - 1].s - gap, ch[i].s + 150 * dt);
    }
    if (this.prepT <= 0 && ch.length < 40 && this.time >= zc.pauseT &&
        (!ch.length || ch[ch.length - 1].s >= gap))
      ch.push({ t: this.zNewType(ch), s: 0, seed: this.rng() * 6.28 });
    if (this.simV >= 5) this.zAutoCollapse();   // v5: съехавшиеся группы 3+ лопаются сами (комбо)
    // тревога: цепочка близко к деду (с гистерезисом, чтобы не пищать каждый кадр)
    if (ch.length && this.prepT <= 0 && zc.stall <= 0 && ch[0].s > L - 260 && !zc.warned) {
      zc.warned = true; this.sfx([988, 988, 988], 0.06, "triangle", 0.18);
    } else if (zc.warned && (!ch.length || ch[0].s <= L - 300 || zc.stall > 0)) zc.warned = false;
    // укус: цепочка дошла до деда — откусываем голову, цепочка встаёт на паузу
    let head = 0; while (head < ch.length && ch[head].s >= L - 8) head++;
    if (head > 0) {
      ch.splice(0, head);
      for (const b of ch) b.s -= 160;   // откатываем остаток от деда
      zc.stall = 1.1;
      this.burst(this.player.x, this.player.y - 40, ["#ffffff", "#bfe4ff", "#7ec8ff"]);
      this.sfx([160, 110, 70], 0.12, "sawtooth", 0.26);
      if (this.canHit()) this.takeHit();
    }
    // снаряды и попадания
    for (let i = zc.projs.length - 1; i >= 0; i--) {
      const p = zc.projs[i]; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -30 || p.x > this.W + 30 || p.y < -40 || p.y > this.H + 30) { zc.projs.splice(i, 1); continue; }
      for (let k = 0; k < ch.length; k++) {
        const b = ch[k]; if (b.s < 0) continue;
        const q = this.zPos(b.s);
        if (Math.hypot(p.x - q.x, p.y - q.y) < 27) {
          ch.splice(k + 1, 0, { t: p.t, s: b.s - gap, seed: (k * 7) % 6.28 });
          for (let m = k + 2; m < ch.length; m++) ch[m].s -= gap;
          zc.projs.splice(i, 1);
          if (!this.zMatch(k + 1)) this.sfx([240], 0.05, "triangle", 0.13);   // глухое «тук» — шарик вставлен, но не лопнул
          break;
        }
      }
    }
  }
  drawZuma() {
    const ctx = this.ctx, W = this.W, zc = this.zc;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(20,30,60,.55)"; ctx.lineWidth = 40;
    ctx.beginPath();
    for (let s = 0; s <= this.zLen; s += 24) { const p = this.zPos(s); if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
    ctx.stroke();
    ctx.strokeStyle = "rgba(170,210,255,.28)"; ctx.lineWidth = 2; ctx.setLineDash([10, 14]);
    ctx.beginPath();
    for (let s = 0; s <= this.zLen; s += 24) { const p = this.zPos(s); if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
    ctx.stroke(); ctx.setLineDash([]);
    if (!zc) return;
    const ch = zc.chain;
    for (let i = ch.length - 1; i >= 0; i--) {
      const b = ch[i]; if (b.s < 0) continue;
      const p = this.zPos(b.s);
      const gl = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 34);
      if (b.t === "b") { gl.addColorStop(0, "rgba(255,236,130,.9)"); gl.addColorStop(1, "rgba(255,215,80,0)"); }
      else if (b.t === "g") { gl.addColorStop(0, "rgba(255,130,110,.85)"); gl.addColorStop(1, "rgba(255,90,80,0)"); }
      else if (b.t === "s") { gl.addColorStop(0, "rgba(190,230,255,.85)"); gl.addColorStop(1, "rgba(140,190,255,0)"); }
      else { gl.addColorStop(0, "rgba(140,255,170,.8)"); gl.addColorStop(1, "rgba(60,200,110,0)"); }
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, 6.29); ctx.fill();
      ctx.font = "30px " + this.EMOJI_FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(this.time * 3 + b.seed) * 0.15);
      this.drawEmoji(GameEngine.ZEMOJI[b.t], 30, 0, 1); ctx.restore();
    }
    for (const h of this.hearts) {   // v6: сердечко у тропки — собирай выстрелом
      const gl = ctx.createRadialGradient(h.x, h.y, 4, h.x, h.y, 34);
      gl.addColorStop(0, "rgba(255,120,160,.9)"); gl.addColorStop(1, "rgba(255,90,140,0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(h.x, h.y, 34, 0, 6.29); ctx.fill();
      const pu = 1 + Math.sin(this.time * 5 + h.seed) * .1;
      ctx.save(); ctx.translate(h.x, h.y); ctx.scale(pu, pu);
      if (this.glowOk) { ctx.shadowColor = "#ff5d8a"; ctx.shadowBlur = 18; }
      this.drawEmoji("❤️", 44); ctx.restore();
    }
    ctx.font = "26px " + this.EMOJI_FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const p of zc.projs) this.drawEmoji(GameEngine.ZEMOJI[p.t], 26, p.x, p.y);
    if (!this.REPLAYING) {
      const ang = this.zAimAng();
      const oy = this.zShotY();
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2; ctx.setLineDash([4, 9]);
      ctx.beginPath(); ctx.moveTo(this.player.x, oy);
      ctx.lineTo(this.player.x + Math.cos(ang) * 150, oy + Math.sin(ang) * 150);
      ctx.stroke(); ctx.setLineDash([]);
      if (zc.loaded) this.drawEmoji(GameEngine.ZEMOJI[zc.loaded], 26, this.player.x, this.player.y - (this.simV >= 4 ? 108 : 96));
    }
    // дед Мороз в конце тропки (серый и с падением после укуса)
    ctx.save(); ctx.translate(this.player.x, this.player.y);
    let rot = 0;
    if (this.player.inv > 0) { const fall = this.player.inv / 1.6; rot = 1.4 * fall * fall; }
    ctx.rotate(rot);
    this.drawSanta(0.85, this.player.inv);
    ctx.restore();
  }

  /* ================= отрисовка ================= */
  drawTree(t: any) {
    const ctx = this.ctx;
    const s = t.s, x = t.x, y = t.y;
    ctx.fillStyle = "rgba(20,45,40,.55)";
    for (let i = 0; i < 3; i++) {
      const w = (34 - i * 8) * s, h = 22 * s, oy = y - i * 15 * s;
      ctx.beginPath(); ctx.moveTo(x, oy - h); ctx.lineTo(x - w, oy + h * 0.4); ctx.lineTo(x + w, oy + h * 0.4); ctx.closePath(); ctx.fill();
    }
  }
  /* ================= эмодзи-спрайты =================
     iOS Safari под ctx.rotate/ctx.scale рисует цветные эмодзи монохромным размытым силуэтом.
     Лечится пред-рендером глифа БЕЗ трансформаций в офскрин-canvas (в device-разрешении)
     и drawImage уже внутри трансформированного контекста — одинаково чётко на всех платформах */
  emojiSprite(ch: string, devPx: number): HTMLCanvasElement {
    const q = Math.max(8, Math.ceil(devPx));
    const key = ch + "@" + q;
    let c = this.emojiCache.get(key);
    if (!c) {
      c = document.createElement("canvas");
      const side = Math.ceil(q * 1.35) + 2;
      c.width = side; c.height = side;
      const x = c.getContext("2d")!;
      // только дефолтные выравнивание/бейзлайн: в iOS Safari center/middle у эмодзи иногда даёт
      // монохромный глиф; центрируем вручную через measureText (путь, проверенно цветной в HUD)
      x.font = q + "px " + this.EMOJI_FONT;
      const w = x.measureText(ch).width || q;
      x.fillText(ch, (side - w) / 2, side / 2 + q * 0.34);
      this.emojiCache.set(key, c);
    }
    return c;
  }
  drawEmoji(ch: string, size: number, x = 0, y = 0) {
    const ctx = this.ctx;
    if (typeof document === "undefined" || !document.createElement) { ctx.fillText(ch, x, y); return; }
    const c = this.emojiSprite(ch, size * this.px);
    const w = c.width / this.px, h = c.height / this.px;
    ctx.drawImage(c, x - w / 2, y - h / 2, w, h);
  }

  drawSanta(s: number, inv = 0) {
    // игрок — эмодзи Деда Мороза, светится как подарки; сразу после столкновения «сереет»
    // и постепенно отходит по мере окончания неуязвимости. Без ctx.filter: в iOS Safari
    // фильтры (как и тени) превращают все эмодзи на канвасе в размытые оранжевые блобы
    const ctx = this.ctx;
    ctx.save(); ctx.scale(s, s);
    const glow = ctx.createRadialGradient(0, 0, 5, 0, 0, 58);
    glow.addColorStop(0, "rgba(255,150,110,.85)");
    glow.addColorStop(.55, "rgba(255,110,90,.35)");
    glow.addColorStop(1, "rgba(255,90,80,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 58, 0, 6.29); ctx.fill();
    const halo = ctx.createRadialGradient(0, 0, 30, 0, 0, 74);
    halo.addColorStop(0, "rgba(255,140,100,.30)"); halo.addColorStop(1, "rgba(255,120,90,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, 74, 0, 6.29); ctx.fill();
    ctx.font = "80px " + this.EMOJI_FONT;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (this.glowOk) { ctx.shadowColor = "#ff7a66"; ctx.shadowBlur = 18; }   // прежнее свечение, только на десктопе
    this.drawEmoji("🎅", 80);
    if (this.glowOk) { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; }
    if (inv > 0) {
      const k = Math.min(1, inv / 1.2);   // 1.6..1.2 — полный серый, дальше цвет возвращается
      ctx.globalAlpha = 0.6 * k;
      ctx.fillStyle = "#9aa3b5";
      ctx.beginPath(); ctx.arc(0, -4, 40, 0, 6.29); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  draw3dGround() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const hf = this.laneF * this.LANE_W, HOR = this.HOR, KY = this.KY, FOC = this.FOC, Z_FAR = this.Z_FAR;
    const gg = ctx.createLinearGradient(0, HOR, 0, H);
    gg.addColorStop(0, "#8ba3cf"); gg.addColorStop(.12, "#c9d9f2"); gg.addColorStop(1, "#edf5ff");
    ctx.fillStyle = gg; ctx.fillRect(0, HOR - 1, W, H - HOR + 1);
    const hw = 2.25 * this.LANE_W;
    ctx.fillStyle = "rgba(140,172,218,.55)";
    ctx.beginPath();
    ctx.moveTo(W / 2 + (-hw - hf) * FOC / Z_FAR, HOR + KY / Z_FAR);
    ctx.lineTo(W / 2 + (hw - hf) * FOC / Z_FAR, HOR + KY / Z_FAR);
    ctx.lineTo(W / 2 + (hw - hf) * FOC / 1.4, HOR + KY / 1.4);
    ctx.lineTo(W / 2 + (-hw - hf) * FOC / 1.4, HOR + KY / 1.4);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 2;
    for (const dx of [-this.LANE_W / 2, this.LANE_W / 2]) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + (dx - hf) * FOC / Z_FAR, HOR + KY / Z_FAR);
      ctx.lineTo(W / 2 + (dx - hf) * FOC / 1.4, HOR + KY / 1.4);
      ctx.stroke();
    }
    for (let z = 2 + ((6 - this.zoff) % 6); z < Z_FAR; z += 6) {
      const a = Math.max(0, .45 * (1 - z / Z_FAR));
      if (a <= 0.01) continue;
      ctx.strokeStyle = "rgba(255,255,255," + a + ")"; ctx.lineWidth = Math.max(1, FOC / z * .05);
      const y = HOR + KY / z;
      ctx.beginPath();
      ctx.moveTo(W / 2 + (-hw - hf) * FOC / z, y);
      ctx.lineTo(W / 2 + (hw - hf) * FOC / z, y);
      ctx.stroke();
    }
    for (const t of [...this.trees3].sort((x1, x2) => x2.z - x1.z)) {
      const p = this.proj(t.x - hf, t.z);
      if (p.Y < HOR || p.Y > H + 300) continue;
      const h = p.s * 3.4 * t.s, w = h * .55, al = this.fade(t.z);
      ctx.globalAlpha = al;
      ctx.fillStyle = "#5b4126"; ctx.fillRect(p.X - w * .06, p.Y - h * .18, w * .12, h * .2);
      ctx.fillStyle = "#173f33";
      ctx.beginPath(); ctx.moveTo(p.X, p.Y - h); ctx.lineTo(p.X - w / 2, p.Y); ctx.lineTo(p.X + w / 2, p.Y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.beginPath(); ctx.moveTo(p.X, p.Y - h); ctx.lineTo(p.X - w * .22, p.Y - h * .66); ctx.lineTo(p.X + w * .22, p.Y - h * .66); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  draw3dItems() {
    const ctx = this.ctx, W = this.W, HOR = this.HOR, KY = this.KY, Z_PL = this.Z_PL;
    const all: any[] = [];
    for (const g of this.gifts) all.push({ kind: "gift", o: g });
    for (const s of this.snow) all.push({ kind: "snow", o: s });
    for (const h of this.hearts) all.push({ kind: "heart", o: h });
    all.sort((a, b) => b.o.z - a.o.z);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const it of all) {
      const o = it.o, p = this.proj(this.relX(o), Math.max(1.3, o.z)), al = this.fade(o.z);
      if (p.Y < HOR) continue;
      ctx.globalAlpha = al;
      if (it.kind === "gift") {
        const size = Math.max(7, Math.min(200, p.s * .8));
        ctx.font = size + "px " + this.EMOJI_FONT;
        ctx.save(); ctx.translate(p.X, p.Y - size * .4); ctx.rotate(Math.sin(this.time * 3 + o.seed) * .2);
        this.drawEmoji(o.bonus ? "⭐" : "🎁", size); ctx.restore();
      } else if (it.kind === "heart") {
        const size = Math.max(7, Math.min(200, p.s * .9));
        ctx.font = size + "px " + this.EMOJI_FONT;
        ctx.save(); ctx.translate(p.X, p.Y - size * .5); ctx.rotate(Math.sin(this.time * 4 + o.seed) * .15);
        this.drawEmoji("❤️", size); ctx.restore();
      } else {
        const r = Math.max(3.5, Math.min(120, p.s * o.r * .024));
        const rg = ctx.createRadialGradient(p.X - r * .3, p.Y - r * 1.2 - r * .3, r * .2, p.X, p.Y - r * 1.2, r);
        rg.addColorStop(0, "#ffffff"); rg.addColorStop(1, "#7ea9d9");
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.X, p.Y - r * 1.2, r, 0, 6.29); ctx.fill();
        ctx.strokeStyle = "rgba(46,88,148,.9)"; ctx.lineWidth = Math.max(1, r * .16); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const py = HOR + KY / Z_PL - 46;
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.beginPath(); ctx.ellipse(W / 2, py + 62, 64, 15, 0, 0, 6.29); ctx.fill();
    ctx.save(); ctx.translate(W / 2, py);
    let rot = (this.lane - this.laneF) * .35;
    if (this.player.inv > 0) {   // после попадания — падает на бок и постепенно встаёт
      const fall = this.player.inv / 1.6;
      rot += (rot >= 0 ? 1 : -1) * 1.4 * fall * fall;
    }
    ctx.rotate(rot);
    this.drawSanta(1.6, this.player.inv);
    ctx.restore();
  }

  draw() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.save();
    if (this.shakeT > 0) ctx.translate((Math.random() - .5) * 10 * this.shakeT, (Math.random() - .5) * 10 * this.shakeT);

    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#0b1026"); gr.addColorStop(0.6, "#16214e"); gr.addColorStop(1, "#1f3b73");
    ctx.fillStyle = gr; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.fillStyle = "#f5f0c8"; ctx.beginPath(); ctx.arc(W - 70, 80, 30, 0, 6.29); ctx.fill();
    ctx.fillStyle = "rgba(245,240,200,.12)"; ctx.beginPath(); ctx.arc(W - 70, 80, 48, 0, 6.29); ctx.fill();

    if (this.mode3d) this.draw3dGround(); else for (const t of this.trees) this.drawTree(t);
    ctx.fillStyle = this.mode3d ? "rgba(200,222,255,.3)" : "rgba(205,225,255,.45)";
    for (const f of this.flakes) { ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.29); ctx.fill(); }

    if (this.state !== "menu") {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (this.mode3d) {
        this.draw3dItems();
      } else if (this.zuma) {
        this.drawZuma();
      } else {
        for (const g of this.gifts) {
          ctx.save(); ctx.translate(g.x, g.y);
          const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 46);
          if (g.bonus) { glow.addColorStop(0, "rgba(255,236,130,.95)"); glow.addColorStop(.55, "rgba(255,210,70,.5)"); glow.addColorStop(1, "rgba(255,215,80,0)"); }
          else { glow.addColorStop(0, "rgba(255,130,110,.85)"); glow.addColorStop(.55, "rgba(255,100,90,.42)"); glow.addColorStop(1, "rgba(255,90,80,0)"); }
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 46, 0, 6.29); ctx.fill();
          const halo2 = ctx.createRadialGradient(0, 0, 24, 0, 0, 60);
          halo2.addColorStop(0, g.bonus ? "rgba(255,220,90,.28)" : "rgba(255,120,100,.26)"); halo2.addColorStop(1, "rgba(255,120,100,0)");
          ctx.fillStyle = halo2; ctx.beginPath(); ctx.arc(0, 0, 60, 0, 6.29); ctx.fill();
          ctx.rotate(Math.sin(g.p) * 0.25 + g.rot);
          ctx.font = (g.bonus ? 44 : 46) + "px " + this.EMOJI_FONT;
          if (this.glowOk) { ctx.shadowColor = g.bonus ? "#ffe98a" : "#ff7a66"; ctx.shadowBlur = 18; }
          this.drawEmoji(g.bonus ? "⭐" : "🎁", g.bonus ? 44 : 46);
          ctx.restore();
        }
        for (const h of this.hearts) {
          ctx.save(); ctx.translate(h.x, h.y);
          const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 46);
          glow.addColorStop(0, "rgba(255,120,160,.9)"); glow.addColorStop(.55, "rgba(255,80,130,.42)"); glow.addColorStop(1, "rgba(255,90,140,0)");
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 46, 0, 6.29); ctx.fill();
          const halo3 = ctx.createRadialGradient(0, 0, 24, 0, 0, 62);
          halo3.addColorStop(0, "rgba(255,110,150,.3)"); halo3.addColorStop(1, "rgba(255,90,140,0)");
          ctx.fillStyle = halo3; ctx.beginPath(); ctx.arc(0, 0, 62, 0, 6.29); ctx.fill();
          ctx.font = "44px " + this.EMOJI_FONT;
          if (this.glowOk) { ctx.shadowColor = "#ff5d8a"; ctx.shadowBlur = 18; }
          const pu = 1 + Math.sin(this.time * 5 + h.p) * .07; ctx.scale(pu, pu);
          this.drawEmoji("❤️", 44);
          ctx.restore();
        }
        for (const s of this.snow) {
          const x = s.x + Math.sin(s.p) * s.amp;
          const rg = ctx.createRadialGradient(x - s.r * .3, s.y - s.r * .3, s.r * .2, x, s.y, s.r);
          rg.addColorStop(0, "#ffffff"); rg.addColorStop(1, "#7ea9d9");
          ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, s.y, s.r, 0, 6.29); ctx.fill();
          ctx.strokeStyle = "rgba(46,88,148,.9)"; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,.35)";
          ctx.beginPath(); ctx.arc(x - s.r * .35, s.y - s.r * .35, s.r * .3, 0, 6.29); ctx.fill();
        }
        // дед мороз: alpha всегда 1; после попадания — «падает» на бок и встаёт
        ctx.save(); ctx.translate(this.player.x, this.player.y);
        let rot = (this.player.tx - this.player.x) * 0.002;
        if (this.player.inv > 0) {
          const fall = (this.player.inv / 1.6);
          rot += (rot >= 0 ? 1 : -1) * 1.4 * fall * fall;
        }
        ctx.rotate(rot);
        this.drawSanta(0.85, this.player.inv);
        ctx.restore();
      }
      for (const p of this.parts) {
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
        ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); ctx.globalAlpha = 1;
      }
      for (const p of this.pops) {
        ctx.globalAlpha = 1 - p.t; ctx.fillStyle = p.c; ctx.font = "bold 26px " + this.EMOJI_FONT;
        ctx.fillText(p.txt, p.x, p.y); ctx.globalAlpha = 1;
      }
    }

    if (this.state === "play" || this.state === "pause" || this.state === "over") {
      ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = "bold 24px Arial";
      ctx.fillText("🎁 " + this.score, 16, 34);
      ctx.font = "15px Arial"; ctx.fillStyle = "#9fb4ff";
      ctx.fillText("ур. " + this.diff().toFixed(1) + " · " + Math.floor(this.time) + "с" + (this.mode3d ? " · 🌀3D" : this.zuma ? " · 🎯Зумба" : ""), 18, 58);
      ctx.textAlign = "right"; ctx.font = "24px " + this.EMOJI_FONT;
      // сердечки рисуем поштучно спрайтами: повторы одного эмодзи в строке на iOS Safari
      // теряют цветной presentation и превращаются в чёрные глифы (🖤 вместо ❤️)
      const nH = Math.max(3, this.lives);
      for (let i = 0; i < nH; i++) this.drawEmoji(i < this.lives ? "❤️" : "🖤", 22, W - 26 - i * 24, 26);
    }
    if (this.REPLAYING && this.scripted && this.state !== "menu") {
      ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,215,94,.95)"; ctx.font = "bold 16px Arial";
      ctx.fillText("📼 РЕПЛЕЙ: " + this.scripted.name + " — " + this.scripted.target, W / 2, 94);
    }
    if (this.debug.on) {
      ctx.textAlign = "left"; ctx.font = "12px Consolas, monospace"; ctx.fillStyle = "#7ffa9a";
      ctx.fillText("DEV fps:" + this.debug.fps + " t:" + this.time.toFixed(1) + "с " + (this.mode3d ? "3D" : this.zuma ? "ZUMA" : "2D") +
        " lvl:" + this.diff().toFixed(2) + " g:" + this.gifts.length + " s:" + this.snow.length +
        (this.zuma && this.zc ? " chain:" + this.zc.chain.length + " prj:" + this.zc.projs.length : ""), 14, H - 34);
      ctx.fillText("lives:" + this.lives + " inv:" + (this.player ? this.player.inv.toFixed(1) : "—") +
        (this.debug.slow ? " SLOW" : "") + (this.debug.inv ? " INV" : "") + (this.debug.inflives ? " ∞" : ""), 14, H - 18);
      if (this.debug.boxes && this.player) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,0,.5)"; ctx.beginPath(); ctx.moveTo(0, this.HOR); ctx.lineTo(W, this.HOR); ctx.stroke();
        ctx.strokeStyle = "rgba(255,90,90,.95)";
        ctx.beginPath(); ctx.arc(this.player.x, this.player.y, this.player.r * 0.65, 0, 6.29); ctx.stroke();
        if (this.mode3d) {
          ctx.strokeStyle = "rgba(0,220,255,.8)";
          const yN = this.HOR + this.KY / this.Z_PL;
          ctx.beginPath(); ctx.moveTo(0, yN - 60); ctx.lineTo(W, yN - 60); ctx.stroke();
          ctx.strokeStyle = "rgba(255,90,90,.95)";
          for (const s of this.snow) { const p = this.proj(this.relX(s), Math.max(1.3, s.z)); const rr = Math.max(3.5, p.s * s.r * .024); ctx.beginPath(); ctx.arc(p.X, p.Y - rr * 1.2, rr, 0, 6.29); ctx.stroke(); }
          ctx.strokeStyle = "rgba(0,255,120,.8)";
          for (const g of this.gifts) { const p = this.proj(this.relX(g), Math.max(1.3, g.z)); ctx.beginPath(); ctx.arc(p.X, p.Y - p.s * .3, Math.max(3, p.s * .4), 0, 6.29); ctx.stroke(); }
        } else {
          ctx.strokeStyle = "rgba(255,90,90,.95)";
          for (const s of this.snow) { ctx.beginPath(); ctx.arc(s.x + Math.sin(s.p) * s.amp, s.y, s.r, 0, 6.29); ctx.stroke(); }
          ctx.strokeStyle = "rgba(0,255,120,.8)";
          for (const g of this.gifts) { ctx.beginPath(); ctx.arc(g.x, g.y, g.r + this.player.r * 0.75, 0, 6.29); ctx.stroke(); }
        }
      }
    }
    if (this.state === "play" && this.prepT > 0) {
      const n = Math.ceil(this.prepT), fr = this.prepT - Math.floor(this.prepT);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(5,10,30,.62)"; ctx.fillRect(0, H * 0.26, W, 168);
      ctx.fillStyle = "#ffd75e"; ctx.font = "bold 27px Arial";
      ctx.fillText(this.mode3d ? "🌀 Скоро 3D-зона! Полосы: ← →" : this.zuma ? "🎯 Скоро ЗУМБА-зона! Кликай — лопай шарики!" : "❄ Скоро обычный вид!", W / 2, H * 0.26 + 42);
      ctx.globalAlpha = 0.3 + 0.7 * fr;
      ctx.font = "bold 76px Arial";
      ctx.fillText(String(n), W / 2, H * 0.26 + 112);
      ctx.globalAlpha = 1;
    }
    if (this.state === "pause") {
      ctx.fillStyle = "rgba(5,10,30,.6)"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 40px Arial";
      ctx.fillText("⏸ Пауза", W / 2, H / 2 - 10);
      ctx.font = "18px Arial"; ctx.fillStyle = "#9fb4ff";
      ctx.fillText("нажми P, чтобы продолжить", W / 2, H / 2 + 28);
    }
    ctx.restore();
  }

  frame(now: number) {
    let rawdt = (now - this.last) / 1000; this.last = now;
    if (rawdt > 0.25) rawdt = 0.25;
    try {
      if (this.debug.on && rawdt > 0) this.debug.fps = Math.round(this.debug.fps ? this.debug.fps * 0.92 + (1 / rawdt) * 0.08 : 1 / rawdt);
      this.acc += rawdt * (this.debug.on && this.debug.slow ? 0.25 : 1);
      let n = 0;
      while (this.acc >= this.FIXED && n < 8) { this.update(this.FIXED); this.acc -= this.FIXED; n++; }
      if (n >= 8) this.acc = 0;
      this.draw();
    } catch (e: any) {
      this.acc = 0;
      if (this.hooks.onError) this.hooks.onError((e && e.message) || String(e));
    }
  }

  /* ================= публичный API ================= */
  // начать новый раунд (round — ответ start-round или null в локальном режиме)
  startGame(roundObj: any) {
    this.round = roundObj || null;
    this.reset();
    this.state = "play";
    try { this.startMusic(); } catch (e: any) { this.dlog("music fail: " + e.message); }
    if (this.hooks.onState) this.hooks.onState("play");
  }
  snapshotReplay(): string | null {
    if (!this.rec) return null;
    this.rec.dur = this.recT();
    return JSON.stringify(this.rec);
  }
  afterScoreAccepted() { this.round = null; this.rec = null; }

  enterReplay(row: { name: string; score: number; replay: string }) {
    const data = JSON.parse(row.replay);
    this.scripted = { data, name: row.name, target: row.score, ptr: 0 };
    this.REPLAYING = true; this.round = null;
    this.reset();
    this.seed0 = (this.scripted.data.seed || 0) >>> 0; this.rng = this.mulberry32(this.seed0);
    // поток сердечек (v6+) обязан совпадать с живым рангом: пересадить rngH тем же seed0, как в reset()
    this.rngH = this.mulberry32((this.seed0 ^ 0x5EEDBA7E) >>> 0);
    this.nextHeartT = 10 + this.rngH() * 10; this.hearts = [];
    this.rec = null;
    this.state = "play";
    try { this.startMusic(); } catch (e) { /* ignore */ }
    if (this.hooks.onState) this.hooks.onState("play");
  }
  exitReplay() {
    this.REPLAYING = false; this.scripted = null; this.round = null; this.rec = null;
    this.reset();
    this.state = "menu";
    if (this.hooks.onState) this.hooks.onState("menu");
  }
}
