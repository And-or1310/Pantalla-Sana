// Port de engine.py. Mismo comportamiento, pero en el navegador: sin hilos (setInterval + async) y sin servidor.
import type { AlbumItem, Content, EventMsg, LiveState, Settings } from "../lib/types";
import {
  CAL_END, CAL_START, KEYS, LEVEL_NAMES, POSTURE_KEYS, RESCUE_WINDOW, RULES, SENS_TIME, Tracker, holdStep, newHold, planAlert,
  type Baseline, type Hold, type Key, type Raw, type Vals,
} from "./core";
import { getUserImageUrl, getUserSoundUrl, loadUserMedia, saveUserFile } from "./media";
import { ART_PACKS, getContent, notifyPhone, type Src } from "./sources";
import { Metrics, Progress, RARITY, levelInfo, loadSettings, mergeSettings, saveSettings, stageOf } from "./store";
import { Vision } from "./vision";

type Hero = LiveState["hero"];
type Status = ["off" | "nodata" | "ok" | "acc" | "alert", number];
type Pend = { t: number; c: Src | null };
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
const SND_TYPES = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/ogg"];

const toContent = (c: Src | null): Content | null => c && ({
  pack: c.pack, id: String(c.id), name: c.name ?? "", title: c.title ?? "", text: c.text ?? "", art_url: c.art_url ?? null,
  emoji: c.emoji ?? null, color: c.color ?? null, credit: c.credit ?? null, breathe: !!c.breathe,
});

export class Engine {
  settings: Settings = loadSettings();
  prog = new Progress();
  metrics = new Metrics();
  vision = new Vision();
  paused = false; camError = false; cameraOn = false;
  netRequests = 0;

  private listeners = new Set<(e: EventMsg) => void>();
  private tr: Tracker;
  private baseline: Baseline | null = null;
  private cal: { start: number; s: Record<Key, number[]>; ear: number[] } | null = null;
  private tStart: number; private lastEval: number;
  private score = 100; private goodT = 0; private totalT = 0;
  private rt: Hold[] = RULES.map(newHold);
  private status: Status[] = RULES.map(() => ["off", 0] as Status);
  private lastFired: [number, number] = [0, 0];
  private pending = new Map<number, Pend>();
  private cheerUntil = 0;
  private vals: Vals;
  private timer = 0;
  private lastCamTry = 0;

  constructor(private withCamera = true, private clock: () => number = () => Date.now() / 1000) {
    const now = clock();
    this.tr = new Tracker(now);
    this.tStart = this.lastEval = now;
    this.vals = this.tr.values(now);
  }

