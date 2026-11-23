import type { Summary } from "../lib/types";
import { ls } from "./store";

export type SavedReport = { summary: Summary; fingerprint: string; createdAt: number };
const reports = new Map<string, SavedReport>();
const inFlight = new Map<string, Promise<Summary>>();
export const REPORT_INTERVAL_MS = 10 * 60 * 1000;
export function retryDeadline(retryAfter: number, now = Date.now()) {
  return retryAfter > 0 ? now + retryAfter * 1000 : 0;
}

/** Caché de lectura en este navegador, separada por cuenta y datos reales o de ejemplo. */
export function getReport(owner: string) {
  const report = reports.get(owner) ?? ls.get<SavedReport | null>(`ps.aiReport.${owner}`, null);
  if (!report || report.summary?.source !== "proxy" || typeof report.fingerprint !== "string"
    || !Number.isFinite(report.createdAt) || Date.now() - report.createdAt > 7 * 86400000
    || typeof report.summary.headline !== "string" || typeof report.summary.goal !== "string"
    || !Array.isArray(report.summary.points) || !report.summary.points.every((point) => typeof point === "string")
    || !Array.isArray(report.summary.tips) || !report.summary.tips.every((tip) => typeof tip === "string")) return null;
  return report;
}
export function saveReport(owner: string, fingerprint: string, summary: Summary, now = Date.now()) {
  const report = { fingerprint, summary, createdAt: now };
  reports.set(owner, report);
  ls.set(`ps.aiReport.${owner}`, report);
  return report;
}
export function reportFingerprint(dates: string[], payload: unknown) {
  return JSON.stringify({ dates, payload }, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
    }
    return value;
  });
}
export function reportCanRefresh(report: SavedReport, fingerprint: string, now: number) {
  return now - report.createdAt >= REPORT_INTERVAL_MS && report.fingerprint !== fingerprint;
}
export async function requestReport(owner: string, fingerprint: string, generate: () => Promise<Summary>, now = Date.now()) {
  const cached = getReport(owner);
  if (cached && !reportCanRefresh(cached, fingerprint, now)) return cached.summary;
  const pending = inFlight.get(owner);
  if (pending) return pending;
  const request = generate().then((summary) => {
    saveReport(owner, fingerprint, summary);
    return summary;
  }).finally(() => { inFlight.delete(owner); });
  inFlight.set(owner, request);
  return request;
}
