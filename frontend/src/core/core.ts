// Port de core.py: lógica pura (sin cámara, sin red, sin DOM). Los tiempos van en SEGUNDOS.
export type Key = "hd" | "cl" | "tl" | "roll";
export const KEYS: Key[] = ["hd", "cl", "tl", "roll"];
export type Raw = Partial<Record<Key, number | null>>;
export type Baseline = Record<Key, number | null>;
export interface Lm { x: number; y: number; visibility?: number }

export interface Vals {
  hd: number | null; cl: number | null; tl: number | null; roll: number | null;
  bpm: number | null; closed_ratio: number | null; work_min: number; demo: boolean;
}

export const LEVEL_NAMES = ["Tranquilo", "Normal", "Atento"] as const;
export const SENS_TIME = [1.5, 1.0, 0.7];
export const GRACE = 2.0;
export const RESCUE_WINDOW = 25;
export const CAL_START = 1.2;
export const CAL_END = 3.7;
export const LEFT_EYE = [33, 160, 158, 133, 153, 144];
export const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

export interface Rule {
  key: string; group: string; name: string; base: boolean; inputs: (keyof Vals)[]; sec: number; cd: number;
  hint: string; msg: string; cond: (v: Vals, b: Baseline, L: number) => boolean;
}
const n = (x: number | null) => x as number;

export const RULES: Rule[] = [
  { key: "slouch", group: "posture", name: "Espalda", base: true, inputs: ["hd"], sec: 6, cd: 45,
    hint: "Te estás encorvando un poco", msg: "¡Endereza la espalda!",
    cond: (v, b, L) => n(v.hd) < n(b.hd) * [0.70, 0.80, 0.88][L] },
  { key: "close", group: "close", name: "Distancia", base: true, inputs: ["cl"], sec: 5, cd: 60,
    hint: "Estás muy cerca de la pantalla", msg: "Aléjate un poquito de la pantalla",
    cond: (v, b, L) => n(v.cl) > n(b.cl) * [1.40, 1.25, 1.12][L] },
  { key: "tilt", group: "posture", name: "Hombros", base: true, inputs: ["tl"], sec: 8, cd: 60,
    hint: "Un hombro está más alto que el otro", msg: "Nivela tus hombros",
    cond: (v, b, L) => n(v.tl) > n(b.tl) + [0.12, 0.08, 0.05][L] },
  { key: "roll", group: "posture", name: "Cabeza", base: true, inputs: ["roll"], sec: 8, cd: 60,
    hint: "Tu cabeza se está ladeando", msg: "Endereza la cabeza",
    cond: (v, b, L) => n(v.roll) > n(b.roll) + [0.30, 0.20, 0.12][L] },
  { key: "blink", group: "blink", name: "Parpadeo", base: false, inputs: ["bpm"], sec: 5, cd: 120,
    hint: "Estás parpadeando poco", msg: "Parpadea y descansa la vista",
    cond: (v, _b, L) => n(v.bpm) < [6, 8, 11][L] },
  { key: "sleep", group: "sleep", name: "Sueño", base: false, inputs: ["closed_ratio"], sec: 1, cd: 30,
    hint: "Tus ojos se están cerrando", msg: "¡Despierta!",
    cond: (v, _b, L) => n(v.closed_ratio) >= [0.90, 0.80, 0.65][L] },
  { key: "pause", group: "pause", name: "Descanso", base: false, inputs: [], sec: 1, cd: 300,
    hint: "Llevas mucho rato sentado", msg: "Hora de descansar: mira algo lejano 20 segundos",
    cond: (v, _b, L) => v.work_min >= (v.demo ? 0.5 : [30, 20, 15][L]) },
];
export const POSTURE_KEYS = new Set(["slouch", "close", "tilt", "roll"]);

export interface Hold { since: number | null; lastTrue: number; lastFire: number }
export const newHold = (): Hold => ({ since: null, lastTrue: 0, lastFire: -1e9 });

/** Contador con tolerancia: la condición puede fallar `grace` s sin reiniciar. */
export function holdStep(st: Hold, cond: boolean, now: number, need: number, cd: number, grace = GRACE) {
  if (cond) {
    if (st.since === null) st.since = now;
    st.lastTrue = now;
  } else if (st.since !== null && now - st.lastTrue > grace) st.since = null;
  return cond && st.since !== null && now - st.since >= need && now - st.lastFire >= cd;
}

export type SoundKind = "beep" | "file" | "cry" | "voice";
/** UNA sola función decide cómo se ve y suena CUALQUIER alerta. */
export function planAlert(key: string, imgMode: string, sndMode: string, hasImg: boolean, hasSnd: boolean) {
  const card: "user" | "text" | "pack" = imgMode === "Mi imagen" && hasImg ? "user"
    : imgMode === "Mi imagen" || imgMode === "Sin imagen" ? "text" : "pack";
  let sound: SoundKind | null;
  if (sndMode === "Silencio") sound = null;
  else if (sndMode === "Mi sonido" && hasSnd) sound = "file";
  else if (sndMode === "Grito Pokémon") sound = "cry";
  else if (sndMode === "Voz") sound = "voice";
  else sound = "beep";
  return { card, sound, fetch: card === "pack" || sound === "cry", repeat: key === "sleep" && sound === "beep" ? 3 : 1 };
}

