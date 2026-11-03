// Port de progreso.py y metrics.py + ajustes. Todo vive en localStorage del navegador (solo números y enlaces).
import type { DayStat, Settings, SlotStat } from "../types";
import type { Src } from "./sources";

export const PROXY_URL: string = (import.meta.env?.VITE_PROXY_URL as string | undefined) ?? "";

export const ls = {
  get<T>(k: string, d: T): T {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
  },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* lleno o bloqueado */ } },
};

export function dayKey(ts: number) {
  const d = new Date(ts * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ------------------------------------------------------------------ ajustes
export const DEFAULT_SETTINGS: Settings = {
  sens: "Normal", img_mode: "Pokémon", snd_mode: "Pitido", img_path: "", snd_path: "", folder: "", ntfy: "",
  net: true, preview: "Mostrar", demo: false,
  groups: { posture: true, close: true, blink: true, sleep: true, pause: true },
  ai_provider: "local", ai_proxy_url: PROXY_URL, ai_model: "",
};
const ENUMS: Record<string, string[]> = {
  sens: ["Tranquilo", "Normal", "Atento"],
  img_mode: ["Sorpresa", "Pokémon", "Gatitos", "Perritos", "Zorros", "Arte", "Espacio", "Dragon Ball", "Estiramientos",
    "Frases", "Respira", "Mi imagen", "Sin imagen"],
  snd_mode: ["Silencio", "Pitido", "Grito Pokémon", "Voz", "Mi sonido"],
  preview: ["Mostrar", "Solo contorno", "Ocultar"],
  ai_provider: ["local", "proxy"],
};

/** Aplica un parche validando campo por campo. Lanza Error si algo no es válido. */
export function mergeSettings(cur: Settings, patch: Partial<Settings>): Settings {
  const out: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || !(k in DEFAULT_SETTINGS)) continue;
    if (ENUMS[k] && !ENUMS[k].includes(v as string)) throw new Error(`valor no válido para ${k}`);
    if (k === "groups") out.groups = { ...cur.groups, ...Object.fromEntries(Object.entries(v as object).filter(([g]) => g in DEFAULT_SETTINGS.groups!)) };
    else if (typeof v !== typeof (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k]) throw new Error(`tipo no válido para ${k}`);
    else out[k] = v;
  }
  out.ai_proxy_url = PROXY_URL;                       // la dirección del servicio es fija en la versión web
  return out as unknown as Settings;
}

export function loadSettings(): Settings {
  let cur = { ...DEFAULT_SETTINGS };
  const stored = ls.get<Record<string, unknown>>("ps.settings", {});
  for (const [k, v] of Object.entries(stored)) {
    try { cur = mergeSettings(cur, { [k]: v } as Partial<Settings>); } catch { /* se ignora lo inválido */ }
  }
  return cur;
}
export const saveSettings = (s: Settings) => ls.set("ps.settings", s);

// ------------------------------------------------------------------ progreso
export type Rarity = "comun" | "rara" | "epica" | "brillante";
export const RARITY: Record<Rarity, { w: number; wp: number; xp: number }> = {
  comun: { w: 70, wp: 50, xp: 0 }, rara: { w: 22, wp: 32, xp: 5 },
  epica: { w: 7, wp: 14, xp: 15 }, brillante: { w: 1, wp: 4, xp: 40 },
};
const RESCUE_XP = 10, NEW_BONUS = 5, MIN_PER_XP = 60, STREAK_SEC = 600, STREAK_BONUS = 25, DUP_XP = 3;

export function rollRarity(pack = false): Rarity {
  const keys = Object.keys(RARITY) as Rarity[];
  const ws = keys.map((k) => RARITY[k][pack ? "wp" : "w"]);
  let r = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < keys.length; i++) { r -= ws[i]; if (r < 0) return keys[i]; }
  return "comun";
}
/** (nivel, xp dentro del nivel, xp que pide el nivel) */
export function levelInfo(xp: number): [number, number, number] {
  let lv = 1, need = 100;
  while (xp >= need) { xp -= need; lv++; need = Math.floor(need * 1.25); }
  return [lv, xp, need];
}
export const stageOf = (level: number) => Math.min(3, Math.floor((level - 1) / 4));

export interface CardInfo { pack: string; title: string; art: string; rarity: Rarity; got: string }
interface ProgData {
  xp: number; streak: number; best: number; last_day: string; day: string; good_today: number; rescues: number;
  album: Record<string, CardInfo>; packs: number; companion: string; log: Record<string, number>;
}

