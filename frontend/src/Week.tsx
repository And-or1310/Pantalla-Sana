import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { AIStatus, PingResult, Summary, SummaryPayload, WeekResponse } from "./types";

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
      <h3>✨ Redactar con IA <span className="badge">opcional · apagada por defecto</span></h3>
      <p className="muted small">El resumen de arriba ya funciona sin IA y sin internet. Si quieres que una IA lo redacte mejor, actívala.
        No necesitas ninguna clave. Solo recibe los números del cuadro «Ver exactamente qué datos usa este resumen».</p>
      <div className="seg" role="radiogroup" aria-label="Redacción del resumen">
        {([["local", "Sin IA (local)"], ["proxy", "Con IA"]] as [Prov, string][]).map(([v, n]) => (
          <button key={v} role="radio" aria-checked={ai.provider === v} className={ai.provider === v ? "on" : ""} onClick={() => onProvider(v)}>{n}</button>
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
      <button className="btn primary" disabled={!on || busy} onClick={onRun}>{busy ? "Redactando…" : "✨ Mejorar con IA"}</button>
      {on && <p className="muted small">Al pulsar, se enviarán a <b>{PROV_NAME.proxy}</b> únicamente los números del cuadro de privacidad.
        Si falla o no hay internet, verás el resumen local.</p>}
    </section>
  );
}

const postureTone = (v: number) => (v >= 75 ? "ok" : v >= 55 ? "warn" : "bad");

export default function Week() {
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [payload, setPayload] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState(false);
  const [ai, setAi] = useState<AIStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api<WeekResponse>("/week"), api<Summary>("/summary"), api<SummaryPayload>("/summary/payload"), api<AIStatus>("/ai")])
      .then(([w, s, p, a]) => { setWeek(w); setSum(s); setPayload(p); setAi(a); setError(false); })
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  const toggleDemo = () => api("/week/demo", week?.has_demo ? "DELETE" : "POST").then(load).catch(() => setError(true));

  const refreshAi = () => api<AIStatus>("/ai").then(setAi).catch(() => setError(true));
  const setProvider = (p: Prov) => api("/settings", "PUT", { ai_provider: p }).then(refreshAi).catch(() => setError(true));
  const runAi = () => { setBusy(true); api<Summary>("/summary/ai", "POST").then(setSum).catch(() => setError(true)).finally(() => setBusy(false)); };

  if (error) return <p className="loading">No pude cargar tu semana. ¿Sigue abierto el servidor?</p>;
  if (!week || !sum) return <p className="loading">Cargando tu semana…</p>;

  return (
    <main className="page">
      <div className="page-head">
        <div><h2>Mi semana</h2><p className="muted">Tus hábitos de los últimos 7 días</p></div>
        <button className="btn" onClick={toggleDemo}>{week.has_demo ? "Quitar datos de ejemplo" : "Cargar datos de ejemplo"}</button>
      </div>
      {week.has_demo && <p className="notice" role="status">Estás viendo <b>datos de ejemplo</b> para la demostración. Se reemplazan solos con tus datos reales.</p>}

      <section className="card summary">
        <small className="label">{sum.source === "local" ? "Resumen de la semana · generado en tu equipo" : `Redactado por ${PROV_NAME[sum.source]} con tus números agregados`}</small>
        <h3>{sum.headline}</h3>
        <ul>{sum.points.map((p) => <li key={p}>{p}</li>)}</ul>
        {sum.tips.length > 0 && (<><small className="label">Para esta semana</small>
          <ul className="tips">{sum.tips.map((t) => <li key={t}>💡 {t}</li>)}</ul></>)}
        <p className="goal">🎯 {sum.goal}</p>
        {sum.note && <p className="notice" role="status">{sum.note}</p>}
        {sum.source !== "local" && <button className="btn" onClick={load}>Volver al resumen local</button>}
      </section>
      {ai && <AICard key={ai.provider} ai={ai} busy={busy} onProvider={setProvider} onRun={runAi} />}

      <div className="charts">
        <Bars title="Buena postura por día (%)" max={100} unit="%" tone={postureTone}
          data={week.days.map((d) => ({ label: d.label, value: d.posture_pct }))} />
        <Bars title="Avisos por día" max={Math.max(5, ...week.days.map((d) => d.alerts_total))} unit=" avisos"
          data={week.days.map((d) => ({ label: d.label, value: d.session_min > 0 ? d.alerts_total : null }))} />
        <Bars title="¿Cuándo te encorvas? (% del tiempo)" max={100} unit="%" tone={(v) => (v >= 35 ? "bad" : v >= 20 ? "warn" : "ok")}
          data={week.slots.map((s) => ({ label: s.name, value: s.bad_pct }))} />
        <Bars title="Parpadeos por minuto" max={20} unit=" por min" tone={(v) => (v >= 10 ? "ok" : "warn")}
          data={week.days.map((d) => ({ label: d.label, value: d.bpm_avg === null ? null : Math.round(d.bpm_avg) }))} />
      </div>

      <details className="card privacy-box">
        <summary>🔒 Ver exactamente qué datos usa este resumen</summary>
        <p className="muted small">Hoy el resumen se calcula <b>solo en tu equipo</b>: no se envía nada a internet. Si algún día
          conectas una IA externa (opcional), esto es <b>lo único</b> que recibiría: números agregados, sin imágenes,
          sin fechas exactas, sin tu nombre ni rutas.</p>
        <pre>{JSON.stringify(payload?.payload, null, 2)}</pre>
      </details>
    </main>
  );
}
