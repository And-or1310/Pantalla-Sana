import { ChartColumn, Gift, Hand, House, LockKeyhole, LogOut, Maximize2, Minimize2, PanelTop, Settings, Sparkles, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import CameraSetup from "./components/CameraSetup";
import { engine } from "./core/engine";
import { account } from "./core/account";
import { ls } from "./core/store";
import { api, useLive } from "./lib/api";
import { beep, playUrl, speak } from "./lib/sound";
import Home, { type SessionEntry } from "./views/Home";
import Album from "./views/Album";
import Week from "./views/Week";
import Packs from "./components/Packs";
import SettingsView from "./views/SettingsView";
import type { Content, EventMsg, PackOpened, Preview } from "./lib/types";

type Tone = "ok" | "warn" | "bad" | "muted";
type Item =
  | { id: number; kind: "toast"; msg: string; tone: Tone }
  | { id: number; kind: "alert"; msg: string; accent: "amber" | "rose"; card: string; content: Content | null };

type NewItem = Item extends infer T ? (T extends { id: number } ? Omit<T, "id"> : never) : never;
type View = "inicio" | "semana" | "album" | "ajustes";
const VIEWS: [View, string][] = [["inicio", "Inicio"], ["semana", "Mi semana"], ["album", "Álbum"], ["ajustes", "Ajustes"]];
const viewFromHash = (): View => (VIEWS.find(([v]) => v === location.hash.slice(1))?.[0] ?? "inicio");
const THEMES = [["auto", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]] as const;
const SIZES = [["small", "Pequeña"], ["medium", "Mediana"], ["large", "Grande"]] as const;
type Theme = typeof THEMES[number][0];
type Size = typeof SIZES[number][0];
type FloatingApi = { requestWindow(options: { width: number; height: number }): Promise<Window> };
const floatingApi = (window as Window & { documentPictureInPicture?: FloatingApi }).documentPictureInPicture;
const floatingWidths = { small: 280, medium: 340, large: 440 };
function floatingSize(size: Size, preview: Preview) {
  const width = floatingWidths[size];
  return { width, height: preview === "Ocultar" ? 210 : Math.round((width - 8) * .75) + 150 };
}

const ICONS = { inicio: House, semana: ChartColumn, album: Gift, ajustes: Settings };
let nextId = 1;

function Choices<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void;
}) {
  return <div className="seg" role="group" aria-label={label}>
    {options.map(([key, name]) => <button key={key} type="button" aria-pressed={value === key}
      className={value === key ? "on" : ""} onClick={() => onChange(key)}>{name}</button>)}
  </div>;
}

function AlertCard({ it, onClose, fullscreen = false }: { it: Extract<Item, { kind: "alert" }>; onClose: () => void; fullscreen?: boolean }) {
  const c = it.content;
  return (
    <button className={`alert accent-${it.accent}`} onClick={onClose} aria-label="Cerrar aviso">
      {it.card !== "text" && (
        <div className="alert-art" style={c?.color ? { borderColor: c.color } : undefined}>
          {c?.breathe ? <span className="breathe" /> : c?.art_url ? <img src={c.art_url} alt="" />
            : <span className="emo">{c?.emoji ?? <Sparkles aria-hidden="true" />}</span>}
        </div>
      )}
      <div className="alert-copy">
        {c?.title && <small>{c.title}</small>}
        <strong>{it.msg}</strong>
        {c?.text && <span>{c.text}</span>}
        {c?.credit && <small>vía {c.credit}</small>}
        {fullscreen && <small>Toca para cerrar</small>}
      </div>
    </button>
  );
}

