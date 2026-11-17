// Port de test_engine.py: prueba el motor SIN cámara ni internet, con reloj simulado.  npm test
//LOS ERRORES- Son avisos del editor, no errores reales.
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };

const { Engine } = await import("../src/core/engine");
const { dayKey, mergeSettings, DEFAULT_SETTINGS, Metrics, Progress } = await import("../src/core/store");
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

console.log("7) Configuración de cámara y presencia");
const monitored = new Engine(true, () => t);
const opened: string[] = [];
let stopped = 0;
monitored.vision.start = async (id, _onFrame, onReady) => { opened.push(id); onReady(); };
monitored.vision.stop = () => { stopped++; };
monitored.setPaused(true);
monitored.configureCamera("usb");
check("la vista previa usa el dispositivo elegido", opened.at(-1) === "usb" && monitored.snapshot().camera_on);
check("cámara tapada bloquea la calibración", !monitored.calibrate());
t = run(monitored, GOOD, t, 1);
check("la vista previa no registra tiempo", monitored.snapshot().session_sec === 0);
check("presencia estable habilita la calibración", monitored.calibrate());
monitored.ingest({}, null, t);
monitored.step(t);
check("perder la imagen interrumpe la calibración", monitored.snapshot().calibration_failed && !monitored.snapshot().calibrated);
t = run(monitored, GOOD, t + 0.1, 1);
check("se puede reintentar al regresar", monitored.calibrate());
t = run(monitored, GOOD, t, 5);
check("calibración válida activa el seguimiento", monitored.snapshot().calibrated && monitored.snapshot().session_sec > 0);
let seconds = monitored.snapshot().session_sec;
const offscreen = t + 30;
for (; t < offscreen; t += 0.1) {
  monitored.ingest({}, null, t);
  monitored.step(t);
}
check("fuera de cuadro se detiene el registro y queda la cámara encendida",
  monitored.snapshot().session_sec === seconds && monitored.snapshot().camera_on && monitored.snapshot().hero.tag === "TE BUSCO");
t = run(monitored, GOOD, t, 2);
check("las métricas se reanudan al regresar", monitored.snapshot().session_sec > seconds);
monitored.configureCamera("integrada");
check("cambiar de cámara exige calibrar de nuevo", opened.at(-1) === "integrada" && !monitored.snapshot().calibrated);
monitored.setPaused(true);
seconds = monitored.snapshot().session_sec;
t = run(monitored, GOOD, t, 2);
check("pausar o aplazar libera la cámara y bloquea el registro",
  stopped > 0 && !monitored.snapshot().camera_on && monitored.snapshot().session_sec === seconds);

console.log("8) Historial privado e importación");
const guest = new Metrics();
const accountHistory = new Metrics(false);
guest.seedDemo(t);
const localBefore = mem.get("ps.metrics");
const day = dayKey(t);
const localDays = guest.realDays();
check("la importación excluye los datos de ejemplo", Object.keys(localDays).length < Object.keys(guest.days).length);
check("la cuenta empieza con historial separado", Object.keys(accountHistory.days).length === 0);
const morning = new Metrics(false);
const afternoon = new Metrics(false);
morning.record(t, 40 * 60, true, false, 12);
afternoon.record(t, 25 * 60, true, true, 8);
accountHistory.replaceSyncedDays([
  { day, metrics: morning.realDays()[day] },
  { day, metrics: afternoon.realDays()[day] },
]);
const combined = accountHistory.week(t).at(-1)!;
check("une dos sesiones y calcula porcentajes por tiempo", combined.session_min === 65 &&
  combined.posture_pct === 62 && combined.bpm_avg === 10.5);
accountHistory.save(t);
check("guardar la cuenta no sobrescribe el historial de invitado", mem.get("ps.metrics") === localBefore);

const guestProgress = mem.get("ps.progress");
const player = new Progress(false);
player.good(35);
const restoredPlayer = new Progress(false, structuredClone(player.snapshot()));
restoredPlayer.good(25);
restoredPlayer.save();
check("el XP parcial continúa al restaurar el perfil de otro equipo", restoredPlayer.d.xp === 1);
check("guardar el progreso de cuenta no sobrescribe el álbum local", mem.get("ps.progress") === guestProgress);
console.log("\nTodo bien ✔");
