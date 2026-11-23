import { CircleAlert, CircleCheck, Accessibility, Egg, Eye, Frown, Meh, Moon, PartyPopper, Smile, Sparkles, Star, Laptop, LockKeyhole, Maximize2, Menu, Pause, Play, Settings2, Timer, Video, VideoOff } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ls } from "../core/store";
import CameraPreview from "../components/Preview";
import type { LiveState, Preview, Settings } from "../lib/types";

export type SessionEntry = { id: number; at: Date; text: string; kind: "alert" | "correction" | "pause" };
const ACTIVITY_ICONS = { alert: CircleAlert, correction: CircleCheck, pause: Pause };
const activityTime = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });

const GROUP_NAMES: Record<string, string> = {
  posture: "Espalda y hombros", close: "Distancia a la pantalla", blink: "Parpadeo", sleep: "Sueño", pause: "Descansos",
};
const RANK = { off: 0, nodata: 1, ok: 2, acc: 3, alert: 4 } as const;
const MOOD_ICONS = { happy: Sparkles, idle: Smile, worried: Meh, sad: Frown, sleep: Moon, cheer: PartyPopper };
const MOOD_TEXT = {
  happy: "¡Vas genial!", idle: "Aquí estoy", worried: "Cuida tu espalda", sad: "¡Auch! Endereza",
  sleep: "Zzz…", cheer: "¡Bien hecho!",
} as const;
const WIDGET_ICONS = [Accessibility, Timer, Eye];
const PREVIEWS: Preview[] = ["Mostrar", "Solo contorno", "Ocultar"];

function fmt(sec: number) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function VideoCard({ s, preview, onPreview, widget = false }: {
  s: LiveState; preview: Preview; onPreview: (p: Preview) => void; widget?: boolean;
}) {
  const showVideo = s.camera_on && preview !== "Ocultar";
  const placeholder = s.paused ? "Cámara apagada" : s.cam_error ? "No encuentro la cámara"
    : preview === "Ocultar" ? "Vista de cámara oculta" : "Encendiendo la cámara…";
  return (
    <section className={widget ? "widget-camera" : "card video-card"}>
      {!widget && <h2>Tu cámara</h2>}
      <div className="video-box">
        {showVideo ? <CameraPreview mode={preview} />
          : <div className={`video-ph ${widget ? "widget-placeholder" : ""}`}>
            {widget && <Laptop aria-hidden="true" />}
            <span className={widget ? "sr" : undefined}>{placeholder}</span>
          </div>}
        {widget && <span className="widget-camera-privacy"><LockKeyhole aria-hidden="true" /> Solo en tu navegador</span>}
        {s.calibrating && (
          <div className="cal"><p>Quédate así, mirando la pantalla</p>
            <div className="bar"><i style={{ width: `${s.cal_progress * 100}%` }} /></div></div>
        )}
      </div>
      {!widget && <><p className="caption">{s.paused || !s.present ? "No te veo ahora mismo" : s.eyes_closed ? "Tus ojos están cerrados" : "Te veo bien"}</p>
      <div className="seg" role="radiogroup" aria-label="Mi cámara en pantalla">
        {PREVIEWS.map((p) => (
          <button key={p} role="radio" aria-checked={preview === p} className={preview === p ? "on" : ""}
            onClick={() => onPreview(p)}>{p}</button>
        ))}
      </div></>}
    </section>
  );
}

function Companion({ s }: { s: LiveState }) {
  const c = s.companion;
  const MoodIcon = MOOD_ICONS[s.mood];
  return (
    <div className={`companion mood-${s.mood}`}>
      <div className={`avatar rar-${c?.rarity ?? "comun"}`} style={{ width: 84 + s.stage * 10, height: 84 + s.stage * 10 }}>
        {c?.art_url ? <img src={c.art_url} alt={c.title} /> : <Egg aria-hidden="true" />}
        <em><MoodIcon aria-hidden="true" /></em>
      </div>
      <div>
        <b>{c ? MOOD_TEXT[s.mood] : "Corrígete y nacerá"}</b>
        <small>Nv {s.level} {Array.from({ length: s.stage }, (_, i) => <Star key={i} aria-hidden="true" />)}</small>
      </div>
    </div>
  );
}

