// Port de test_engine.py: prueba el motor SIN cámara ni internet, con reloj simulado.  npm test
//LOS ERRORES- Son avisos del editor, no errores reales.
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };

const { Engine } = await import("../src/core/engine");
const { mergeSettings, DEFAULT_SETTINGS } = await import("../src/core/store");
const { buildSummary } = await import("../src/core/summary");

const GOOD = { hd: 1.0, cl: 0.2, tl: 0.02, roll: 0.03 };
const SLOUCH = { ...GOOD, hd: 0.55 };
const EAR = 0.3;
const events: any[] = [];
const kinds = () => events.map((e) => e.type);
function check(name: string, cond: boolean) { console.log(cond ? "  OK  " : "  FALLA", name); if (!cond) process.exit(1); }
function run(eng: any, raw: any, t0: number, secs: number, hz = 10) {
  for (let n = 0; n < secs * hz; n++) { const now = t0 + n / hz; eng.ingest(raw, EAR, now); eng.step(now); }
  return t0 + secs;
}

const eng = new Engine(false);
eng.updateSettings({ img_mode: "Sin imagen", snd_mode: "Pitido" });
eng.subscribe((e) => events.push(e));
let t = Date.now() / 1000;

console.log("1) Ajustes");
let threw = false; try { mergeSettings(DEFAULT_SETTINGS, { sens: "Inventado" as any }); } catch { threw = true; }
check("ajuste inválido se rechaza", threw);
check("hero inicial = BIENVENIDO con botón start", eng.snapshot(t).hero.button === "start");

console.log("2) Calibración");
eng.calibrate(t); t = run(eng, GOOD, t, 4);
check("calibrado", eng.snapshot(t).calibrated);
check("avisó '¡Listo!'", kinds().includes("toast"));

console.log("3) Postura buena 20 s: sin alertas");
events.length = 0; t = run(eng, GOOD, t, 20);
check("sin alertas", !kinds().includes("alert"));
check("mood happy", eng.snapshot(t).mood === "happy");

console.log("4) Me encorvo 10 s: un aviso de espalda con pitido");
events.length = 0; t = run(eng, SLOUCH, t, 10);
check("1 alerta de espalda", JSON.stringify(events.filter((e) => e.type === "alert").map((e) => e.rule)) === '["slouch"]');
check("sonó pitido", events.some((e) => e.type === "sound" && e.kind === "beep"));
check("mood sad o worried", ["sad", "worried"].includes(eng.snapshot(t).mood));

console.log("5) Me corrijo: +10 XP");
events.length = 0; t = run(eng, GOOD, t, 8);
const resc = events.filter((e) => e.type === "rescue");
check("evento rescue con +10 XP", resc.length === 1 && resc[0].xp === 10);
check("XP guardado", eng.prog.d.xp >= 10);

console.log("5b) Métricas");
const wk = eng.metrics.week(t).at(-1)!;
check("hoy tiene postura y 1 aviso de espalda", wk.posture_pct !== null && wk.alerts.slouch === 1);
check("% buena postura razonable (50-95)", wk.posture_pct! >= 50 && wk.posture_pct! <= 95);

console.log("5c) Semana de ejemplo y resumen");
eng.metrics.seedDemo(t);
const days = eng.metrics.week(t), slots = eng.metrics.slots(t), sm = buildSummary(days, slots);
check("7 días con postura y has_demo", days.every((d) => d.posture_pct !== null));
check("resumen con puntos y meta; la tarde es la peor franja", sm.points.length >= 3 && !!sm.goal && sm.points.some((p) => p.includes("tarde")));
eng.metrics.clearDemo();

console.log("6) Pausa");
eng.setPaused(true);
const snap = eng.snapshot(t);
check("pausado -> sleep y EN PAUSA", snap.mood === "sleep" && snap.hero.tag === "EN PAUSA");
console.log("\nTodo bien ✔");