function percentile(vals: number[], p: number) {
  const a = [...vals].sort((x, y) => x - y);
  const idx = (a.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** Suaviza señales, detecta ojos (umbral adaptativo + histéresis) y mide tiempos. */
export class Tracker {
  ema: Partial<Record<Key, number>> = {};
  seen: Partial<Record<Key, number>> = {};
  earBuf: number[] = [];
  earHist: [number, number][] = [];
  closed: boolean | null = null;
  closedSince: number | null = null;
  blinks: number[] = [];
  closedHist: [number, number][] = [];
  faceSeen = 0; faceSeconds = 0; lastFeed: number | null = null;
  lastPresent: number; workStart: number;
  lastEar: number | null = null;

  constructor(now: number) { this.lastPresent = now; this.workStart = now; }

  thresholds(): [number, number] {
    const ref = this.earHist.length >= 30 ? percentile(this.earHist.map((x) => x[1]), 0.85) : 0.27;
    return [0.70 * ref, 0.80 * ref];
  }

  feed(raw: Raw, earV: number | null, now: number) {
    const dt = this.lastFeed === null ? 0 : Math.min(0.5, now - this.lastFeed);
    this.lastFeed = now;
    let present = false;
    for (const k of KEYS) {
      const x = raw[k];
      if (x !== null && x !== undefined) {
        const cur = this.ema[k];
        this.ema[k] = cur === undefined ? x : cur + 0.2 * (x - cur);
        this.seen[k] = now;
        present = true;
      }
    }
    if (earV !== null) {
      present = true;
      this.faceSeen = now;
      this.faceSeconds += dt;
      this.earBuf.push(earV);
      if (this.earBuf.length > 3) this.earBuf.shift();
      const e = this.earBuf.reduce((a, b) => a + b, 0) / this.earBuf.length;
      this.lastEar = e;
      this.earHist.push([now, e]);
      while (this.earHist.length && now - this.earHist[0][0] > 90) this.earHist.shift();
      const [thrClose, thrOpen] = this.thresholds();
      const prev = !!this.closed;
      const nc = e < thrClose ? true : e > thrOpen ? false : prev;
      if (nc && !prev) this.closedSince = now;
      if (prev && !nc && this.closedSince !== null) {
        const d = now - this.closedSince;
        if (d >= 0.04 && d <= 0.7) this.blinks.push(now);
      }
      this.closed = nc;
      this.closedHist.push([now, nc ? 1 : 0]);
      while (this.closedHist.length && now - this.closedHist[0][0] > 3) this.closedHist.shift();
      while (this.blinks.length && now - this.blinks[0] > 120) this.blinks.shift();
    }
    if (present) this.lastPresent = now;
  }

  values(now: number, demo = false): Vals {
    const g = (k: Key) => { const s = this.seen[k]; return s !== undefined && now - s <= 1.5 ? (this.ema[k] ?? null) : null; };
    if (now - this.lastPresent > 20) this.workStart = now;
    const faceOk = now - this.faceSeen <= 1.5;
    let ratio: number | null = null;
    if (faceOk && this.closedHist.length >= 10 && now - this.closedHist[0][0] >= 2.0)
      ratio = this.closedHist.reduce((a, x) => a + x[1], 0) / this.closedHist.length;
    let bpm: number | null = null;
    if (this.faceSeconds >= 30) {
      const cnt = this.blinks.filter((t) => now - t <= 60).length;
      bpm = (cnt * 60) / Math.min(60, this.faceSeconds);
    }
    return { hd: g("hd"), cl: g("cl"), tl: g("tl"), roll: g("roll"), bpm, closed_ratio: ratio,
      work_min: (now - this.workStart) / 60, demo };
  }
}

export function earValue(lm: Lm[], idx: number[], w: number, h: number) {
  const p = idx.map((i) => [lm[i].x * w, lm[i].y * h]);
  const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return (d(p[1], p[5]) + d(p[2], p[4])) / (2 * d(p[0], p[3]) + 1e-6);
}

export function poseRaw(lm: Lm[]): Raw {
  const vis = (i: number) => (lm[i]?.visibility ?? 0) >= 0.5;
  const out: Raw = { hd: null, cl: null, tl: null, roll: null };
  if (vis(11) && vis(12)) {
    const ls = lm[11], rs = lm[12];
    const sw = Math.abs(ls.x - rs.x);
    if (sw > 0.05) {
      out.tl = Math.abs(ls.y - rs.y) / sw;
      if (vis(0)) out.hd = ((ls.y + rs.y) / 2 - lm[0].y) / sw;
    }
  }
  if (vis(7) && vis(8)) {
    const le = lm[7], re = lm[8];
    const ew = Math.abs(le.x - re.x);
    out.cl = ew;
    if (ew > 0.02) out.roll = Math.abs(le.y - re.y) / ew;
  }
  return out;
}
