import { useEffect, useState } from "react";
import { api } from "../lib/api";
import CameraPreview from "../components/Preview";
import type { LiveState, Preview, Settings } from "../lib/types";

const GROUP_NAMES: Record<string, string> = {
  posture: "Espalda y hombros", close: "Distancia a la pantalla", blink: "Parpadeo", sleep: "Sueño", pause: "Descansos",
};
const RANK = { off: 0, nodata: 1, ok: 2, acc: 3, alert: 4 } as const;
const MOOD_EMOJI = { happy: "✨", idle: "🙂", worried: "😟", sad: "😣", sleep: "💤", cheer: "🎉" } as const;
const MOOD_TEXT = {
  happy: "¡Vas genial!", idle: "Aquí estoy", worried: "Cuida tu espalda", sad: "¡Auch! Endereza",
  sleep: "Zzz…", cheer: "¡Bien hecho!",
} as const;
const PREVIEWS: Preview[] = ["Mostrar", "Solo contorno", "Ocultar"];

function fmt(sec: number) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Ring({ score }: { score: number }) {
  const r = 46, c = 2 * Math.PI * r;
  const tone = score >= 70 ? "ok" : score >= 40 ? "warn" : "bad";
  const word = score >= 80 ? "¡excelente!" : score >= 50 ? "vas bien" : "cuídate más";
  return (
    <div className="ring" role="img" aria-label={`Tu día: ${Math.round(score)} de 100, ${word}`}>
      <svg viewBox="0 0 116 116">
        <circle cx="58" cy="58" r={r} className="ring-bg" />
        <circle cx="58" cy="58" r={r} className={`ring-fg tone-${tone}`} strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 58 58)" />
      </svg>
      <div className="ring-txt"><b>{Math.round(score)}</b><span>{word}</span></div>
    </div>
  );
}

function VideoCard({ s, preview, onPreview }: { s: LiveState; preview: Preview; onPreview: (p: Preview) => void }) {
  const showVideo = s.camera_on && preview !== "Ocultar";
  const placeholder = s.paused ? "Cámara apagada (en pausa)" : s.cam_error ? "No encuentro la cámara"
    : preview === "Ocultar" ? "Cámara oculta · sigo cuidándote" : "Encendiendo la cámara…";
  return (
    <section className="card video-card">
      <div className="video-box">
        {showVideo ? <CameraPreview mode={preview} />
          : <div className="video-ph">{placeholder}</div>}
        {s.calibrating && (
          <div className="cal"><p>Quédate así, mirando la pantalla</p>
            <div className="bar"><i style={{ width: `${s.cal_progress * 100}%` }} /></div></div>
        )}
      </div>
      <p className="caption">{s.paused || !s.present ? "No te veo ahora mismo" : s.eyes_closed ? "Tus ojos están cerrados" : "Te veo bien"}</p>
      <div className="seg" role="radiogroup" aria-label="Mi cámara en pantalla">
        {PREVIEWS.map((p) => (
          <button key={p} role="radio" aria-checked={preview === p} className={preview === p ? "on" : ""}
            onClick={() => onPreview(p)}>{p}</button>
        ))}
      </div>
    </section>
  );
}

function Companion({ s }: { s: LiveState }) {
  const c = s.companion;
  return (
    <div className={`companion mood-${s.mood}`}>
      <div className={`avatar rar-${c?.rarity ?? "comun"}`} style={{ width: 84 + s.stage * 10, height: 84 + s.stage * 10 }}>
        {c?.art_url ? <img src={c.art_url} alt={c.title} /> : <span>🥚</span>}
        <em aria-hidden>{MOOD_EMOJI[s.mood]}</em>
      </div>
      <div>
        <b>{c ? MOOD_TEXT[s.mood] : "Corrígete y nacerá"}</b>
        <small>Nv {s.level} {"★".repeat(s.stage)}</small>
      </div>
    </div>
  );
}

export default function Home({ s }: { s: LiveState }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => { api<Settings>("/settings").then(setSettings).catch(() => {}); }, []);
  const preview = settings?.preview ?? "Mostrar";
  const setPreview = (p: Preview) => {
    setSettings((x) => (x ? { ...x, preview: p } : x));
    api<Settings>("/settings", "PUT", { preview: p }).then(setSettings).catch(() => {});
  };
  const calibrate = () => api("/calibrate", "POST").catch(() => {});

  const groups = Object.keys(GROUP_NAMES).map((g) => {
    const st = s.rules.filter((r) => r.group === g).map((r) => r.state);
    const top = st.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "off" as (typeof st)[number]);
    return { g, top };
  });
  const stateText = { off: "apagado", nodata: "sin datos", ok: "bien", acc: "atención", alert: "aviso" } as const;

  return (
    <main className="home">
      <VideoCard s={s} preview={preview} onPreview={setPreview} />
      <div className="col">
        <section className={`card hero tone-${s.hero.tone}`} aria-live="polite">
          <small className="tag">{s.hero.tag}</small>
          <h1>{s.hero.title}</h1>
          <p>{s.hero.sub}</p>
          {s.hero.button && (
            <button className="btn primary" onClick={calibrate}>
              {s.hero.button === "start" ? "Empezar" : "Reajustar mi postura"}
            </button>
          )}
        </section>

        <section className="card">
          <small className="label">Lo que estoy cuidando</small>
          <ul className="chips">
            {groups.map(({ g, top }) => (
              <li key={g}><i className={`dot st-${top}`} aria-hidden /> {GROUP_NAMES[g]}
                <span className="sr">: {stateText[top]}</span></li>
            ))}
          </ul>
        </section>

        <section className="card day">
          <Ring score={s.score} />
          <dl>
            <div><dt>{s.posture_pct === null ? "--" : `${Math.round(s.posture_pct)}%`}</dt><dd>del tiempo con buena postura</dd></div>
            <div><dt>{fmt(s.session_sec)}</dt><dd>frente a la pantalla</dd></div>
            <div><dt>{Math.round(s.work_min)} min</dt><dd>desde tu último descanso</dd></div>
            <div><dt>Nv {s.level} · 🔥 {s.streak} d</dt><dd>tu nivel y racha</dd></div>
          </dl>
        </section>

        <section className="card">
          <Companion s={s} />
          <div className="xp" title={`${s.level_xp} / ${s.level_need} XP`}><i style={{ width: `${(s.level_xp / s.level_need) * 100}%` }} /></div>
        </section>
      </div>
    </main>
  );
}
