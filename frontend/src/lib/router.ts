// Sustituye al servidor FastAPI: mismas rutas y mismas formas de respuesta, pero resueltas en el navegador.
import { engine } from "../core/engine";
import { buildSummary, payloadForLlm, pingProxy, summarizeViaProxy } from "../core/summary";
import { PROXY_URL } from "../core/store";
import type { Settings } from "../lib/types";

type Body = Record<string, unknown> | undefined;

function aiStatus() {
  const s = engine.settings;
  return { provider: s.ai_provider, has_key: false, proxy_url: PROXY_URL, model: "", default_models: {} };
}

export async function route(path: string, method: string, body: Body): Promise<unknown> {
  const e = engine, now = Date.now() / 1000;
  switch (`${method} ${path}`) {
    case "GET /state": return e.snapshot();
    case "POST /calibrate": e.calibrate(); return { ok: true };
    case "POST /pause": e.setPaused(typeof body?.paused === "boolean" ? body.paused : !e.paused); return { paused: e.paused };
    case "POST /test-alert": e.testAlert(); return { ok: true };
    case "GET /settings": return e.settings;
    case "PUT /settings": return e.updateSettings((body ?? {}) as Partial<Settings>);
    case "GET /album": return e.album();
    case "POST /companion":
      if (!(String(body?.key) in e.prog.d.album)) throw new Error("esa carta no existe");
      e.setCompanion(String(body?.key)); return { ok: true };
    case "POST /packs/open": return { started: e.openPack() };
    case "POST /packs/gift": e.giftPack(); return { packs: e.prog.d.packs };
    case "GET /week": {
      const days = e.metrics.week(now);
      return { days, slots: e.metrics.slots(now), has_demo: days.some((d) => d.demo) };
    }
    case "GET /summary": return buildSummary(e.metrics.week(now), e.metrics.slots(now));
    case "GET /summary/payload": return { sent_anywhere: false, payload: payloadForLlm(e.metrics.week(now), e.metrics.slots(now)) };
    case "POST /week/demo": e.metrics.seedDemo(now); return { ok: true };
    case "DELETE /week/demo": e.metrics.clearDemo(); return { ok: true };
    case "GET /ai": return aiStatus();
    case "POST /ai/ping":
      e.netRequests++;
      try { return { ok: true, ms: await pingProxy(PROXY_URL), error: null }; }
      catch (err) { return { ok: false, ms: null, error: (err as Error).message }; }
    case "POST /summary/ai": {
      const s = e.settings, days = e.metrics.week(now), slots = e.metrics.slots(now), local = buildSummary(days, slots);
      if (s.ai_provider === "local") return { ...local, note: "La IA está apagada. Actívala arriba; mientras tanto, este es el resumen local." };
      if (!s.net) return { ...local, note: "Tienes desactivado «Buscar imágenes en internet» en Ajustes, así que no salgo a internet." };
      if (days.every((d) => d.posture_pct === null)) return { ...local, note: "Todavía no hay datos que redactar." };
      try {
        e.netRequests++;
        return { ...(await summarizeViaProxy(PROXY_URL, payloadForLlm(days, slots))), source: "proxy", note: null };
      } catch (err) { return { ...local, note: `No pude usar la IA (${(err as Error).message}). Te muestro el resumen local.` }; }
    }
    default: throw new Error(`${method} ${path} → no existe`);
  }
}