export default function Home({ s, activity = [], settingsRevision, onTogglePause, onConfigureCamera, onFullPage, onWidgetPreviewChange, onNavigate }: {
  s: LiveState; activity?: SessionEntry[]; onTogglePause: () => void; onConfigureCamera: () => void;
  settingsRevision: number;
  onFullPage?: () => void; onWidgetPreviewChange?: (preview: Preview) => void;
  onNavigate?: (view: "semana" | "album" | "ajustes") => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [widgetPreview, setWidgetPreview] = useState(() => ls.get<Preview | null>("ps.widgetPreview", null));
  useEffect(() => { api<Settings>("/settings").then(setSettings).catch(() => {}); }, [settingsRevision]);
  const preview = (onFullPage ? widgetPreview : null) ?? settings?.preview ?? "Mostrar";
  const setPreview = (p: Preview) => {
    setSettings((x) => (x ? { ...x, preview: p } : x));
    api<Settings>("/settings", "PUT", { preview: p }).then(setSettings).catch(() => setSettings(settings));
  };
  const needsCameraSetup = !s.calibrated || s.cam_error;
  const pauseLabel = s.paused ? "Reanudar" : "Pausar";

  const groups = Object.keys(GROUP_NAMES).map((g) => {
    const st = s.rules.filter((r) => r.group === g).map((r) => r.state);
    const top = st.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "off" as (typeof st)[number]);
    return { g, top };
  });
  const stateText = { off: "apagado", nodata: "sin datos", ok: "bien", acc: "atención", alert: "aviso" } as const;

  const status = (keys: string[]) => groups
    .filter(({ g }) => keys.includes(g))
    .reduce<(typeof groups)[number]["top"]>((top, group) => RANK[group.top] > RANK[top] ? group.top : top, "off");
  const eyes = status(["blink", "sleep"]);
  const rest = status(["pause"]);
  const posture = s.posture_pct === null ? null : Math.round(s.posture_pct);
  const signals = [
    { label: "Postura", value: posture === null ? "Sin datos" : `${posture}%${onFullPage ? "" : " del tiempo"}`, width: posture ?? 0, color: "mint" },
    { label: "Descansos", value: rest === "off" ? "Desactivados" : `${Math.round(s.work_min)} min${onFullPage ? "" : " desde la pausa"}`,
      width: rest === "off" ? 0 : 100 * s.work_min / (settings?.demo ? 0.5 : ({ Tranquilo: 30, Normal: 20, Atento: 15 }[settings?.sens ?? "Normal"] ?? 20)), color: "blue" },
    { label: "Ojos", value: { off: "Desactivado", nodata: "Sin datos", ok: "Bien", acc: "Atención", alert: "Aviso" }[eyes],
      width: { off: 0, nodata: 0, ok: 100, acc: 66, alert: 33 }[eyes], color: "peach" },
  ];

  const bars = <ul className="stat-list" aria-label="Postura, descansos y ojos">
    {signals.map(({ label, value, width, color }) => (
      <li key={label} className={`stat-${color}`}>
        <div className="stat-label"><b>{label}</b><span>{value}</span></div>
        <div className="stat-track" aria-hidden="true"><i style={{ width: `${Math.min(100, width)}%` }} /></div>
      </li>
    ))}
  </ul>;

  if (onFullPage) {
    const compact = preview === "Ocultar";
    const nextPreview = PREVIEWS[(PREVIEWS.indexOf(preview) + 1) % PREVIEWS.length];
    return (
      <main className={compact ? "widget widget-compact" : "widget"}>
        <div className="widget-media">
          {!compact && <VideoCard s={s} preview={preview} onPreview={setPreview} widget />}
          <div className="widget-toolbar">
            <details className="widget-menu">
              <summary aria-label="Menú"><Menu aria-hidden="true" /></summary>
              <nav aria-label="Menú del widget">
                <button onClick={() => onNavigate?.("semana")}>Mi semana</button>
                <button onClick={() => onNavigate?.("album")}>Álbum</button>
                <button onClick={() => onNavigate?.("ajustes")}>Ajustes</button>
              </nav>
            </details>
            <div className="widget-controls">
              <button type="button" aria-label={`Cambiar vista de cámara a ${nextPreview}`}
                title={`Vista de cámara · ${preview}`} onClick={() => {
                  if (compact || nextPreview === "Ocultar") onWidgetPreviewChange?.(nextPreview);
                  setWidgetPreview(nextPreview);
                  ls.set("ps.widgetPreview", nextPreview);
                }}>{compact ? <VideoOff aria-hidden="true" /> : <Video aria-hidden="true" />}</button>
              {needsCameraSetup ? compact && <button type="button" aria-label="Configurar cámara" title="Configurar cámara"
                onClick={onConfigureCamera}><Settings2 aria-hidden="true" /></button>
                : <button type="button" aria-label={pauseLabel} title={pauseLabel}
                  onClick={onTogglePause}>{s.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</button>}
              <button type="button" aria-label="Pantalla completa" title="Pantalla completa" onClick={onFullPage}><Maximize2 aria-hidden="true" /></button>
            </div>
          </div>
        </div>
        <ul className="widget-rings" aria-label="Indicadores del widget">
          {signals.map(({ label, value, width, color }, index) => {
            const Icon = WIDGET_ICONS[index];
            return <li key={label} className={`stat-${color}`} title={`${label}: ${value}`}>
              <span className="sr">{label}: {value}</span>
              <div className="widget-ring">
              <svg viewBox="0 0 48 48" aria-hidden="true">
                <circle cx="24" cy="24" r="21" />
                {width > 0 && <circle className="widget-ring-fill" cx="24" cy="24" r="21" pathLength="100"
                  strokeDasharray={`${Math.min(100, width)} 100`} transform="rotate(-90 24 24)" />}
              </svg>
              <span aria-hidden="true"><Icon /></span>
              </div>
              <small aria-hidden="true">{label}</small>
              {compact && <b aria-hidden="true">{value}</b>}
            </li>;
          })}
        </ul>
        <section className={`hero tone-${s.hero.tone}`} aria-live="polite">
          {!compact && <small className="tag">{s.hero.tag}</small>}
          <h1>{needsCameraSetup && !s.cam_error ? "Configura tu cámara" : s.hero.title}</h1>
          {needsCameraSetup && !compact && <button className="btn primary" onClick={onConfigureCamera}>Configurar cámara</button>}
        </section>
      </main>
    );
  }

  const StatusIcon = s.paused ? Pause : s.hero.tone === "ok" ? CircleCheck : CircleAlert;
  return (
    <main className="home session-home">
      <header className="session-heading"><h1>Tu sesión</h1></header>
      <div className="monitor">
        <VideoCard s={s} preview={preview} onPreview={setPreview} />
        <div className="col">
          <section className={`session-status tone-${s.hero.tone}`} aria-label="Estado del seguimiento">
            <div className="session-status-copy" role="status">
              <StatusIcon aria-hidden="true" />
              <div>
                <h2>{needsCameraSetup && !s.cam_error ? "Configura tu cámara" : s.hero.title}</h2>
                {s.hero.tone !== "ok" && <p>{s.hero.sub}</p>}
              </div>
            </div>
            <div className="session-status-actions">
              <button className={needsCameraSetup ? "btn primary" : "btn"} onClick={onConfigureCamera}>Configurar cámara</button>
              {!needsCameraSetup && <button className="btn primary" onClick={onTogglePause}>{pauseLabel}</button>}
            </div>
          </section>
          <section className="card daily-stats" aria-labelledby="today">
            <div className="session-card-heading">
              <h2 id="today">Actividad de hoy</h2>
              <p className="caption session-time">{fmt(s.session_sec)} de sesión</p>
            </div>
            {bars}
          </section>
          <section className="card session-companion">
            <h2>Tu compañero</h2>
            <Companion s={s} />
            <p className="caption">Racha de {s.streak} días</p>
            <div className="xp" title={`${s.level_xp} / ${s.level_need} XP`}><i style={{ width: `${(s.level_xp / s.level_need) * 100}%` }} /></div>
          </section>
        </div>
        <section className="card session-activity" aria-labelledby="activity-heading">
          <h2 id="activity-heading">Durante la sesión</h2>
          {activity.length === 0 ? <p className="caption">Tus avisos, correcciones y pausas aparecerán aquí.</p>
            : <ul>{activity.map(({ id, at, text, kind }) => {
              const Icon = ACTIVITY_ICONS[kind];
              return <li key={id}><Icon aria-hidden="true" /><span>{text}</span><time dateTime={at.toISOString()}>{activityTime.format(at)}</time></li>;
            })}</ul>}
        </section>
      </div>

      <details className="card home-details">
        <summary>Qué se está cuidando</summary>
        <ul className="chips">
          {groups.map(({ g, top }) => (
            <li key={g}><i className={`dot st-${top}`} aria-hidden /> {GROUP_NAMES[g]}
              <span className="sr">: {stateText[top]}</span></li>
          ))}
        </ul>
      </details>
    </main>
  );
}