export class Progress {
  d: ProgData;
  news: string[] = [];
  RESCUE_XP = RESCUE_XP;
  private carry = 0;
  constructor() {
    this.d = { xp: 0, streak: 0, best: 0, last_day: "", day: "", good_today: 0, rescues: 0, album: {}, packs: 0,
      companion: "", log: {}, ...ls.get<Partial<ProgData>>("ps.progress", {}) };
    this.roll();
  }
  private day(offset = 0) { return dayKey(Date.now() / 1000 - offset * 86400); }
  private roll() { if (this.d.day !== this.day()) { this.d.day = this.day(); this.d.good_today = 0; } }

  addXp(x: number) {
    const before = levelInfo(this.d.xp)[0];
    this.d.xp += x;
    const after = levelInfo(this.d.xp)[0];
    if (after > before) this.d.packs += after - before;      // cada nivel nuevo regala un sobre
    return after > before;
  }
  level() { return levelInfo(this.d.xp)[0]; }

  /** Llamar cada ciclo mientras la postura es buena. Devuelve true si subió de nivel. */
  good(dt: number) {
    this.roll();
    this.d.good_today += dt;
    this.d.log[this.d.day] = Math.round(this.d.good_today);
    this.carry += dt;
    let up = false;
    while (this.carry >= MIN_PER_XP) { this.carry -= MIN_PER_XP; up = this.addXp(1) || up; }
    if (this.d.good_today >= STREAK_SEC && this.d.last_day !== this.d.day) {
      this.d.streak = this.d.last_day === this.day(1) ? this.d.streak + 1 : 1;
      this.d.last_day = this.d.day;
      this.d.best = Math.max(this.d.best, this.d.streak);
      up = this.addXp(STREAK_BONUS) || up;
      this.d.packs += 1;
      this.news.push(`¡Racha de ${this.d.streak} día(s)! Ganaste un sobre 🎁`);
      this.save();
    } else if (up) this.save();
    return up;
  }

  /** Mete una imagen al álbum. Devuelve [info, esNueva]. Si ya la tenías, no se duplica. */
  addCard(c: Src | null, rarity?: Rarity): [CardInfo | null, boolean] {
    if (!c || !c.art_url) return [null, false];
    const r = rarity ?? rollRarity();
    let key = `${c.pack}:${c.id}`;
    if (r === "brillante") key += "*";                       // la versión brillante se pinta con un filtro CSS
    const old = this.d.album[key];
    if (old) return [old, false];
    const info: CardInfo = { pack: c.pack, title: c.name || c.title || "", art: c.art_url, rarity: r, got: this.day() };
    this.d.album[key] = info;
    return [info, true];
  }

  /** Corregiste tras un aviso. Devuelve [nuevoEnAlbum, subioNivel, infoCarta]. */
  rescue(c: Src | null): [boolean, boolean, CardInfo | null] {
    this.d.rescues++;
    const [info, nw] = this.addCard(c);
    const bonus = nw && info ? RARITY[info.rarity].xp : 0;
    const up = this.addXp(RESCUE_XP + (nw ? NEW_BONUS : 0) + bonus);
    this.save();
    return [nw, up, info];
  }

  /** Gasta 1 sobre y convierte hasta 3 contenidos en cartas. Lista vacía = no se gastó nada. */
  openPack(contents: Src[]): [CardInfo, boolean][] {
    if (this.d.packs <= 0 || !contents.length) return [];
    this.d.packs--;
    const out: [CardInfo, boolean][] = [];
    for (const c of contents.slice(0, 3)) {
      const [info, nw] = this.addCard(c, rollRarity(true));
      if (!info) continue;
      if (!nw) this.addXp(DUP_XP);
      out.push([info, nw]);
    }
    this.save();
    return out;
  }

  companionInfo(): CardInfo | null {
    const alb = this.d.album;
    if (alb[this.d.companion]) return alb[this.d.companion];
    const keys = Object.keys(alb);
    return keys.length ? alb[keys[keys.length - 1]] : null;
  }
  setCompanion(key: string) { if (key in this.d.album) { this.d.companion = key; this.save(); } }
  streakNow() { return [this.day(), this.day(1)].includes(this.d.last_day) ? this.d.streak : 0; }
  summary() { return `Nv ${this.level()} · 🔥 ${this.streakNow()} d`; }
  save() {
    for (const k of Object.keys(this.d.log).sort().slice(0, -30)) delete this.d.log[k];
    ls.set("ps.progress", this.d);
  }
}

// ------------------------------------------------------------------ métricas por día (solo números)
const SLOTS: [string, number, number][] = [["madrugada", 0, 6], ["mañana", 6, 12], ["tarde", 12, 18], ["noche", 18, 24]];
const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const KEEP_DAYS = 60;

interface DayData {
  session_sec: number; good_sec: number; total_sec: number; alerts: Record<string, number>;
  bpm_w: number; bpm_sec: number; hours: Record<string, [number, number]>; demo?: boolean;
}
const empty = (): DayData => ({ session_sec: 0, good_sec: 0, total_sec: 0, alerts: {}, bpm_w: 0, bpm_sec: 0, hours: {} });

