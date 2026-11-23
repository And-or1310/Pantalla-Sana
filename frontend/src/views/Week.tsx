import { Lightbulb, LockKeyhole, Sparkles, Target } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { account } from "../core/account";
import { reportCanRefresh, reportFingerprint, REPORT_INTERVAL_MS, type SavedReport } from "../core/reports";
import type { AIStatus, PingResult, Summary, SummaryPayload, WeekResponse } from "../lib/types";

type Bar = { label: string; value: number | null; note?: string };

/** Gráfica de barras en SVG (sin librerías). Las barras sin dato se muestran vacías, con "–". */
function Bars({ title, data, max, unit, tone }: { title: string; data: Bar[]; max: number; unit: string; tone?: (v: number) => string }) {
  const W = 420, H = 190, pad = 26, bw = (W - pad * 2) / data.length;
  const text = data.map((d) => `${d.label}: ${d.value === null ? "sin datos" : d.value + unit}`).join(", ");
  return (
    <section className="card">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${text}`} className="chart">
        <line x1={pad} x2={W - pad} y1={H - 30} y2={H - 30} className="axis" />
        {data.map((d, i) => {
          const x = pad + i * bw + bw * 0.18, w = bw * 0.64;
          const h = d.value === null ? 0 : Math.max(3, (d.value / max) * (H - 70));
          return (
            <g key={d.label}>
              {d.value !== null && <rect x={x} y={H - 30 - h} width={w} height={h} rx="6" className={`bar ${tone ? tone(d.value) : ""}`} />}
              <text x={x + w / 2} y={d.value === null ? H - 36 : H - 36 - h} className="val" textAnchor="middle">{d.value === null ? "–" : d.value}</text>
              <text x={x + w / 2} y={H - 10} className="lbl" textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

type Prov = AIStatus["provider"];
const PROV_NAME: Record<string, string> = { local: "tu navegador", proxy: "el servicio de IA del equipo" };
type Availability = { available: boolean; retryAt: number; report: SavedReport | null; error: string };

function AICard({ ai, busy, canGenerate, remainingSeconds, serviceMessage, demo, onProvider, onRun }: {
  ai: AIStatus; busy: boolean; canGenerate: boolean; remainingSeconds: number; serviceMessage: string; demo: boolean;
  onProvider: (p: Prov) => void; onRun: () => void;
}) {
  const [ping, setPing] = useState<string>("");
  const on = ai.provider === "proxy";
  const wait = remainingSeconds >= 60 ? `${Math.ceil(remainingSeconds / 60)} min` : `${remainingSeconds} s`;
  return (
    <section className="card ai-card">
      <h3><Sparkles aria-hidden="true" /> Redactar con IA <span className="badge">opcional</span></h3>
      <p className="muted small">El resumen local aplica reglas a tus métricas. La IA selecciona hallazgos y propone hábitos según tus resultados. Selecciona «Con IA» y pulsa «Mejorar con IA».</p>
      <div className="seg" role="radiogroup" aria-label="Redacción del resumen">
        {([["local", "Sin IA (local)"], ["proxy", "Con IA"]] as [Prov, string][]).map(([v, n]) => (
          <button key={v} role="radio" aria-checked={ai.provider === v} className={ai.provider === v ? "on" : ""} disabled={busy} onClick={() => onProvider(v)}>{n}</button>
        ))}
      </div>
      {on && (
        <div className="row">
          <button className="btn" disabled={!ai.proxy_url} onClick={() => {
            setPing("Probando… (si estaba dormido, puede tardar hasta 45 s)");
            api<PingResult>("/ai/ping", "POST").then((r) => setPing(r.ok ? `✓ El servicio responde (${r.ms} ms). Ya está despierto.` : `✗ ${r.error ?? "No respondió"}`))
              .catch(() => setPing("✗ No pude hacer la prueba"));
          }}>Probar conexión</button>
          {ping && <small role="status" className={ping.startsWith("✓") ? "ok-txt" : "muted"}>{ping}</small>}
        </div>
      )}
      {on && <button className="btn primary" disabled={busy || !canGenerate} onClick={onRun}>
        {busy ? "Redactando…" : !canGenerate ? remainingSeconds > 0 ? `Disponible en ${wait}` : serviceMessage ? "IA no disponible" : "Resumen actualizado" : <><Sparkles aria-hidden="true" /> {demo ? "Mejorar ejemplo con IA" : "Mejorar con IA"}</>}
      </button>}
      {on && <p className="muted small" role="status">{serviceMessage ||
        (remainingSeconds > 0 ? `Podrás solicitar otra lectura en ${wait}, si hay datos nuevos.` : "La lectura local se actualiza automáticamente.")}</p>}
      {on && <p className="muted small">Al pulsar, se enviarán a <b>{PROV_NAME.proxy}</b> únicamente los números del cuadro de privacidad.
        Si falla o no hay internet, verás el resumen local.</p>}
    </section>
  );
}

const postureTone = (v: number) => (v >= 75 ? "ok" : v >= 55 ? "warn" : "bad");

export default function Week({ revision, signedIn }: { revision: number; signedIn: boolean }) {
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [localSummary, setLocalSummary] = useState<Summary | null>(null);
  const [aiSummary, setAiSummary] = useState<Summary | null>(null);
  const [report, setReport] = useState<SavedReport | null>(null);
  const [payload, setPayload] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState(false);
  const [ai, setAi] = useState<AIStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [generationNote, setGenerationNote] = useState("");
  const [localUpdatedAt, setLocalUpdatedAt] = useState<number | null>(null);
  const availabilityRequest = useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(() => {
    Promise.all([api<WeekResponse>("/week"), api<Summary>("/summary"), api<SummaryPayload>("/summary/payload"),
      api<AIStatus>("/ai"), api<SavedReport | null>("/summary/ai")])
      .then(([w, s, p, a, saved]) => {
        setWeek(w); setLocalSummary(s); setAiSummary(saved?.summary ?? null); setReport(saved);
        setLocalUpdatedAt(Date.now()); setNow(Date.now());
        setPayload(p); setAi(a); setError(false);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const history = signedIn ? account.refreshHistory() : Promise.resolve();
      void history.then(() => { if (active) load(); }).catch(() => { if (active) setError(true); });
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [load, revision, signedIn]);
  useEffect(() => {
    if (ai?.provider !== "proxy") { setAvailability(null); return; }
    let active = true;
    const refresh = () => {
      const request = ++availabilityRequest.current;
      void api<Availability | null>("/ai/availability").then((status) => {
        if (active && request === availabilityRequest.current) {
          setAvailability(status);
          setNow(Date.now());
        }
      }).catch(() => {
        if (active && request === availabilityRequest.current) setAvailability({ available: false, retryAt: 0, report: null, error: "No se pudo comprobar la disponibilidad de IA." });
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => { active = false; ++availabilityRequest.current; window.clearInterval(timer); };
  }, [ai?.provider]);

  const toggleDemo = () => api("/week/demo", week?.has_demo ? "DELETE" : "POST").then(() => {
    setGenerationNote(""); load();
  }).catch(() => setError(true));

  const refreshAi = () => api<AIStatus>("/ai").then(setAi).catch(() => setError(true));
  const setProvider = (p: Prov) => {
    setGenerationNote("");
    void api("/settings", "PUT", { ai_provider: p }).then(() => { void refreshAi(); load(); }).catch(() => setError(true));
  };
  const runAi = () => {
    setBusy(true);
    api<Summary>("/summary/ai", "POST").then(async (summary) => {
      if (summary.source === "proxy") {
        setAiSummary(summary);
      }
      setGenerationNote(summary.note ?? "");
      const request = ++availabilityRequest.current;
      const status = await api<Availability | null>("/ai/availability");
      if (request === availabilityRequest.current) setAvailability(status);
      setReport(status?.report ?? await api<SavedReport | null>("/summary/ai"));
      setNow(Date.now());
    }).catch(() => setError(true)).finally(() => setBusy(false));
  };

  const sum = (ai?.provider === "proxy" && aiSummary) || localSummary;
  if (error && !week) return <p className="loading">No pude cargar tu semana. {signedIn ? "Revisa tu conexión con Supabase." : "Vuelve a intentarlo."}</p>;
  if (!week || !sum) return <p className="loading">Cargando tu semana…</p>;
  const minutes = week.days.reduce((total, day) => total + (day.session_sec ?? day.session_min * 60), 0) / 60;
  const recordedDays = week.days.filter((day) => (day.session_sec ?? day.session_min * 60) > 0).length;
  const staleReport = report && reportCanRefresh(report, reportFingerprint(week.days.map((day) => day.date), payload?.payload), now);
  const readyAt = Math.max(report ? report.createdAt + REPORT_INTERVAL_MS : 0, availability?.retryAt ?? 0);
  const remainingSeconds = Math.max(0, Math.ceil((readyAt - now) / 1000));
  const serviceMessage = availability?.error ?? (!availability && ai?.provider === "proxy" ? "Comprobando disponibilidad de IA…" : "");
  const canGenerate = !serviceMessage && remainingSeconds === 0 && (!report || !!staleReport);

  return (
    <main className="page week-page">
      <div className="page-head">
        <div><h2>Mi semana</h2><p className="muted">Tus hábitos de los últimos 7 días</p></div>
        {week.has_demo && <button className="btn" disabled={busy} onClick={toggleDemo}>Quitar datos de ejemplo</button>}
      </div>
      {error && <p className="notice" role="status">No se pudo actualizar el historial. Mostramos la última versión disponible.</p>}
      <p className="notice">{minutes.toFixed(1)} min {week.has_demo ? "mostrados, incluidos días de ejemplo," : "de seguimiento válido"} en {recordedDays} de {week.days.length} días.
        {" "}Los días sin datos suficientes aparecen vacíos.</p>
      {week.has_demo && <p className="notice" role="status">Este resumen y las gráficas <b>incluyen datos de ejemplo</b> en los días sin registros.
        {" "}Pulsa «Quitar datos de ejemplo» para ver únicamente tu historial real.</p>}
      <div className="week-overview">
        {ai && <AICard key={ai.provider} ai={ai} busy={busy} canGenerate={canGenerate}
          remainingSeconds={remainingSeconds} serviceMessage={serviceMessage} demo={week.has_demo} onProvider={setProvider} onRun={runAi} />}
        <section className="card summary" aria-live="polite" aria-busy={busy}>
        <small className="label">{sum.source === "local" ? "Resumen de la semana · generado en tu equipo" : `Redactado por ${PROV_NAME[sum.source]} con tus números agregados`}</small>
        <h3>{sum.headline}</h3>
        {sum.source === "local" && localUpdatedAt && <p className="muted small">
          Actualizado a las {new Date(localUpdatedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.
          {" "}Se recalcula cada diez segundos mientras esta pantalla está abierta.
        </p>}
        {sum.source !== "local" && report && <p className="muted small">
          Generado el {new Date(report.createdAt).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.
          {staleReport && " Hay datos nuevos. Puedes generar otra lectura con Mejorar con IA."}
        </p>}
        <ul>{sum.points.map((p) => <li key={p}>{p}</li>)}</ul>
        {sum.tips.length > 0 && (<><small className="label">Para esta semana</small>
          <ul className="tips">{sum.tips.map((t) => <li key={t}><Lightbulb aria-hidden="true" /> {t}</li>)}</ul></>)}
        <p className="goal"><Target aria-hidden="true" /> {sum.goal}</p>
        {(generationNote || sum.note) && <p className="notice" role="status">{generationNote || sum.note}</p>}
        {sum.source !== "local" && <button className="btn" disabled={busy} onClick={() => setProvider("local")}>Volver al resumen local</button>}
        </section>
      </div>

      <div className="charts">
        <Bars title="Buena postura por día (%)" max={100} unit="%" tone={postureTone}
          data={week.days.map((d) => ({ label: d.label, value: d.posture_pct }))} />
        <Bars title="Avisos por día" max={Math.max(5, ...week.days.map((d) => d.alerts_total))} unit=" avisos"
          data={week.days.map((d) => ({ label: d.label, value: (d.session_sec ?? d.session_min * 60) > 0 ? d.alerts_total : null }))} />
        <Bars title="¿Cuándo te encorvas? (% del tiempo)" max={100} unit="%" tone={(v) => (v >= 35 ? "bad" : v >= 20 ? "warn" : "ok")}
          data={week.slots.map((s) => ({ label: s.name, value: s.bad_pct }))} />
      </div>
      <details className="card week-extra-chart">
        <summary>Ver gráfica de parpadeos</summary>
        <Bars title="Parpadeos por minuto" max={20} unit=" por min" tone={(v) => (v >= 10 ? "ok" : "warn")}
          data={week.days.map((d) => ({ label: d.label, value: d.bpm_avg === null ? null : Math.round(d.bpm_avg) }))} />
      </details>

      <details className="card privacy-box">
        <summary><LockKeyhole aria-hidden="true" /> Ver exactamente qué datos usa este resumen</summary>
        <p className="muted small">El resumen local se calcula en tu navegador. {signedIn && "Tu cuenta sincroniza métricas numéricas para mostrar tu historial en otros equipos. "}
          Si usas la IA opcional, recibirá los datos de este cuadro: números agregados, sin imágenes,
          sin fechas exactas ni tu nombre.</p>
        <pre>{JSON.stringify(payload?.payload, null, 2)}</pre>
      </details>
      {!week.has_demo && <details className="card">
        <summary>Datos de demostración</summary>
        <p>Rellena los días sin registros con ejemplos para probar las gráficas. Tus días reales se conservan.</p>
        <button className="btn" disabled={busy} onClick={toggleDemo}>Cargar datos de ejemplo</button>
      </details>}
    </main>
  );
}
