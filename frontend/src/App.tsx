import { useCallback, useEffect, useState } from "react";
import { api, Unauthorized, useLive } from "./lib/api";
import { beep, playUrl, speak } from "./lib/sound";
import Home from "./views/Home";
import Album from "./views/Album";
import Week from "./views/Week";
import Packs from "./components/Packs";
import SettingsView from "./views/SettingsView";
import type { Content, EventMsg, PackOpened } from "./lib/types";

type Tone = "ok" | "warn" | "bad" | "muted";
type Item =
  | { id: number; kind: "toast"; msg: string; tone: Tone }
  | { id: number; kind: "alert"; msg: string; accent: "amber" | "rose"; card: string; content: Content | null };

type NewItem = Item extends infer T ? (T extends { id: number } ? Omit<T, "id"> : never) : never;
type View = "inicio" | "semana" | "album" | "ajustes";
const VIEWS: [View, string][] = [["inicio", "Inicio"], ["semana", "Mi semana"], ["album", "Álbum"], ["ajustes", "Ajustes"]];
const viewFromHash = (): View => (VIEWS.find(([v]) => v === location.hash.slice(1))?.[0] ?? "inicio");
let nextId = 1;

function AlertCard({ it, onClose }: { it: Extract<Item, { kind: "alert" }>; onClose: () => void }) {
  const c = it.content;
  return (
    <button className={`alert accent-${it.accent}`} onClick={onClose} aria-label="Cerrar aviso">
      {it.card !== "text" && (
        <div className="alert-art" style={c?.color ? { borderColor: c.color } : undefined}>
          {c?.breathe ? <span className="breathe" /> : c?.art_url ? <img src={c.art_url} alt="" />
            : <span className="emo">{c?.emoji ?? "🧘"}</span>}
        </div>
      )}
      {c?.title && <small>{c.title}</small>}
      <strong>{it.msg}</strong>
      {c?.text && <span>{c.text}</span>}
      {c?.credit && <small>vía {c.credit}</small>}
    </button>
  );
}

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [auth, setAuth] = useState<"?" | "ok" | "no">("?");
  const [view, setView] = useState<View>(viewFromHash);
  const [pack, setPack] = useState<"closed" | "waiting" | PackOpened>("closed");
  const [albumVersion, setAlbumVersion] = useState(0);
  const [notif, setNotif] = useState(typeof Notification === "undefined" ? "denied" : Notification.permission);

  const push = useCallback((it: NewItem, ms: number) => {
    const id = nextId++;
    setItems((xs) => [...xs.slice(-2), { ...it, id } as Item]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), ms);
  }, []);

  useEffect(() => {
    const h = () => setView(viewFromHash());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  const onEvent = useCallback((e: EventMsg) => {
    switch (e.type) {
      case "sound":
        if (e.kind === "beep") beep(e.repeat);
        else if (e.kind === "voice" && e.text) speak(e.text);
        else if (e.url) playUrl(e.url);
        break;
      case "alert":
        push({ kind: "alert", msg: e.msg, accent: e.accent, card: e.card, content: e.content ?? null }, 9000);
        if (document.hidden && Notification.permission === "granted") new Notification("Pantalla Sana", { body: e.msg });
        break;
      case "toast": push({ kind: "toast", msg: e.msg, tone: e.tone ?? "ok" }, 6000); break;
      case "rescue":
        if (e.new_card) setAlbumVersion((v) => v + 1);
        push({ kind: "toast", tone: "ok", msg: `¡Corregido! +${e.xp} XP${e.new_card ? `  ·  carta ${e.rarity?.toUpperCase()} nueva 🎉` : ""}` }, 6000);
        break;
      case "levelup": push({ kind: "toast", tone: "warn", msg: `¡Subiste de nivel! ${e.summary}  ·  🎁 sobre nuevo` }, 6000); break;
      case "pack_opened": setPack(e); setAlbumVersion((v) => v + 1); break;
    }
  }, [push]);

  const { state, online } = useLive(onEvent);
  useEffect(() => {
    api("/state").then(() => setAuth("ok")).catch((e) => setAuth(e instanceof Unauthorized ? "no" : "ok"));
  }, []);

  if (auth === "no") {
    return (
      <div className="gate card">
        <h1>🔒 Falta abrir tu sesión</h1>
        <p>Recarga la página para continuar.</p>
      </div>
    );
  }

  const openPack = () => {
    api<{ started: boolean }>("/packs/open", "POST").then((r) => { if (r.started) setPack("waiting"); }).catch(() => {});
  };
  const askNotif = () => Notification.requestPermission().then(setNotif);

  return (
    <>
      <header className="top">
        <div><h1 className="brand">Pantalla Sana</h1><p>Cuido tu espalda y tus ojos mientras trabajas</p></div>
        <nav>
          {VIEWS.map(([v, n]) => (
            <a key={v} href={`#${v}`} className={`tab ${view === v ? "on" : ""}`} aria-current={view === v ? "page" : undefined}>{n}</a>
          ))}
          <button className={`btn ${(state?.packs ?? 0) > 0 ? "primary" : ""}`} onClick={openPack}>🎁 Sobres ({state?.packs ?? 0})</button>
          {notif === "default" && <button className="btn" onClick={askNotif}>🔔 Avisos con la pestaña oculta</button>}
          <button className="btn" onClick={() => api("/pause", "POST")}>{state?.paused ? "Reanudar" : "Pausar"}</button>
        </nav>
      </header>

      {view === "ajustes" ? <SettingsView />
        : view === "semana" ? <Week />
        : view === "album" ? <Album version={albumVersion} packs={state?.packs ?? 0} onOpenPack={openPack} />
        : state ? <Home s={state} /> : <p className="loading">{online ? "Cargando…" : "Conectando con tu equipo…"}</p>}
      {pack !== "closed" && <Packs result={pack === "waiting" ? null : pack} onClose={() => setPack("closed")} />}

      <footer className="privacy">
        <span>🔒 Tu video se procesa solo en tu navegador y nunca sale de tu equipo.</span>
        <span>Peticiones a internet: <b>{state?.net_requests_today ?? 0}</b></span>
      </footer>

      <div className="stack" role="status" aria-live="polite">
        {items.map((it) => it.kind === "alert"
          ? <AlertCard key={it.id} it={it} onClose={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} />
          : <div key={it.id} className={`toast tone-${it.tone}`}>{it.msg}</div>)}
      </div>
    </>
  );
}
