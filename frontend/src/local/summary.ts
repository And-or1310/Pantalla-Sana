// Port de summary.py (resumen con reglas locales) + cliente del servicio del equipo (IA opcional).
import type { DayStat, SlotStat, Summary } from "../types";

const SLOT_PHRASE: Record<string, string> = { madrugada: "de madrugada", mañana: "por la mañana", tarde: "por la tarde", noche: "por la noche" };
const ALERT_TIPS: Record<string, string> = {
  slouch: "Pon una alarma suave cada 30 minutos para revisar tu espalda.",
  close: "Aleja la pantalla a un brazo de distancia.",
  tilt: "Revisa que tu silla y tus brazos estén a la misma altura en ambos lados.",
  roll: "Sube un poco el monitor para que quede a la altura de tus ojos.",
  blink: "Prueba la regla 20-20-20: cada 20 min, mira algo a 6 m durante 20 s.",
  sleep: "Toma agua y haz una pausa corta; si es seguido, revisa cuánto duermes.",
  pause: "Haz una pausa de 5 minutos cada hora: ponte de pie y camina.",
};
const RULE_NAME: Record<string, string> = { slouch: "espalda", close: "distancia", tilt: "hombros", roll: "cabeza", blink: "parpadeo", sleep: "sueño", pause: "descansos" };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

export function buildSummary(days: DayStat[], slots: SlotStat[]): Summary {
  const data = days.filter((d) => d.posture_pct !== null);
  if (!data.length)
    return { headline: "Aún no tengo datos suficientes", source: "local", points: ["Usa la app unos minutos con la cámara activa y vuelve aquí."],
      tips: [], goal: "Completa tu primera sesión de 10 minutos con buena postura." };
  const pc = (d: DayStat) => d.posture_pct as number;
  const avg = mean(data.map(pc));
  const headline = avg >= 80 ? "Semana excelente para tu espalda" : avg >= 60 ? "Vas bien, con margen para mejorar" : "Tu espalda pidió más pausas esta semana";
  const points = [`Buena postura el ${avg.toFixed(0)}% del tiempo, con ${(days.reduce((a, d) => a + d.session_min, 0) / 60).toFixed(1)} h frente a la pantalla.`];
  const tips: string[] = [];

  if (data.length >= 4) {
    const half = Math.floor(data.length / 2);
    const delta = mean(data.slice(half).map(pc)) - mean(data.slice(0, half).map(pc));
    points.push(delta >= 3 ? `Tu postura mejoró ${delta.toFixed(0)} puntos en la segunda mitad de la semana.`
      : delta <= -3 ? `Tu postura bajó ${(-delta).toFixed(0)} puntos en la segunda mitad de la semana.` : "Tu postura se mantuvo estable durante la semana.");
  }
  const known = slots.filter((s) => s.bad_pct !== null);
  if (known.length >= 2) {
    const worst = known.reduce((a, b) => ((b.bad_pct as number) > (a.bad_pct as number) ? b : a));
    if ((worst.bad_pct as number) >= 25) {
      points.push(`Te encorvas más ${SLOT_PHRASE[worst.name]} (${worst.bad_pct}% del tiempo).`);
      tips.push(worst.name !== "madrugada" ? `Programa una pausa corta a media ${worst.name}.` : "Intenta no trabajar de madrugada: es cuando peor te sientas.");
    }
  }
  const bpms = days.map((d) => d.bpm_avg).filter((x): x is number => x !== null);
  if (bpms.length) {
    const b = mean(bpms);
    points.push(`Parpadeas unas ${b.toFixed(0)} veces por minuto` + (b < 10 ? " (es poco: lo normal es 12 a 20)." : "."));
    if (b < 10) tips.push(ALERT_TIPS.blink);
  }
  const totals: Record<string, number> = {};
  for (const d of days) for (const [k, v] of Object.entries(d.alerts)) totals[k] = (totals[k] ?? 0) + (v as number);
  const ent = Object.entries(totals);
  if (ent.length) {
    const [top, cnt] = ent.reduce((a, b) => (b[1] > a[1] ? b : a));
    points.push(`El aviso más frecuente fue el de ${RULE_NAME[top] ?? top} (${cnt} veces).`);
    if (cnt >= 3 && !tips.includes(ALERT_TIPS[top])) tips.push(ALERT_TIPS[top] ?? "");
  }
  const target = avg >= 95 ? 100 : Math.min(100, Math.floor(avg / 5) * 5 + 5);
  const goal = avg >= 95 ? "¡Casi perfecto! Mantén tu rutina esta semana." : `Meta de la semana: llegar al ${target}% de buena postura (hoy vas en ${avg.toFixed(0)}%).`;
  return { headline, points, tips: tips.filter(Boolean).slice(0, 3), goal, source: "local" };
}

/** Exactamente lo que recibiría la IA: solo agregados. Sin imágenes, sin fechas exactas, sin nombres. */
export function payloadForLlm(days: DayStat[], slots: SlotStat[]) {
  return {
    days: days.map((d) => ({ weekday: d.label, posture_pct: d.posture_pct, session_min: d.session_min, alerts: d.alerts, blinks_per_min: d.bpm_avg })),
    slouching_by_part_of_day: Object.fromEntries(slots.map((s) => [s.name, s.bad_pct])),
  };
}

// ------------------------------------------------------------------ servicio del equipo
async function http(url: string, init: RequestInit, ms: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(t); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pingProxy(base: string): Promise<number> {
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) throw new Error("La dirección del servicio no está configurada");
  const t0 = performance.now();
  try {
    const r = await http(base.replace(/\/$/, "") + "/health", {}, 60000);
    if (!r.ok || (await r.json()).ok !== true) throw new Error("Esa dirección no parece ser el servicio de Pantalla Sana");
  } catch (e) {
    throw e instanceof Error && e.message.startsWith("Esa") ? e : new Error("No pude conectar con el servicio (¿está dormido?)");
  }
  return Math.round(performance.now() - t0);
}

export async function summarizeViaProxy(base: string, payload: unknown): Promise<Omit<Summary, "source" | "note">> {
  if (!base) throw new Error("El servicio de IA no está configurado");
  let last = "No pude conectar con el servicio (¿está dormido?)";
  for (let i = 0; i < 3; i++) {                              // reintenta si el servicio estaba dormido o Gemini saturado
    try {
      const r = await http(base.replace(/\/$/, "") + "/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, 60000);
      if (r.ok) return (await r.json()) as Omit<Summary, "source" | "note">;
      const detail = (await r.json().catch(() => ({})) as { detail?: string }).detail;
      last = detail ?? `El servicio respondió con error ${r.status}`;
      if (![502, 503, 504].includes(r.status)) break;
    } catch { /* red o timeout: se reintenta */ }
    await sleep(2000);
  }
  throw new Error(last);
}