export default function App() {
  const auth = useSyncExternalStore(account.subscribe, account.snapshot);
  const { theme, widgetSize: size } = auth.appearance;
  const [floating, setFloating] = useState<Window | null>(null);
  const [openingWidget, setOpeningWidget] = useState(false);
  const [intro, setIntro] = useState(() => ls.get("ps.introDone", false) ? "done" : "welcome");
  const [deviceId, setDeviceId] = useState(() => ls.get("ps.cameraDevice", ""));
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (floating) floating.document.documentElement.dataset.theme = theme; }, [floating, theme]);
  const [activity, setActivity] = useState<SessionEntry[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [accountBusy, setAccountBusy] = useState(false);
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
    const h = () => {
      const next = viewFromHash();
      setView(next);
      if (next !== "inicio") floating?.close();
    };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, [floating]);

  const recordActivity = useCallback((text: string, kind: SessionEntry["kind"]) => {
    const entry = { id: nextId++, at: new Date(), text, kind };
    setActivity((entries) => [entry, ...entries.slice(0, 3)]);
  }, []);

  const onEvent = useCallback((e: EventMsg) => {
    switch (e.type) {
      case "sound":
        if (e.kind === "beep") beep(e.repeat);
        else if (e.kind === "voice" && e.text) speak(e.text);
        else if (e.url) playUrl(e.url);
        break;
      case "alert":
        recordActivity(e.msg, "alert");
        push({ kind: "alert", msg: e.msg, accent: e.accent, card: e.card, content: e.content ?? null }, 9000);
        if (document.hidden && Notification.permission === "granted") new Notification("Pantalla Sana", { body: e.msg });
        break;
      case "toast": push({ kind: "toast", msg: e.msg, tone: e.tone ?? "ok" }, 6000); break;
      case "rescue":
        recordActivity(`Corregiste a tiempo · +${e.xp} XP`, "correction");
        if (e.new_card) setAlbumVersion((v) => v + 1);
        push({ kind: "toast", tone: "ok", msg: `¡Corregido! +${e.xp} XP${e.new_card ? `  ·  carta ${e.rarity?.toUpperCase()} nueva` : ""}` }, 6000);
        break;
      case "levelup": push({ kind: "toast", tone: "warn", msg: `¡Subiste de nivel! ${e.summary}  ·  sobre nuevo` }, 6000); break;
      case "pack_opened": setPack(e); setAlbumVersion((v) => v + 1); break;
    }
  }, [push, recordActivity]);

  const { state, online } = useLive(onEvent, floating ?? window);
  useEffect(() => {
    setActivity([]);
    setItems([]);
    setIntro((step) => step === "configure" ? "done" : step === "camera" ? "welcome" : step);
  }, [auth.user?.id]);
  useEffect(() => {
    if (auth.message && engine.paused) {
      setIntro((step) => step === "configure" ? "done" : step === "camera" ? "welcome" : step);
    }
  }, [auth.message]);

  const openPack = () => {
    api<{ started: boolean }>("/packs/open", "POST").then((r) => { if (r.started) setPack("waiting"); }).catch(() => {});
  };
  const askNotif = () => Notification.requestPermission().then(setNotif);

  const openFloating = async () => {
    if (!floatingApi) {
      push({ kind: "toast", msg: "Abre Pantalla Sana en Chrome de escritorio para usar la ventana flotante.", tone: "warn" }, 7000);
      return;
    }
    setOpeningWidget(true);
    let popup: Window | undefined;
    try {
      popup = await floatingApi.requestWindow(floatingSize(size, engine.settings.preview));
      const doc = popup.document;
      doc.title = "Pantalla Sana";
      doc.documentElement.lang = "es";
      doc.documentElement.dataset.theme = theme;
      doc.documentElement.classList.add("floating-widget");
      const base = doc.createElement("base");
      base.href = document.baseURI;
      doc.head.append(base);
      for (const stylesheet of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        doc.head.append(doc.importNode(stylesheet, true));
      }
      popup.addEventListener("pagehide", () => {
        engine.setFrameWindow(window);
        account.setTimerWindow(window);
        setFloating(null);
      }, { once: true });
      engine.setFrameWindow(popup);
      account.setTimerWindow(popup);
      location.hash = "inicio";
      setFloating(popup);
    } catch {
      popup?.close();
      push({ kind: "toast", msg: "No se pudo abrir la ventana flotante. Inténtalo otra vez desde la pestaña de Pantalla Sana.", tone: "warn" }, 7000);
    } finally {
      setOpeningWidget(false);
    }
  };

  const resizeFloating = (preview: Preview) => {
    if (!floating) return;
    const { width, height } = floatingSize(size, preview);
    // Picture-in-Picture requiere que el redimensionado ocurra en el clic.
    try { floating.resizeTo(width, height); } catch { /* El navegador puede restringir el tamaño; la vista sigue siendo compacta. */ }
  };

  const showFullPage = () => {
    location.hash = "inicio";
    floating?.close();
    window.focus();
  };
  const restartIntro = () => {
    ls.set("ps.introDone", false);
    setIntro("welcome");
    void account.stop();
  };
  const finishIntro = () => {
    ls.set("ps.introDone", true);
    location.hash = "inicio";
    setIntro("done");
  };
  const configureCamera = (id: string) => {
    setDeviceId(id);
    ls.set("ps.cameraDevice", id);
    engine.configureCamera(id);
  };
  const requestCamera = async (move = false) => {
    if (floating) showFullPage();
    setAccountBusy(true);
    const allowed = await account.startMonitoring(move);
    setAccountBusy(false);
    if (!allowed) return;
    configureCamera(deviceId);
    setIntro(intro === "done" ? "configure" : "camera");
  };
  const openCameraSetup = () => { void requestCamera(); };
  const leaveCameraSetup = () => {
    setIntro(intro === "configure" ? "done" : "theme");
  };
  const togglePause = async () => {
    if (!engine.paused) {
      await account.stop();
      recordActivity("Pausaste el seguimiento", "pause");
      return;
    }
    const camera = engine.snapshot();
    if (!camera.calibrated || camera.cam_error) return;
    setAccountBusy(true);
    const allowed = await account.startMonitoring();
    setAccountBusy(false);
    if (!allowed) return;
    engine.setPaused(false);
    if (!engine.paused) recordActivity("Reanudaste el seguimiento", "pause");
  };
  const accountAction = async (action: () => Promise<void>, error: string) => {
    setAccountBusy(true);
    try { await action(); } catch { push({ kind: "toast", msg: error, tone: "warn" }, 6000); }
    finally { setAccountBusy(false); }
  };
  const accountButton = account.enabled && <button className="btn" disabled={!auth.ready || accountBusy}
    onClick={() => void accountAction(auth.user ? () => account.signOut() : () => account.signIn(),
      auth.user ? "No pudimos cerrar tu sesión." : "No pudimos iniciar sesión con Google.")}>
    {auth.user ? "Cerrar sesión" : "Continuar con Google"}
  </button>;
  const canImport = account.canImport();
  const importButton = canImport && <button className="btn" disabled={accountBusy}
    onClick={() => void accountAction(() => account.importGuest(), "No pudimos importar el historial. Inténtalo de nuevo.")}>
    Importar historial de este navegador
  </button>;
  const accountPanel = account.enabled && <section className="card account-settings" aria-labelledby="account-heading">
    <h2 id="account-heading">Cuenta</h2>
    {auth.user
      ? <>
        <p>Sesión iniciada con Google{auth.user.email && <><br /><strong>{auth.user.email}</strong></>}.</p>
        <p className="muted">{auth.profileReady
          ? "Se sincronizan tu historial, álbum, progreso, ajustes e imágenes y sonidos de aviso que elijas guardar."
          : "Conectando con el perfil de tu cuenta…"}</p>
        <p className="muted">La cámara seleccionada y su calibración dependen de este equipo.</p>
        {importButton}
        {auth.canImportProfile && <div className="row">
          <button className="btn" disabled={accountBusy} onClick={() => void accountAction(() => account.importGuestProfile(),
            "No pudimos importar el perfil de invitado. Si estás siguiendo desde otro equipo, páusalo y vuelve a intentarlo.")}>
            Importar álbum, progreso y ajustes de este navegador
          </button>
        </div>}
      </>
      : <><p className="muted">{auth.ready ? "Modo invitado. Inicia sesión para sincronizar tu historial." : "Comprobando tu sesión…"}</p>{accountButton}</>}
  </section>;
  const monitorNotice = (auth.message || auth.locked) && <div className="notice" role="status">
    {auth.message}
    {auth.locked && <button className="btn" disabled={accountBusy} onClick={() => void requestCamera(true)}>Mover seguimiento a este equipo</button>}
  </div>;
  const setTheme = (value: Theme) => { void accountAction(() => account.updateAppearance("theme", value), "No pudimos guardar el tema."); };
  const setSize = (value: Size) => { void accountAction(() => account.updateAppearance("widgetSize", value), "No pudimos guardar el tamaño del widget."); };
  const appearance = <Choices label="Tema" value={theme} options={THEMES} onChange={setTheme} />;

  const widgetAlert = [...items].reverse().find((item): item is Extract<Item, { kind: "alert" }> => item.kind === "alert");
  const alerts = <div className="stack" role="status" aria-live="polite">
    {items.map((it) => it.kind === "alert"
      ? <AlertCard key={it.id} it={it} onClose={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} />
      : <div key={it.id} className={`toast tone-${it.tone}`}>{it.msg}</div>)}
  </div>;

  return (
    <div className="ps-app mode-full">
      {intro !== "done" ? (
        <main className="onboarding">
          <section className="intro-box">
            {intro === "welcome" ? <>
              <span className="intro-icon" aria-hidden="true"><Hand /></span>
              <h1>Hola, cuido tu espalda y tus ojos</h1>
              <p>Mientras trabajas, la cámara me ayuda a avisarte. Tu video se procesa solo en tu navegador.</p>
              <button className="btn primary" disabled={!auth.ready || accountBusy} onClick={openCameraSetup}>Empezar</button>
              {accountButton}
              {auth.user && <button className="btn" onClick={finishIntro}>Ir al panel</button>}
              {monitorNotice}
            </> : intro === "camera" || intro === "configure" ? (
              <CameraSetup state={state} deviceId={deviceId} onDevice={configureCamera}
                onCalibrate={() => engine.calibrate()}
                onContinue={() => { if (engine.snapshot().calibrated) leaveCameraSetup(); }}
                onSkip={() => { void account.stop(); leaveCameraSetup(); }} />
            ) : intro === "theme" ? <>
              <h1>Elige tu estilo</h1>
              {appearance}
              <button className="btn primary" onClick={() => setIntro("ready")}>Siguiente</button>
            </> : <>
              <span className="intro-icon" aria-hidden="true"><PanelTop /></span>
              <h1>Listo. Pantalla Sana cabe en una ventanita</h1>
              <p>Abre el widget para ver la cámara y los avisos mientras trabajas.</p>
              <button className="btn primary" onClick={() => { finishIntro(); void openFloating(); }}>Abrir widget</button>
              <button className="btn" onClick={finishIntro}>Ir a pantalla completa</button>
            </>}
          </section>
        </main>
      ) : <>
        <div className="session-shell">
          <aside className="session-sidebar">
            <a className="brand" href="#inicio">Pantalla Sana</a>
            <nav className="session-nav" aria-label="Navegación principal">
              {VIEWS.map(([v, name]) => {
                const Icon = ICONS[v];
                return <a key={v} href={`#${v}`} onClick={() => floating?.close()}
                  aria-current={view === v ? "page" : undefined}><Icon aria-hidden="true" />{name}</a>;
              })}
              {auth.user && <button type="button" className="session-sign-out" disabled={accountBusy}
                onClick={() => void accountAction(() => account.signOut(), "No pudimos cerrar tu sesión.")}>
                <LogOut aria-hidden="true" /> Cerrar sesión
              </button>}
            </nav>
          </aside>
          <div className="session-content">
            <header className="ps-header session-header">
              <span><LockKeyhole aria-hidden="true" /> Procesamiento local</span>
              <div className="window-actions">
                {!auth.user && accountButton}
                {view !== "inicio" && state?.calibrated && !state.cam_error && (
                  <button className="btn" onClick={togglePause}>{state.paused ? "Reanudar" : "Pausar"}</button>
                )}
                <button className="btn primary" disabled={openingWidget} onClick={floating ? showFullPage : openFloating}>
                  {floating ? <Maximize2 aria-hidden="true" /> : <Minimize2 aria-hidden="true" />}
                  {floating ? " Pantalla completa" : " Abrir widget"}
                </button>
              </div>
            </header>
            {monitorNotice}
            {view !== "ajustes" && canImport && !auth.importNoticeDismissed && <div className="notice import-notice">
              <div>
                <p>Este navegador tiene métricas de invitado que puedes añadir a tu cuenta.</p>
                <p>También puedes importarlas después desde Ajustes → Cuenta.</p>
                {importButton}
              </div>
              <button className="btn import-dismiss" type="button" onClick={() => account.dismissImportNotice()} aria-label="Cerrar aviso de importación" title="Cerrar aviso">
                <X aria-hidden="true" />
              </button>
            </div>}
            {view === "ajustes" ? <div className="ps-panel">
              <SettingsView settingsRevision={auth.settingsRevision} accountPanel={accountPanel} appearance={<section className="card appearance">
                <h2>Apariencia</h2>
                {appearance}
                <h3>Widget</h3>
                <p>Tamaño del widget</p>
                <Choices label="Tamaño del widget" value={size} options={SIZES} onChange={setSize} />
                <button className="btn" onClick={restartIntro}>Volver a ver el recorrido inicial</button>
                {notif === "default" && <button className="btn" onClick={askNotif}>Activar avisos con la pestaña oculta</button>}
              </section>} />
            </div>
              : view === "semana" ? <div className="ps-panel"><Week key={auth.user?.id ?? "guest"} revision={auth.revision} signedIn={!!auth.user} /></div>
              : view === "album" ? <div className="ps-panel"><Album key={auth.user?.id ?? "guest"} version={albumVersion + auth.progressRevision}
                packs={state?.packs ?? 0} onOpenPack={openPack} /></div>
              : state ? floating ? <p className="loading">El seguimiento está en la ventana flotante.</p> : <Home s={state} activity={activity}
                settingsRevision={auth.settingsRevision} onTogglePause={togglePause} onConfigureCamera={openCameraSetup} /> : <p className="loading">{online ? "Cargando…" : "Conectando…"}</p>}
            <footer className="privacy">
              <span><LockKeyhole aria-hidden="true" /> Tu video se procesa solo en tu navegador y nunca sale de tu equipo.</span>
              <span>Peticiones a internet: <b>{state?.net_requests_today ?? 0}</b></span>
            </footer>
          </div>
        </div>
      </>}
      {pack !== "closed" && <Packs result={pack === "waiting" ? null : pack} onClose={() => setPack("closed")} />}

      {floating ? createPortal(
        <div className="ps-app mode-widget">
          <div hidden={!!widgetAlert}>{state && <Home s={state} settingsRevision={auth.settingsRevision} onTogglePause={togglePause} onConfigureCamera={openCameraSetup}
            onFullPage={showFullPage} onWidgetPreviewChange={resizeFloating} onNavigate={(next) => {
            location.hash = next;
            floating.close();
            window.focus();
          }} />}</div>
          {widgetAlert ? <div className="widget-alert" role="status">
            <AlertCard it={widgetAlert} fullscreen onClose={() => setItems((xs) => xs.filter((x) => x.kind !== "alert"))} />
          </div> : alerts}
        </div>, floating.document.body
      ) : alerts}
    </div>
  );
}
