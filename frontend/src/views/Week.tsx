import { Lightbulb, LockKeyhole, Sparkles, Target } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { account } from "../core/account";
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

function AICard({ ai, busy, onProvider, onRun }: { ai: AIStatus; busy: boolean; onProvider: (p: Prov) => void; onRun: () => void }) {
  const [ping, setPing] = useState<string>("");
  const on = ai.provider === "proxy";
  return (
    <section className="card ai-card">
      <h3><Sparkles aria-hidden="true" /> Redactar con IA <span className="badge">opcional · apagada por defecto</span></h3>
      <p className="muted small">Elige cómo se redacta el resumen de la semana. Para usar IA, selecciona «Con IA» y pulsa «Mejorar con IA».</p>
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
      <button className="btn primary" disabled={!on || busy} onClick={onRun}>{busy ? "Redactando…" : <><Sparkles aria-hidden="true" /> Mejorar con IA</>}</button>
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
  const [payload, setPayload] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState(false);
  const [ai, setAi] = useState<AIStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((resetAi = true) => {
    Promise.all([api<WeekResponse>("/week"), api<Summary>("/summary"), api<SummaryPayload>("/summary/payload"), api<AIStatus>("/ai")])
      .then(([w, s, p, a]) => { setWeek(w); setLocalSummary(s); if (resetAi) setAiSummary(null); setPayload(p); setAi(a); setError(false); })
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    if (!signedIn) { load(); return; }
    let active = true;
    const refresh = (initial = false) => {
      void account.refreshHistory().then(() => { if (active) load(initial); }).catch(() => { if (active) setError(true); });
    };
    refresh(true);
    const timer = window.setInterval(refresh, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [load, revision, signedIn]);

  const toggleDemo = () => api("/week/demo", week?.has_demo ? "DELETE" : "POST").then(() => load()).catch(() => setError(true));

  const refreshAi = () => api<AIStatus>("/ai").then(setAi).catch(() => setError(true));
  const setProvider = (p: Prov) => api("/settings", "PUT", { ai_provider: p }).then(refreshAi).catch(() => setError(true));
  const runAi = () => { setBusy(true); api<Summary>("/summary/ai", "POST").then(setAiSummary).catch(() => setError(true)).finally(() => setBusy(false)); };

  const sum = (ai?.provider === "proxy" && aiSummary) || localSummary;
  if (error && !week) return <p className="loading">No pude cargar tu semana. {signedIn ? "Revisa tu conexión con Supabase." : "Vuelve a intentarlo."}</p>;
  if (!week || !sum) return <p className="loading">Cargando tu semana…</p>;

  return (
    <main className="page week-page">
      <div className="page-head">
        <div><h2>Mi semana</h2><p className="muted">Tus hábitos de los últimos 7 días</p></div>
        <button className="btn" disabled={busy} onClick={toggleDemo}>{week.has_demo ? "Quitar datos de ejemplo" : "Cargar datos de ejemplo"}</button>
      </div>
      {error && <p className="notice" role="status">No se pudo actualizar el historial. Mostramos la última versión disponible.</p>}
      {week.has_demo && <p className="notice" role="status">Estás viendo <b>datos de ejemplo</b> para la demostración. Se reemplazan solos con tus datos reales.</p>}

      <div className="week-overview">
        {ai && <AICard key={ai.provider} ai={ai} busy={busy} onProvider={setProvider} onRun={runAi} />}
        <section className="card summary" aria-live="polite" aria-busy={busy}>
        <small className="label">{sum.source === "local" ? "Resumen de la semana · generado en tu equipo" : `Redactado por ${PROV_NAME[sum.source]} con tus números agregados`}</small>
        <h3>{sum.headline}</h3>
        <ul>{sum.points.map((p) => <li key={p}>{p}</li>)}</ul>
        {sum.tips.length > 0 && (<><small className="label">Para esta semana</small>
          <ul className="tips">{sum.tips.map((t) => <li key={t}><Lightbulb aria-hidden="true" /> {t}</li>)}</ul></>)}
        <p className="goal"><Target aria-hidden="true" /> {sum.goal}</p>
        {sum.note && <p className="notice" role="status">{sum.note}</p>}
        {sum.source !== "local" && <button className="btn" disabled={busy} onClick={() => setProvider("local")}>Volver al resumen local</button>}
        </section>
      </div>

      <div className="charts">
        <Bars title="Buena postura por día (%)" max={100} unit="%" tone={postureTone}
          data={week.days.map((d) => ({ label: d.label, value: d.posture_pct }))} />
        <Bars title="Avisos por día" max={Math.max(5, ...week.days.map((d) => d.alerts_total))} unit=" avisos"
          data={week.days.map((d) => ({ label: d.label, value: d.session_min > 0 ? d.alerts_total : null }))} />
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
    </main>
  );
}
