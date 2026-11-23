import assert from "node:assert/strict";
import { PendingSessions, type PendingSession } from "../src/core/pending";
import { getReport, saveReport, reportFingerprint, reportCanRefresh, requestReport, retryDeadline, REPORT_INTERVAL_MS } from "../src/core/reports";
import type { Summary } from "../src/lib/types";

const memory = new Map<string, string>();
const storage = {
  get length() { return memory.size; },
  key: (index: number) => [...memory.keys()][index] ?? null,
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
} as Storage;
globalThis.localStorage = storage;
const pending = new PendingSessions(storage);
const first = { token: "first", sequence: 1, days: {}, progress: { xp: 10 } } as PendingSession;
pending.save("ana", first);
pending.save("luis", { ...first, token: "second" });
pending.save("ana", { ...first, sequence: 2 });
assert.equal(pending.listUnconfirmed("ana", "first").length, 0);
assert.equal(pending.listUnconfirmed("ana", "first", true).length, 1);
assert.equal(pending.listUnconfirmed("ana", "another-session").length, 1);
pending.remove("ana", "first", 1);
assert.equal(pending.list("ana")[0].sequence, 2);
assert.equal(pending.list("luis")[0].token, "second");
const reloaded = new PendingSessions(storage);
assert.equal(reloaded.list("ana")[0].progress.xp, 10);
reloaded.remove("ana", "first", 2);
assert.equal(pending.list("ana").length, 0);
assert.equal(pending.list("luis").length, 1);
console.log("Recuperación local OK. Recarga, separación de cuentas y confirmaciones fuera de orden.");

const summary: Summary = { source: "proxy", headline: "Tu semana", points: ["Buena postura registrada."], tips: ["Haz una pausa."], goal: "Cuida tu postura." };
const fingerprint = reportFingerprint(["2026-11-22"], { score: 80 });
saveReport("ana:real", fingerprint, summary);
assert.equal(getReport("ana:real")?.summary.headline, "Tu semana");
assert.equal(getReport("luis:real"), null);
assert.equal(getReport("ana:demo"), null);
storage.setItem("ps.aiReport.persisted:real", JSON.stringify({ fingerprint, summary, createdAt: Date.now() }));
assert.equal(getReport("persisted:real")?.summary.headline, "Tu semana");
assert.notEqual(fingerprint, reportFingerprint(["2026-11-23"], { score: 80 }));
assert.notEqual(fingerprint, reportFingerprint(["2026-11-22"], { score: 90 }));
assert.equal(reportFingerprint(["2026-11-22"], { posture: 80, minutes: 10 }),
  reportFingerprint(["2026-11-22"], { minutes: 10, posture: 80 }));
const saved = getReport("ana:real")!;
assert.equal(reportCanRefresh(saved, "new-data", saved.createdAt + 1000), false);
assert.equal(reportCanRefresh(saved, "new-data", saved.createdAt + REPORT_INTERVAL_MS), true);
assert.equal(reportCanRefresh(saved, fingerprint, saved.createdAt + REPORT_INTERVAL_MS), false);
let requests = 0;
const generate = async () => { requests++; return summary; };
await Promise.all([requestReport("report-test", fingerprint, generate), requestReport("report-test", fingerprint, generate)]);
await requestReport("report-test", fingerprint, generate);
assert.equal(requests, 1);
assert.equal(retryDeadline(0, 10000), 0);
assert.equal(retryDeadline(0, 20000), 0);
const deadline = retryDeadline(59, 10000);
assert.equal(Math.max(0, Math.ceil((deadline - 10000) / 1000)), 59);
assert.equal(Math.max(0, Math.ceil((deadline - 69000) / 1000)), 0);
console.log("Resumen de IA OK. Conservación al navegar, separación de cuentas y detección de datos nuevos.");
