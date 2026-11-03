import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, uploadFile } from "./api";
import { getUserImageUrl, getUserSoundUrl } from "./local/media";
import { playUrl } from "./sound";
import type { Settings } from "./types";

type Img = Settings["img_mode"];
const IMG: [Img, string][] = [
  ["Sorpresa", "🎲"], ["Pokémon", "⚡"], ["Gatitos", "🐱"], ["Perritos", "🐶"], ["Zorros", "🦊"], ["Arte", "🎨"],
  ["Espacio", "🚀"], ["Dragon Ball", "🐉"], ["Estiramientos", "🤸"], ["Frases", "💬"], ["Respira", "🌬️"],
  ["Mi imagen", "🖼️"], ["Sin imagen", "🚫"],
];
const SND: Settings["snd_mode"][] = ["Silencio", "Pitido", "Grito Pokémon", "Voz", "Mi sonido"];
const SENS: Settings["sens"][] = ["Tranquilo", "Normal", "Atento"];
const GROUPS: [string, string][] = [["posture", "Espalda y hombros"], ["close", "Distancia a la pantalla"],
  ["blink", "Parpadeo"], ["sleep", "Sueño"], ["pause", "Descansos"]];

function Seg<T extends string>({ value, options, onChange, label }:
  { value: T; options: T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={value === o} className={value === o ? "on" : ""} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="switch-row">
      <div><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}><i /></button>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="card"><h3>{title}</h3>{hint && <p className="muted small">{hint}</p>}{children}</section>;
}

export default function SettingsView() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState("");
  const [stamp, setStamp] = useState(Date.now());          // para refrescar la miniatura tras subir otra imagen
  const [topic, setTopic] = useState("");
  const timer = useRef(0);

  useEffect(() => {
    api<Settings>("/settings").then((x) => { setS(x); setTopic(x.ntfy); }).catch(() => setMsg("No pude cargar tus ajustes"));
  }, []);

  const flash = (m: string) => { setMsg(m); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(""), 2500); };
  const save = (patch: Partial<Settings>) => {
    setS((x) => (x ? { ...x, ...patch } : x));
    return api<Settings>("/settings", "PUT", patch).then((x) => { setS(x); flash("✓ Cambios guardados"); return true; })
      .catch(() => { flash("No pude guardar ese cambio"); return false; });
  };
  const upload = (kind: "image" | "sound", f: File | undefined) => {
    if (!f) return;
    uploadFile<Settings>(kind, f).then((x) => { setS(x); setStamp(Date.now()); flash("✓ Archivo guardado"); }).catch((e: Error) => flash(e.message));
  };
  const randomTopic = () => {
    const b = crypto.getRandomValues(new Uint8Array(12));
    const t = "ps-" + Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 20);
    setTopic(t);
    void save({ ntfy: t });
  };

  if (!s) return <p className="loading">Cargando ajustes…</p>;
  const hasImg = !!s.img_path, hasSnd = !!s.snd_path;
  const groups = s.groups ?? {};

  return (
    <main className="page">
      <div className="page-head"><h2>Ajustes</h2><span className="saved" role="status">{msg}</span></div>
      <div className="settings">
        <div className="col">
          <Section title="Cómo te aviso" hint="Lo que elijas aquí se usa en todos los avisos.">
            <small className="label">Imagen</small>
            <div className="tiles" role="radiogroup" aria-label="Imagen del aviso">
              {IMG.map(([n, e]) => (
                <button key={n} role="radio" aria-checked={s.img_mode === n} className={s.img_mode === n ? "on" : ""}
                  onClick={() => save({ img_mode: n })}><span aria-hidden>{e}</span>{n}</button>
              ))}
            </div>
            {s.img_mode === "Mi imagen" && (
              <div className="extra">
                <label className="btn file">Elegir imagen…<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                  onChange={(e) => upload("image", e.target.files?.[0])} /></label>
                {hasImg ? <img className="thumb" src={`${getUserImageUrl()}#${stamp}`} alt="Tu imagen elegida" /> : <small className="muted">Todavía no elegiste ninguna</small>}
              </div>
            )} 
            <small className="label">Sonido</small>
            <Seg label="Sonido del aviso" value={s.snd_mode} options={SND} onChange={(v) => save({ snd_mode: v })} />
            {s.snd_mode === "Mi sonido" && (
              <div className="extra">
                <label className="btn file">Elegir sonido…<input type="file" accept="audio/wav,audio/mpeg,audio/ogg"
                  onChange={(e) => upload("sound", e.target.files?.[0])} /></label>
                {hasSnd ? <button className="btn" onClick={() => playUrl(getUserSoundUrl())}>▶ Escuchar</button>
                  : <small className="muted">Todavía no elegiste ninguno</small>}
              </div>
            )}
            <Switch on={s.net} onChange={(v) => save({ net: v })} label="Buscar imágenes en internet"
              hint="Solo se piden imágenes a las APIs del paquete elegido. Tu video y tus datos nunca salen de tu navegador. Sin internet uso las que ya guardé." />
            <button className="btn primary" onClick={() => api("/test-alert", "POST")}>Probar mi aviso</button>
          </Section>

          <Section title="Mi cámara en pantalla" hint="«Solo contorno» y «Ocultar» no muestran tu imagen. El video nunca se guarda.">
            <Seg label="Vista de la cámara" value={s.preview} options={["Mostrar", "Solo contorno", "Ocultar"]} onChange={(v) => save({ preview: v })} />
          </Section>
        </div>

        <div className="col">
          <Section title="¿Qué tan atento quieres que sea?" hint="Tranquilo te da más margen antes de avisar. Atento te avisa antes.">
            <Seg label="Sensibilidad" value={s.sens} options={SENS} onChange={(v) => save({ sens: v })} />
          </Section>

          <Section title="¿Qué quieres que cuide?">
            {GROUPS.map(([k, n]) => (
              <Switch key={k} label={n} on={groups[k] ?? true} onChange={(v) => save({ groups: { ...groups, [k]: v } })} />
            ))}
          </Section>

          <Section title="Avisarme también en mi celular"
            hint="Opcional. Instala la app ntfy en tu celular, genera un nombre secreto y suscríbete a él. Solo se envía el texto del aviso, nunca tu video.">
            <input className="input" value={topic} placeholder="nombre-secreto-largo" aria-label="Nombre secreto de ntfy"
              onChange={(e) => setTopic(e.target.value)} onBlur={() => { if (topic !== s.ntfy) void save({ ntfy: topic.trim() }); }} />
            <div className="row"><button className="btn" onClick={randomTopic}>🎲 Generar nombre secreto</button>
              {s.ntfy && <button className="btn" onClick={() => { setTopic(""); void save({ ntfy: "" }); }}>Desactivar</button>}</div>
          </Section>

          <Section title="Para presentar">
            <Switch on={s.demo} onChange={(v) => save({ demo: v })} label="Modo demostración" hint="Los avisos salen mucho más rápido para mostrarlo en vivo." />
            <button className="btn" onClick={() => api("/packs/gift", "POST")}>🎁 Regalarme un sobre</button>
          </Section>
        </div>
      </div>
    </main>
  );
}
