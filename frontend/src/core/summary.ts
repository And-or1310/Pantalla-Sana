// Port de summary.py (resumen con reglas locales) + cliente del servicio del equipo (IA opcional).
import type { DayStat, SlotStat, Summary } from "../lib/types";

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
const postureTime = (day: DayStat) => day.posture_sec ?? day.session_min * 60;
const postureAverage = (days: DayStat[]) => {
  const seconds = days.reduce((total, day) => total + postureTime(day), 0);
  if (!seconds) return mean(days.map((day) => day.posture_pct as number));
  return days.reduce((total, day) => total + (day.good_posture_sec ?? (day.posture_pct as number) * postureTime(day) / 100), 0) * 100 / seconds;
};

export function buildSummary(days: DayStat[], slots: SlotStat[]): Summary {
  const data = days.filter((d) => d.posture_pct !== null);
  if (!data.length)
    return { headline: "Aún no tengo datos suficientes", source: "local", points: ["Usa la app unos minutos con la cámara activa y vuelve aquí."],
      tips: [], goal: "Completa tu primera sesión de 10 minutos con buena postura." };
  const avg = postureAverage(data);
  const headline = avg >= 80 ? "Semana excelente para tu espalda" : avg >= 60 ? "Vas bien, con margen para mejorar" : "Tu espalda pidió más pausas esta semana";
  const minutes = days.reduce((total, day) => total + (day.session_sec ?? day.session_min * 60), 0) / 60;
  const points = [`Buena postura el ${avg.toFixed(0)}% del tiempo analizado, con ${minutes.toFixed(1)} min de seguimiento válido en ${days.filter((day) => (day.session_sec ?? day.session_min * 60) > 0).length} días.`];
  const tips: string[] = [];

  if (data.length >= 4) {
    const half = Math.floor(data.length / 2);
    const delta = postureAverage(data.slice(half)) - postureAverage(data.slice(0, half));
    points.push(delta >= 3 ? `Tu postura mejoró ${delta.toFixed(0)} puntos en la segunda mitad de la semana.`
      : delta <= -3 ? `Tu postura bajó ${(-delta).toFixed(0)} puntos en la segunda mitad de la semana.` : "Tu postura se mantuvo estable durante la semana.");
  }
  const known = slots.filter((s) => s.bad_pct !== null);
  if (known.length >= 2) {
    const worst = known.reduce((a, b) => ((b.bad_pct as number) > (a.bad_pct as number) ? b : a));
    if ((worst.bad_pct as number) >= 25) {
      points.push(`Te encorvas más ${SLOT_PHRASE[worst.name]} (${worst.bad_pct}% del tiempo).`);
      tips.push(`Por la mayor proporción de encorvamiento ${SLOT_PHRASE[worst.name]}, programa una pausa en esa franja.`);
    }
  }
  const bpms = days.map((d) => d.bpm_avg).filter((x): x is number => x !== null);
  if (bpms.length) {
    const b = mean(bpms);
    points.push(`Promedio de los días con datos de ojos: ${b.toFixed(0)} parpadeos por minuto.`);
    if (b < 10) tips.push(`Por el bajo parpadeo registrado, ${ALERT_TIPS.blink.charAt(0).toLowerCase() + ALERT_TIPS.blink.slice(1)}`);
  }
  const totals: Record<string, number> = {};
  for (const d of days) for (const [k, v] of Object.entries(d.alerts)) totals[k] = (totals[k] ?? 0) + (v as number);
  const ent = Object.entries(totals);
  if (ent.length) {
    const [top, cnt] = ent.reduce((a, b) => (b[1] > a[1] ? b : a));
    points.push(`El aviso más frecuente fue el de ${RULE_NAME[top] ?? top} (${cnt} veces).`);
    if (cnt >= 3 && ALERT_TIPS[top]) tips.push(`Por los ${cnt} avisos de ${RULE_NAME[top] ?? top}, ${ALERT_TIPS[top].charAt(0).toLowerCase() + ALERT_TIPS[top].slice(1)}`);
  }
  const target = avg >= 95 ? 100 : Math.min(100, Math.floor(avg / 5) * 5 + 5);
  const goal = avg >= 95 ? "¡Casi perfecto! Mantén tu rutina esta semana." : `Meta de la semana: llegar al ${target}% de buena postura (en el periodo analizado vas en ${avg.toFixed(0)}%).`;
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

export type SummaryAvailability = {
  available: boolean;
  retry_after: number;
};
export async function summaryAvailability(base: string): Promise<SummaryAvailability> {
  if (!base) throw new Error("El servicio de IA no está configurado");
  const response = await http(base.replace(/\/$/, "") + "/summary/status", {}, 8000);
  if (!response.ok) throw new Error("No se pudo comprobar la disponibilidad de la IA.");
  return response.json();
}

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