export class Metrics {
  days: Record<string, DayData> = ls.get("ps.metrics", {});
  private lastSave = 0;

  private today(ts: number) {
    const k = dayKey(ts);
    let d = this.days[k];
    if (!d || d.demo) d = this.days[k] = empty();            // un día de ejemplo se reemplaza con datos reales
    return d;
  }
  record(ts: number, dt: number, present: boolean, postureBad: boolean | null, bpm: number | null) {
    if (!present && postureBad === null) return;
    const d = this.today(ts);
    if (present) {
      d.session_sec += dt;
      if (bpm !== null) { d.bpm_w += bpm * dt; d.bpm_sec += dt; }
    }
    if (postureBad !== null) {
      d.total_sec += dt;
      const hh = String(new Date(ts * 1000).getHours()).padStart(2, "0");
      const h = (d.hours[hh] ??= [0, 0]);
      h[1] += dt;
      if (postureBad) h[0] += dt; else d.good_sec += dt;
    }
    if (ts - this.lastSave > 30) this.save(ts);
  }
  alert(ts: number, rule: string) { const d = this.today(ts); d.alerts[rule] = (d.alerts[rule] ?? 0) + 1; }
  save(ts = Date.now() / 1000) {
    this.lastSave = ts;
    for (const k of Object.keys(this.days).sort().slice(0, -KEEP_DAYS)) delete this.days[k];
    ls.set("ps.metrics", this.days);
  }

  private stat(key: string, d: DayData): DayStat {
    const [y, m, dd] = key.split("-").map(Number);
    const wd = (new Date(y, m - 1, dd).getDay() + 6) % 7;
    const tot = d.total_sec;
    return { date: key, label: WEEKDAYS[wd], demo: !!d.demo, session_min: Math.round(d.session_sec / 60),
      posture_pct: tot >= 30 ? Math.round((d.good_sec / tot) * 100) : null,
      alerts: { ...d.alerts }, alerts_total: Object.values(d.alerts).reduce((a, b) => a + b, 0),
      bpm_avg: d.bpm_sec >= 60 ? Math.round((d.bpm_w / d.bpm_sec) * 10) / 10 : null };
  }
  week(now: number, n = 7): DayStat[] {
    const out: DayStat[] = [];
    for (let i = n - 1; i >= 0; i--) { const k = dayKey(now - i * 86400); out.push(this.stat(k, this.days[k] ?? empty())); }
    return out;
  }
  slots(now: number, n = 7): SlotStat[] {
    const acc: Record<string, [number, number]> = Object.fromEntries(SLOTS.map(([s]) => [s, [0, 0]]));
    for (let i = 0; i < n; i++) {
      const hours = this.days[dayKey(now - i * 86400)]?.hours ?? {};
      for (const [hh, [bad, tot]] of Object.entries(hours))
        for (const [name, a, b] of SLOTS) if (a <= +hh && +hh < b) { acc[name][0] += bad; acc[name][1] += tot; }
    }
    return SLOTS.map(([name]) => { const [bad, tot] = acc[name]; return { name, bad_pct: tot >= 120 ? Math.round((bad / tot) * 100) : null }; });
  }

  seedDemo(now: number, n = 7) {
    let s = 7;                                               // PRNG con semilla (mulberry32): mismos datos de ejemplo siempre
    const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const uni = (a: number, b: number) => a + (b - a) * rnd(), int = (a: number, b: number) => Math.floor(uni(a, b + 1));
    for (let i = 0; i < n; i++) {
      const k = dayKey(now - i * 86400), cur = this.days[k];
      if (cur && !cur.demo && cur.session_sec > 0) continue;  // nunca pisa datos reales
      const trend = 0.55 + 0.04 * (n - 1 - i), total = uni(3, 6) * 3600;
      const d = empty();
      Object.assign(d, { demo: true, session_sec: total, total_sec: total * 0.9,
        good_sec: total * 0.9 * Math.min(0.92, trend + uni(-0.05, 0.05)), bpm_w: uni(8, 13) * total, bpm_sec: total,
        alerts: { slouch: int(3, 9), blink: int(1, 4), pause: int(1, 3), close: int(0, 3) } });
      for (let hh = 9; hh < 20; hh++) {
        const t = (total * 0.9) / 11, share = hh >= 14 && hh < 18 ? 0.45 : 0.18;
        d.hours[String(hh).padStart(2, "0")] = [t * share, t];
      }
      this.days[k] = d;
    }
    this.save();
  }
  clearDemo() { for (const k of Object.keys(this.days)) if (this.days[k].demo) delete this.days[k]; this.save(); }
}
