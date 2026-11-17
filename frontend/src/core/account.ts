import { createClient, type User } from "@supabase/supabase-js";
import { engine, validateUserFile } from "./engine";
import { clearUserMedia, loadUserMedia, readGuestMedia, setMedia, type MediaKind } from "./media";
import { dayKey, DEFAULT_SETTINGS, loadSettings, ls, mergeSettings, Metrics, Progress, type DayData, type ProgData } from "./store";
import type { Settings } from "../lib/types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client = url && key ? createClient(url, key, { auth: { flowType: "pkce" } }) : null;
const POLL_MS = 3000;
const CLOCK_MARGIN_MS = 1000;
const MEDIA_BUCKET = "pantalla-profile-media";
const SYNC_SETTINGS = ["sens", "img_mode", "snd_mode", "img_path", "snd_path", "net", "preview", "groups", "demo", "ntfy", "ai_provider"] as const;
const MEDIA_FIELDS = { image: "img_path", sound: "snd_path" } as const;
const THEMES = ["auto", "light", "dark"] as const;
const SIZES = ["small", "medium", "large"] as const;
export type Theme = typeof THEMES[number];
export type WidgetSize = typeof SIZES[number];
type Appearance = { theme: Theme; widgetSize: WidgetSize };
type Preferences = Partial<Pick<Settings, typeof SYNC_SETTINGS[number]> & Appearance>;
type CloudProfile = { preferences: Preferences; progress: ProgData | null; version: number };

function guestAppearance(): Appearance {
  return { theme: ls.get("ps.theme", "auto"), widgetSize: ls.get("ps.widgetSize", "medium") };
}

type MonitorAction = "claim" | "move" | "sync" | "release";
type MonitorReply = { status: "active"; ms: number; profile?: CloudProfile } | { status: "busy" | "waiting" | "moving" | "ended" };
type Scope = {
  user: User | null; ready: boolean; locked: boolean; message: string; revision: number; importNoticeDismissed: boolean;
  profileReady: boolean; settingsRevision: number; progressRevision: number; appearance: Appearance; canImportProfile: boolean;
};
type Lease = {
  userId: string;
  token: string;
  metrics: Metrics;
  deadline: number;
  monotonicDeadline: number;
  progressStamp: string;
  temporary: boolean;
  inFlight?: Promise<void>;
};

function localDate(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return dayKey(date.getTime() / 1000);
}

function clock() { return { wall: Date.now(), monotonic: performance.now() }; }

