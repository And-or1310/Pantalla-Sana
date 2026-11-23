// Sustituye al servidor FastAPI: mismas rutas y mismas formas de respuesta, pero resueltas en el navegador.
import { engine } from "../core/engine";
import { account } from "../core/account";
import { buildSummary, payloadForLlm, pingProxy, summarizeViaProxy, summaryAvailability } from "../core/summary";
import { PROXY_URL } from "../core/store";
import type { Settings } from "../lib/types";
import { getReport, reportFingerprint, requestReport, retryDeadline } from "../core/reports";

type Body = Record<string, unknown> | undefined;

function aiStatus() {
  const s = engine.settings;
  return { provider: s.ai_provider, has_key: false, proxy_url: PROXY_URL, model: "", default_models: {} };
}

function reportOwner(now: number) {
  const owner = account.snapshot().user?.id ?? "guest";
  const demo = account.history.week(now).some((day) => day.demo);
  return `${owner}:${demo ? "demo" : "real"}`;
}

export async function route(path: string, method: string, body: Body): Promise<unknown> {
  const e = engine, now = Date.now() / 1000;
  switch (`${method} ${path}`) {
    case "GET /state": return e.snapshot();
    case "POST /calibrate": return { ok: e.calibrate() };
    case "POST /test-alert": e.testAlert(); return { ok: true };
    case "GET /settings": return e.settings;
    case "PUT /settings": return account.updateSettings((body ?? {}) as Partial<Settings>);
    case "GET /album": return e.album();
    case "POST /companion": return account.editProgress(() => {
      if (!(String(body?.key) in e.prog.d.album)) throw new Error("esa carta no existe");
      e.setCompanion(String(body?.key)); return { ok: true };
    });
    case "POST /packs/open": return account.editProgress(() => ({ started: e.openPack() }), () => e.waitForPack());
    case "POST /packs/gift": return account.editProgress(() => { e.giftPack(); return { packs: e.prog.d.packs }; });
    case "GET /week": {
      const days = account.history.week(now);
      return { days, slots: account.history.slots(now), has_demo: days.some((d) => d.demo) };
    }
    case "GET /summary": return buildSummary(account.history.week(now), account.history.slots(now));
    case "GET /summary/payload": return { sent_anywhere: false, payload: payloadForLlm(account.history.week(now), account.history.slots(now)) };
    case "POST /week/demo": account.history.seedDemo(now); return { ok: true };
    case "DELETE /week/demo": account.history.clearDemo(); return { ok: true };
    case "GET /ai": return aiStatus();
    case "GET /summary/ai": return getReport(reportOwner(now));
    case "GET /ai/availability": {
      if (e.settings.ai_provider !== "proxy") return null;
      if (!e.settings.net) return {
        available: false, retryAt: 0, report: getReport(reportOwner(now)),
        error: "Activa «Buscar imágenes en internet» en Ajustes para conectar con el servicio.",
      };
      const owner = reportOwner(now);
      try {
        const status = await summaryAvailability(PROXY_URL);
        return { available: status.available, retryAt: status.available ? 0 : retryDeadline(status.retry_after), report: getReport(owner), error: "" };
      } catch (error) {
        return { available: false, retryAt: 0, report: getReport(owner), error: (error as Error).message };
      }
    }
    case "POST /ai/ping":
      e.netRequests++;
      try { return { ok: true, ms: await pingProxy(PROXY_URL), error: null }; }
      catch (err) { return { ok: false, ms: null, error: (err as Error).message }; }
    case "POST /summary/ai": {
      const owner = reportOwner(now);
      const s = e.settings, days = account.history.week(now), slots = account.history.slots(now), local = buildSummary(days, slots);
      if (s.ai_provider === "local") return { ...local, note: "La IA está apagada. Actívala arriba; mientras tanto, este es el resumen local." };
      if (!s.net) return { ...local, note: "Tienes desactivado «Buscar imágenes en internet» en Ajustes, así que no salgo a internet." };
      if (days.every((d) => d.posture_pct === null)) return { ...local, note: "Todavía no hay datos que redactar." };
      try {
        const payload = payloadForLlm(days, slots);
        return await requestReport(owner, reportFingerprint(days.map((day) => day.date), payload), async () => {
          e.netRequests++;
          return { ...(await summarizeViaProxy(PROXY_URL, payload)), source: "proxy" as const, note: null };
        });
      } catch (err) {
        const cached = getReport(owner);
        return { ...(cached?.summary ?? local),
          note: `No se pudo generar otra lectura. ${(err as Error).message}` };
      }
    }
    default: throw new Error(`${method} ${path} → no existe`);
  }
}
