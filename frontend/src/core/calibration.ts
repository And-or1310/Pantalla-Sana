import { KEYS, type Baseline } from "./core";

const MAX_AGE_SECONDS = 30 * 60;
type SavedCalibration = { at: number; baseline: Baseline; ear: number[] };

export function readCalibration(value: unknown, now: number): SavedCalibration | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as SavedCalibration;
  if (!Number.isFinite(saved.at) || now < saved.at || now - saved.at > MAX_AGE_SECONDS) return null;
  if (!saved.baseline || !KEYS.every((key) => saved.baseline[key] === null || Number.isFinite(saved.baseline[key]))) return null;
  if (!(saved.baseline.hd! > 0) || saved.baseline.tl === null || saved.baseline.tl < 0) return null;
  if (!Array.isArray(saved.ear) || saved.ear.length < 15 || !saved.ear.every((item) => Number.isFinite(item) && item > 0)) return null;
  return saved;
}