  // ------------------------------------------------------------ eventos
  subscribe(cb: (e: EventMsg) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  emit(ev: EventMsg) { for (const cb of [...this.listeners]) { try { cb(ev); } catch { /* un oyente roto no frena al resto */ } } }
  toast(msg: string, tone: "ok" | "warn" | "bad" | "muted" = "ok") { this.emit({ type: "toast", msg, tone }); }

  // ------------------------------------------------------------ ciclo de vida
  start() {
    if (this.timer) return;
    void loadUserMedia().then(() => {
      if (this.settings.img_path && !getUserImageUrl()) this.updateSettings({ img_path: "" });
      if (this.settings.snd_path && !getUserSoundUrl()) this.updateSettings({ snd_path: "" });
    });
    this.timer = window.setInterval(() => { try { this.step(); } catch (e) { console.error(e); } }, 100);
    const persist = () => { this.prog.save(); this.metrics.save(); saveSettings(this.settings); };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); });
    this.syncCamera();
  }

  private syncCamera() {
    if (!this.withCamera) return;
    if (this.paused) { this.vision.stop(); this.cameraOn = false; return; }
    if (this.vision.active) return;
    this.lastCamTry = this.clock();
    void this.vision.start(
      (raw, ear, now) => this.ingest(raw, ear, now),
      () => { this.camError = false; this.cameraOn = true; },
      () => { this.camError = true; this.cameraOn = false; });
  }

  // ------------------------------------------------------------ ajustes
  updateSettings(patch: Partial<Settings>) {
    this.settings = mergeSettings(this.settings, patch);
    saveSettings(this.settings);
    return this.settings;
  }

  async saveUserFile(kind: "image" | "sound", file: File) {
    if (!(kind === "image" ? IMG_TYPES : SND_TYPES).includes(file.type)) throw new Error("Ese tipo de archivo no se puede usar");
    if (!file.size || file.size > 8_000_000) throw new Error("El archivo pesa más de 8 MB");
    await saveUserFile(kind, file);
    return this.updateSettings(kind === "image" ? { img_path: "local" } : { snd_path: "local" });
  }

  // ------------------------------------------------------------ entrada de datos
  ingest(raw: Raw, earV: number | null, now = this.clock()) {
    this.tr.feed(raw, earV, now);
    if (this.cal && now - this.cal.start >= CAL_START && now - this.cal.start <= CAL_END) {
      for (const k of KEYS) { const x = raw[k]; if (x !== null && x !== undefined) this.cal.s[k].push(x); }
      if (earV !== null) this.cal.ear.push(this.tr.lastEar ?? earV);
    }
  }

  // ------------------------------------------------------------ comandos
  calibrate(now = this.clock()) {
    if (this.paused) this.setPaused(false);
    this.cal = { start: now, s: { hd: [], cl: [], tl: [], roll: [] }, ear: [] };
  }

  private finishCal(now: number) {
    const { s, ear } = this.cal!;
    this.cal = null;
    const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
    if (s.hd.length >= 15 && s.tl.length >= 15) {
      this.baseline = Object.fromEntries(KEYS.map((k) => [k, s[k].length >= 15 ? med(s[k]) : null])) as Baseline;
      if (ear.length >= 15) this.tr.earHist = ear.map((e) => [now, e] as [number, number]);
      for (const st of this.rt) st.since = null;
      this.toast("¡Listo! Ya te estoy cuidando", "ok");
    } else this.toast("No te veo bien. Que se vean tus hombros y tu cara, e inténtalo otra vez", "warn");
  }

  setPaused(v: boolean) {
    this.paused = v;
    if (v) this.cal = null;
    this.syncCamera();
  }
  testAlert() { this.fire(0, true); }
  giftPack() { this.prog.d.packs++; this.prog.save(); this.toast("Te regalé un sobre de prueba 🎁", "ok"); }
  setCompanion(key: string) { this.prog.setCompanion(key); this.cheerUntil = this.clock() + 4; }

  /** Gasta un sobre. La descarga es asíncrona; el resultado llega como evento pack_opened. */
  openPack() {
    if (this.prog.d.packs <= 0) { this.toast("Aún no tienes sobres: sube de nivel o completa tu racha del día 🎁", "warn"); return false; }
    void this.packWorker();
    return true;
  }
  private async packWorker() {
    const net = this.settings.net;
    const out: Src[] = [], seen = new Set<string>();
    for (let tries = 0; out.length < 3 && tries < 10; tries++) {
      const c = await getContent(ART_PACKS[Math.floor(Math.random() * ART_PACKS.length)], net).catch(() => null);
      if (net) this.netRequests++;
      if (c?.art_url) { const k = `${c.pack}:${c.id}`; if (!seen.has(k)) { seen.add(k); out.push(c); } }
    }
    const results = this.prog.openPack(out);
    if (!results.length) {
      this.toast("No pude conseguir imágenes (¿sin internet?). Tu sobre no se gastó.", "warn");
      this.emit({ type: "pack_opened", cards: [], ok: false });
      return;
    }
    this.emit({ type: "pack_opened", ok: true, cards: results.map(([i, n]) => ({ title: i.title, art_url: i.art, rarity: i.rarity, is_new: n })) });
    this.cheerUntil = this.clock() + 4;
  }

  album(): AlbumItem[] {
    const comp = this.prog.d.companion;
    return Object.entries(this.prog.d.album).slice(-200).reverse()
      .map(([key, v]) => ({ key, pack: v.pack, title: v.title, art_url: v.art, rarity: v.rarity, got: v.got, is_companion: key === comp }));
  }

  // ------------------------------------------------------------ avisos
  private fire(i: number, test = false, now = this.clock()) {
    const r = RULES[i], s = this.settings;
    const msg = test ? "¡Así te voy a avisar!" : r.msg;
    const plan = planAlert(r.key, s.img_mode, s.snd_mode, !!getUserImageUrl(), !!getUserSoundUrl());
    const accent = r.key === "sleep" ? "rose" : "amber";
    this.lastFired = [now, i];
    const aid = Math.random().toString(16).slice(2, 10);
    if (plan.sound === "beep") this.emit({ type: "sound", kind: "beep", repeat: plan.repeat });
    else if (plan.sound === "file") this.emit({ type: "sound", kind: "file", url: getUserSoundUrl(), repeat: 1 });
    else if (plan.sound === "voice") this.emit({ type: "sound", kind: "voice", text: msg, repeat: 1 });
    if (plan.card !== "pack") {                              // texto o imagen del usuario: sale al instante
      const content = plan.card === "user" ? toContent({ pack: "Mi imagen", id: "user", title: "Pantalla Sana", art_url: getUserImageUrl() } as Src) : null;
      this.emit({ type: "alert", id: aid, rule: r.key, msg, card: plan.card, accent, content, test });
    }
    if (plan.fetch) void this.contentWorker(i, plan, msg, aid, accent, test);
    if (!test) {
      this.metrics.alert(now, r.key);
      this.score = Math.max(0, this.score - 4);
      this.pending.set(i, { t: now, c: null });
      const topic = s.ntfy.trim();
      if (topic) { this.netRequests++; void notifyPhone(topic, msg); }
    }
  }
  private async contentWorker(idx: number, plan: ReturnType<typeof planAlert>, msg: string, aid: string, accent: "amber" | "rose", test: boolean) {
    const s = this.settings;
    const sleep = RULES[idx].key === "sleep";
    const c = plan.card === "pack" ? await getContent(s.img_mode, s.net, sleep) : null;
    if (s.net) this.netRequests++;
    let cry = c?.cry ?? null;
    if (plan.sound === "cry" && !cry) cry = (await getContent("Pokémon", s.net, sleep)).cry ?? null;
    if (plan.card === "pack")
      this.emit({ type: "alert", id: aid, rule: RULES[idx].key, msg, card: "pack", accent, content: toContent(c), test });
    if (plan.sound === "cry") this.emit(cry ? { type: "sound", kind: "cry", url: cry, repeat: 1 } : { type: "sound", kind: "beep", repeat: 1 });
    const p = this.pending.get(idx);
    if (!test && p) p.c = c;
  }

  private onRescue(i: number, c: Src | null, now: number) {
    const [nw, up, info] = this.prog.rescue(c);
    this.score = Math.min(100, this.score + 3);
    this.cheerUntil = now + 4;
    const gained = this.prog.RESCUE_XP + (nw ? 5 : 0) + (nw && info ? RARITY[info.rarity].xp : 0);
    this.emit({ type: "rescue", rule: RULES[i].key, xp: gained, new_card: nw, rarity: nw ? info?.rarity ?? null : null,
      card_title: nw ? info?.title ?? null : null, level_up: up });
    if (up) this.emit({ type: "levelup", level: this.prog.level(), summary: this.prog.summary() });
  }

  // ------------------------------------------------------------ lógica por ciclo
  step(now = this.clock()) {
    if (this.cal && now - this.cal.start > CAL_END) this.finishCal(now);
    if (this.camError && this.withCamera && !this.paused && now - this.lastCamTry > 5) this.syncCamera();
    this.evaluate(now);
    while (this.prog.news.length) this.toast(this.prog.news.shift()!, "ok");
  }

  private evaluate(now: number) {
    const s = this.settings;
    const dt = Math.min(0.5, now - this.lastEval);
    this.lastEval = now;
    const demo = s.demo;
    const v = this.tr.values(now, demo);
    this.vals = v;
    const live = !this.paused && this.cal === null;
    const L = LEVEL_NAMES.indexOf(s.sens);
    let postureBad = false, postureData = false;

    RULES.forEach((r, i) => {
      const st = this.rt[i];
      if (!live || !(s.groups?.[r.group] ?? true) || (r.base && !this.baseline)) { st.since = null; this.status[i] = ["off", 0]; return; }
      const nodata = r.inputs.some((k) => v[k] === null) || (r.base && r.inputs.some((k) => this.baseline![k as Key] == null));
      const c = nodata ? false : r.cond(v, this.baseline as Baseline, L);
      const pd = this.pending.get(i);                        // ¿te corregiste tras un aviso? -> recompensa
      if (pd) {
        if (now - pd.t > RESCUE_WINDOW) this.pending.delete(i);
        else if (!nodata && !c && now - pd.t > 3) { this.pending.delete(i); this.onRescue(i, pd.c, now); }
      }
      if (POSTURE_KEYS.has(r.key) && !nodata) { postureData = true; postureBad = postureBad || c; }
      let need = Math.max(1, Math.round(r.sec * SENS_TIME[L])), cd = r.cd;
      if (demo) { need = Math.min(need, 3); cd = 8; }
      if (holdStep(st, c, now, need, cd)) { st.lastFire = now; this.fire(i, false, now); }
      if (nodata && st.since === null) this.status[i] = ["nodata", 0];
      else if (st.since === null) this.status[i] = ["ok", 0];
      else if (now - st.lastFire < 8) this.status[i] = ["alert", 100];
      else this.status[i] = ["acc", Math.min(100, ((now - st.since) / need) * 100)];
    });

    if (live) {
      const seen = now - this.tr.faceSeen <= 1.5 || Object.values(this.tr.seen).some((t) => now - (t as number) <= 1.5);
      this.metrics.record(now, dt, seen, this.baseline && postureData ? postureBad : null, v.bpm);
      this.score = Math.min(100, this.score + dt * 0.1);
      if (this.baseline && postureData) {
        this.totalT += dt;
        if (!postureBad) {
          this.goodT += dt;
          if (this.prog.good(dt)) { this.cheerUntil = now + 4; this.emit({ type: "levelup", level: this.prog.level(), summary: this.prog.summary() }); }
        }
      }
    }
  }

  // ------------------------------------------------------------ estado para la UI
  private mood(now: number): LiveState["mood"] {
    if (now < this.cheerUntil) return "cheer";
    if (this.paused || this.camError) return "sleep";
    if (!this.baseline) return "idle";
    if (now - this.tr.lastPresent > 20) return "sleep";
    const st = RULES.map((r, i) => (POSTURE_KEYS.has(r.key) ? this.status[i][0] : null));
    return st.includes("alert") ? "sad" : st.includes("acc") ? "worried" : "happy";
  }

  private hero(now: number): Hero {
    if (this.camError) return { tag: "SIN CÁMARA", title: "No encuentro tu cámara", tone: "bad",
      sub: "Permite el acceso a la cámara en tu navegador (el candado junto a la dirección) y cierra otras apps que la usen." };
    if (this.paused) return { tag: "EN PAUSA", title: "Descansando", tone: "muted", sub: "La cámara está apagada. Cuando quieras, seguimos." };
    if (this.cal) return { tag: "UN MOMENTO", title: "Quédate así un momento…", tone: "warn", sub: "Mira la pantalla, ya casi termino." };
    if (!this.baseline) return { tag: "BIENVENIDO", title: "¡Hola! Vamos a empezar", tone: "ok", button: "start",
      sub: "Siéntate cómodo y derecho frente a la cámara. Aprenderé cómo te ves cuando estás bien. Tarda 3 segundos." };
    if (now - this.lastFired[0] < 8) {
      const r = RULES[this.lastFired[1]];
      return { tag: "AVISO", title: r.msg, sub: "Un pequeño ajuste y seguimos.", tone: r.key === "sleep" ? "bad" : "warn" };
    }
    let best = -1, bi = -1;
    this.status.forEach(([k, p], i) => { if (k === "acc" && p > best) { best = p; bi = i; } });
    if (bi >= 0) return { tag: "ATENTO", title: RULES[bi].hint, tone: "warn", sub: "Si lo corriges ahora, no tengo que molestarte." };
    if (now - this.tr.lastPresent > 4) return { tag: "TE BUSCO", title: "No te veo", tone: "muted", sub: "Acércate un poco a la cámara para que pueda cuidarte." };
    return { tag: "TODO BIEN", title: "Vas muy bien", tone: "ok", button: "recalibrate", sub: "Tu postura y tus ojos están bien. Yo me encargo de avisarte." };
  }

  snapshot(now = this.clock()): LiveState {
    const [lv, cur, need] = levelInfo(this.prog.d.xp);
    const comp = this.prog.companionInfo();
    return {
      type: "state", t: now, paused: this.paused, cam_error: this.camError, calibrating: this.cal !== null,
      cal_progress: this.cal ? Math.min(1, (now - this.cal.start) / CAL_END) : 0,
      calibrated: !!this.baseline, present: now - this.tr.faceSeen <= 1.5, eyes_closed: !!this.tr.closed,
      mood: this.mood(now), hero: this.hero(now),
      rules: RULES.map((r, i) => ({ key: r.key, name: r.name, group: r.group, state: this.status[i][0], progress: this.status[i][1] })),
      score: Math.round(this.score * 10) / 10,
      posture_pct: this.totalT > 5 ? Math.round((this.goodT / this.totalT) * 1000) / 10 : null,
      session_sec: now - this.tStart, work_min: Math.round(this.vals.work_min * 10) / 10,
      level: lv, level_xp: cur, level_need: need, streak: this.prog.streakNow(), packs: this.prog.d.packs, stage: stageOf(lv),
      companion: comp ? { title: comp.title, art_url: comp.art, rarity: comp.rarity } : null,
      net_requests_today: this.netRequests, camera_on: this.withCamera && this.cameraOn && !this.paused && !this.camError,
    };
  }
}

export const engine = new Engine();