class Account {
  readonly enabled = client !== null;
  private scope: Scope = {
    user: null, ready: !client, locked: false, message: "", revision: 0, importNoticeDismissed: false,
    profileReady: !client, settingsRevision: 0, progressRevision: 0, appearance: guestAppearance(), canImportProfile: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly guestMetrics = engine.metrics;
  private readonly guestProgress = engine.prog;
  private preferenceVersion = -1;
  private lastProfilePoll = 0;
  private profileRequest: Promise<void> | null = null;
  private mediaLoads: Partial<Record<MediaKind, string>> = {};
  private cloudHistory = new Metrics(false);
  private lease: Lease | null = null;
  private starting = false;
  private releasing: Promise<void> | null = null;
  private sessionChange = 0;
  private timer = 0;
  private host: Window | null = null;
  private refreshRequest: Promise<void> | null = null;
  private imported = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => this.scope;

  private update(patch: Partial<Scope>) {
    this.scope = { ...this.scope, ...patch };
    for (const listener of this.listeners) listener();
  }

  start() {
    if (!client) { void loadUserMedia(); return; }
    engine.setMonitoringAccess(() => this.scope.ready && (!this.scope.user || this.hasLease()));
    client.auth.onAuthStateChange((_event, session) => this.changeUser(session?.user ?? null));
    window.addEventListener("pagehide", () => { void this.stop(); });
    this.setTimerWindow(window);
  }

  setTimerWindow(host: Window) {
    if (!client || this.host === host) return;
    this.host?.clearInterval(this.timer);
    this.host = host;
    this.timer = host.setInterval(() => {
      void this.heartbeat();
      if (Date.now() - this.lastProfilePoll >= 8000) void this.refreshProfile().catch(() => {});
    }, POLL_MS);
  }

  private changeUser(user: User | null) {
    if (this.scope.ready && this.scope.user?.id === user?.id) return;
    ++this.sessionChange;
    this.lease = null;
    this.refreshRequest = null;
    this.profileRequest = null;
    this.preferenceVersion = -1;
    this.lastProfilePoll = 0;
    this.mediaLoads = {};
    clearUserMedia();
    engine.setSettingsScope(user ? { ...DEFAULT_SETTINGS } : loadSettings(), !user);
    engine.prog = user ? new Progress(false) : this.guestProgress;
    if (!user) void loadUserMedia();
    if (this.scope.ready || user) {
      engine.setPaused(true);
      engine.switchMetrics(user ? new Metrics(false) : this.guestMetrics, true);
    }
    this.cloudHistory = new Metrics(false);
    this.imported = !!user && ls.get(this.importKey(user.id), false);
    const params = new URLSearchParams(location.search);
    const failed = !user && params.has("error");
    if (failed) window.history.replaceState(null, "", location.pathname + location.hash);
    this.update({
      user, ready: true, locked: false, message: failed ? "No pudimos iniciar sesión con Google." : "",
      revision: this.scope.revision + 1,
      importNoticeDismissed: !!user && ls.get(this.importNoticeKey(user.id), false),
      profileReady: !user, settingsRevision: this.scope.settingsRevision + 1, progressRevision: this.scope.progressRevision + 1,
      appearance: user ? { theme: "auto", widgetSize: "medium" } : guestAppearance(), canImportProfile: false,
    });
    // Supabase entrega el evento dentro de su actualización de sesión.
    if (user) window.setTimeout(() => {
      void this.refreshHistory().catch(() => {});
      void this.refreshProfile().catch(() => {});
    }, 0);
  }

  async signIn() {
    if (!client) return;
    await this.stop();
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }

  async signOut() {
    if (!client) return;
    await this.stop();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
  }

  private hasLease() {
    return !!this.lease && Date.now() < this.lease.deadline && performance.now() < this.lease.monotonicDeadline;
  }

  private async monitor(userId: string, action: MonitorAction, token: string, metrics?: Metrics, progress?: ProgData): Promise<MonitorReply> {
    const { data, error } = await client!.rpc("ps_account_monitor", {
      p_user: userId, p_action: action, p_token: token, p_days: metrics?.realDays() ?? {}, p_progress: progress ?? null,
    }).abortSignal(AbortSignal.timeout(5500));
    if (error) throw error;
    return data as MonitorReply;
  }

  // Usar el inicio de la solicitud deja margen aunque la respuesta tarde en llegar.
  private setDeadline(lease: Lease, started: ReturnType<typeof clock>, remaining: number) {
    lease.deadline = started.wall + remaining - CLOCK_MARGIN_MS;
    lease.monotonicDeadline = started.monotonic + remaining - CLOCK_MARGIN_MS;
  }

  async startMonitoring(move = false, temporary = false) {
    if (!this.scope.ready) return false;
    if (!this.scope.user) return true;
    if (this.hasLease()) {
      if (!temporary && this.lease?.temporary) {
        this.lease.temporary = false;
        engine.switchMetrics(this.lease.metrics);
      }
      return true;
    }
    const userId = this.scope.user.id;
    if (this.starting) return false;
    this.starting = true;
    const generation = this.sessionChange;
    const token = crypto.randomUUID();
    try {
      if (this.lease) await this.stop();
      await this.releasing;
      const waitUntil = Date.now() + 18000;
      let action: MonitorAction = move ? "move" : "claim";
      do {
        if (generation !== this.sessionChange) return false;
        const started = clock();
        const reply = await this.monitor(userId, action, token);
        if (generation !== this.sessionChange) return false;
        if (reply.status === "active") {
          if (reply.profile) this.applyProfile(reply.profile, true);
          const lease = { userId, token, metrics: new Metrics(false), deadline: 0, monotonicDeadline: 0,
            progressStamp: JSON.stringify(engine.prog.snapshot()), temporary };
          this.setDeadline(lease, started, reply.ms);
          this.lease = lease;
          if (!this.hasLease()) { await this.stop(); return false; }
          if (!temporary) engine.switchMetrics(lease.metrics);
          this.update({ locked: false, message: "" });
          return true;
        }
        if (reply.status !== "waiting") {
          this.update({ locked: true, message: "El seguimiento está activo en otro equipo." });
          return false;
        }
        this.update({ locked: false, message: "Esperando a que el otro equipo guarde su sesión…" });
        action = "claim";
        await new Promise<void>((resolve) => window.setTimeout(resolve, 700));
      } while (Date.now() < waitUntil);
      this.update({ locked: true, message: "El otro equipo todavía no ha liberado el seguimiento." });
    } catch {
      if (generation === this.sessionChange) this.update({ message: "No se pudo reservar el seguimiento. Revisa la conexión e inténtalo de nuevo." });
    } finally {
      this.starting = false;
    }
    return false;
  }

  private async heartbeat() {
    const lease = this.lease;
    if (!lease || lease.inFlight) return;
    if (!this.hasLease()) {
      await this.stop("Se pausó el seguimiento al perder la conexión con tu cuenta.");
      return;
    }
    const started = clock();
    lease.inFlight = (async () => {
      try {
        const reply = await this.syncLease(lease, "sync");
        if (this.lease !== lease) return;
        if (reply.status !== "active") {
          // stop() waits for this request. Clear it before releasing the final snapshot.
          lease.inFlight = undefined;
          void this.stop(reply.status === "moving" ? "El seguimiento pasó a otro equipo." : "El seguimiento se pausó. Puedes iniciarlo de nuevo.");
          return;
        }
        this.setDeadline(lease, started, reply.ms);
      } catch { /* El permiso local vence aunque el servidor deje de responder. */ }
    })();
    try { await lease.inFlight; } finally { lease.inFlight = undefined; }
  }

  async stop(message = "") {
    engine.setPaused(true);
    engine.metrics.save();
    const lease = this.lease;
    if (!lease) { await this.releasing; return; }
    this.lease = null;
    if (message) this.update({ message });
    const generation = this.sessionChange;
    this.releasing = (async () => {
      try {
        await lease.inFlight;
        if (generation !== this.sessionChange) return;
        await this.syncLease(lease, "release");
        void this.refreshHistory().catch(() => {});
      } catch { /* El servidor libera el permiso por vencimiento. */ }
    })();
    try { await this.releasing; } finally { this.releasing = null; }
  }

  private async syncLease(lease: Lease, action: "sync" | "release") {
    const snapshot = JSON.stringify(engine.prog.snapshot());
    const progress = snapshot === lease.progressStamp ? undefined : JSON.parse(snapshot) as ProgData;
    const reply = await this.monitor(lease.userId, action, lease.token, lease.metrics, progress);
    lease.progressStamp = snapshot;
    return reply;
  }

  async editProgress<T>(edit: () => T, settle?: () => Promise<void>): Promise<T> {
    if (!this.scope.user) return edit();
    const generation = this.sessionChange;
    if (!await this.startMonitoring(false, true) || generation !== this.sessionChange) {
      engine.toast("No se pudo editar el álbum. Pausa el seguimiento en el otro equipo o revisa tu conexión.", "warn");
      throw new Error("Account progress unavailable");
    }
    const lease = this.lease;
    const release = () => {
      if (lease && this.lease === lease && lease.temporary) return this.stop();
      return Promise.resolve();
    };
    try {
      const result = edit();
      if (settle) void settle().then(release, release);
      else await release();
      return result;
    } catch (error) {
      await release();
      throw error;
    }
  }

  private applyProfile(profile: CloudProfile, loadProgress: boolean) {
    const patch: Partial<Scope> = { profileReady: true };
    if (profile.version > this.preferenceVersion) {
      this.preferenceVersion = profile.version;
      let settings = { ...DEFAULT_SETTINGS };
      for (const field of SYNC_SETTINGS) {
        try { settings = mergeSettings(settings, { [field]: profile.preferences[field] }); } catch { /* Una preferencia antigua puede haber dejado de ser válida. */ }
      }
      engine.setSettingsScope(settings, false);
      const { theme, widgetSize } = profile.preferences;
      patch.appearance = { theme: theme && THEMES.includes(theme) ? theme : "auto", widgetSize: widgetSize && SIZES.includes(widgetSize) ? widgetSize : "medium" };
      patch.settingsRevision = this.scope.settingsRevision + 1;
    }
    if (profile.version === this.preferenceVersion) this.loadPrivateMedia(engine.settings);
    if (loadProgress) {
      const next = new Progress(false, profile.progress);
      if (JSON.stringify(next.snapshot()) !== JSON.stringify(engine.prog.snapshot())) {
        engine.prog = next;
        patch.progressRevision = this.scope.progressRevision + 1;
      }
      const guest = this.guestProgress.d;
      patch.canImportProfile = !profile.progress && !ls.get(this.profileImportKey(), false)
        && (guest.xp > 0 || guest.packs > 0 || Object.keys(guest.album).length > 0 || Object.keys(ls.get("ps.settings", {})).length > 0);
    }
    if (Object.entries(patch).some(([key, value]) => this.scope[key as keyof Scope] !== value)) this.update(patch);
  }

  refreshProfile() {
    const user = this.scope.user;
    if (!client || !user) return Promise.resolve();
    if (this.profileRequest) return this.profileRequest;
    const generation = this.sessionChange;
    this.lastProfilePoll = Date.now();
    const request = (async () => {
      const { data, error } = await client.rpc("ps_profile", { p_user: user.id }).abortSignal(AbortSignal.timeout(8000));
      if (error) throw error;
      if (generation === this.sessionChange) this.applyProfile(data as CloudProfile, !this.lease && !this.starting && !this.releasing);
    })();
    this.profileRequest = request;
    const clear = () => { if (this.profileRequest === request) this.profileRequest = null; };
    void request.then(clear, clear);
    return request;
  }

  private async savePreferences(patch: Preferences) {
    const user = this.scope.user;
    if (!client || !user) throw new Error("Sesión no disponible");
    const generation = this.sessionChange;
    const { data, error } = await client.rpc("ps_preferences", { p_user: user.id, p_patch: patch })
      .abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
    if (generation !== this.sessionChange) throw new Error("La cuenta cambió");
    this.applyProfile(data as CloudProfile, false);
    return engine.settings;
  }

  updateSettings(patch: Partial<Settings>) {
    if (!this.scope.ready) throw new Error("Comprobando la sesión");
    if (!this.scope.user) return engine.updateSettings(patch);
    mergeSettings(engine.settings, patch);
    const shared: Preferences = Object.fromEntries(SYNC_SETTINGS
      .filter((field) => patch[field] != null).map((field) => [field, patch[field]]));
    return Object.keys(shared).length ? this.savePreferences(shared) : engine.settings;
  }

  async updateAppearance<K extends keyof Appearance>(key: K, value: Appearance[K]) {
    if (this.scope.user) {
      await this.savePreferences({ [key]: value });
    } else if (this.scope.ready) {
      ls.set(key === "theme" ? "ps.theme" : "ps.widgetSize", value);
      this.update({ appearance: { ...this.scope.appearance, [key]: value } });
    }
  }

  private mediaPath(userId: string, kind: MediaKind, id: string) { return `${userId}/${kind}/${id}`; }

  private loadPrivateMedia(settings: Settings) {
    const user = this.scope.user;
    if (!client || !user) return;
    const generation = this.sessionChange;
    for (const kind of ["image", "sound"] as const) {
      const id = settings[MEDIA_FIELDS[kind]];
      if (id === this.mediaLoads[kind]) continue;
      this.mediaLoads[kind] = id;
      setMedia(kind);
      if (!id) continue;
      void client.storage.from(MEDIA_BUCKET).download(this.mediaPath(user.id, kind, id)).then(({ data, error }) => {
        if (generation !== this.sessionChange || this.mediaLoads[kind] !== id) return;
        if (!error && data) {
          setMedia(kind, data);
          this.update({ settingsRevision: this.scope.settingsRevision + 1 });
        } else { delete this.mediaLoads[kind]; }
      });
    }
  }

  private async uploadPrivate(kind: MediaKind, file: Blob, userId: string) {
    validateUserFile(kind, file);
    const id = crypto.randomUUID();
    const { error } = await client!.storage.from(MEDIA_BUCKET).upload(this.mediaPath(userId, kind, id), file, { contentType: file.type });
    if (error) throw error;
    return id;
  }

  async uploadFile(kind: MediaKind, file: File) {
    if (!this.scope.ready) throw new Error("Comprobando la sesión");
    const user = this.scope.user;
    if (!user) return engine.saveUserFile(kind, file);
    const generation = this.sessionChange;
    const id = await this.uploadPrivate(kind, file, user.id);
    if (generation !== this.sessionChange) throw new Error("La cuenta cambió");
    return this.savePreferences({ [MEDIA_FIELDS[kind]]: id });
  }

  private profileImportKey() { return `ps.importedProfile.${this.scope.user?.id}`; }

  async importGuestProfile() {
    const user = this.scope.user;
    if (!client || !user || !this.scope.canImportProfile) return;
    const generation = this.sessionChange;
    await this.stop();
    if (generation !== this.sessionChange) return;
    const settings = loadSettings();
    const patch: Preferences = { ...guestAppearance(), ...Object.fromEntries(SYNC_SETTINGS.map((field) => [field, settings[field]])) };
    for (const kind of ["image", "sound"] as const) {
      const field = MEDIA_FIELDS[kind];
      if (!patch[field]) continue;
      const blob = await readGuestMedia(kind);
      patch[field] = blob ? await this.uploadPrivate(kind, blob, user.id) : "";
    }
    if (generation !== this.sessionChange) return;
    const { data, error } = await client.rpc("ps_import_progress", {
      p_user: user.id, p_progress: this.guestProgress.snapshot(), p_preferences: patch,
    })
      .abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
    if (generation !== this.sessionChange) return;
    ls.set(this.profileImportKey(), true);
    this.applyProfile(data as CloudProfile, !this.lease && !this.starting);
    this.update({ canImportProfile: false });
  }

  get history() { return this.scope.user ? this.cloudHistory : this.guestMetrics; }

  refreshHistory() {
    if (!client || !this.scope.user) return Promise.resolve();
    if (this.refreshRequest) return this.refreshRequest;
    const generation = this.sessionChange;
    const request = (async () => {
      const { data, error } = await client.rpc("ps_history", {
        p_since: localDate(7), p_until: localDate(),
      }).abortSignal(AbortSignal.timeout(8000));
      if (error) throw error;
      if (generation !== this.sessionChange) return;
      this.cloudHistory.replaceSyncedDays(data as { day: string; metrics: DayData }[]);
    })();
    this.refreshRequest = request;
    const clear = () => { if (this.refreshRequest === request) this.refreshRequest = null; };
    void request.then(clear, clear);
    return request;
  }

  private importKey(userId: string) { return `ps.importedMetrics.${userId}`; }
  private importNoticeKey(userId: string) { return `ps.dismissedImportNotice.${userId}`; }

  dismissImportNotice() {
    if (!this.scope.user) return;
    ls.set(this.importNoticeKey(this.scope.user.id), true);
    this.update({ importNoticeDismissed: true });
  }

  canImport() {
    return !!this.scope.user && !this.imported
      && Object.keys(this.guestMetrics.realDays()).some((date) => date >= localDate(60) && date <= localDate());
  }

  async importGuest() {
    const user = this.scope.user;
    if (!client || !user || !this.canImport()) return;
    const generation = this.sessionChange;
    const prepareImport = () => {
      const id = ls.get<string>("ps.metricsImportSource", "") || crypto.randomUUID();
      ls.set("ps.metricsImportSource", id);
      if (ls.get<string>("ps.metricsImportSource", "") !== id) throw new Error("Could not preserve import identity");
      return id;
    };
    const source = navigator.locks ? await navigator.locks.request("ps.metricsImportSource", prepareImport) : prepareImport();
    if (generation !== this.sessionChange) return;
    const days = Object.fromEntries(Object.entries(this.guestMetrics.realDays())
      .filter(([date]) => date >= localDate(60) && date <= localDate()));
    const { error } = await client.rpc("ps_import", { p_user: user.id, p_source: source, p_days: days }).abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
    ls.set(this.importKey(user.id), true);
    if (generation !== this.sessionChange) return;
    this.imported = true;
    this.update({ revision: this.scope.revision + 1 });
    await this.refreshHistory();
  }
}

export const account = new Account();
