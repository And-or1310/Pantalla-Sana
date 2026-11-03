import { useEffect, useRef, useState } from "react";
import { engine } from "./local/engine";
import { route } from "./router";
import type { EventMsg, LiveState } from "./types";

export class Unauthorized extends Error {}

/** Misma firma que antes, pero ya no hay servidor: las rutas se resuelven dentro del navegador. */
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  return (await route(path, method, body as Record<string, unknown> | undefined)) as T;
}

/** Estado en vivo (~10 Hz) + eventos puntuales, directamente del motor local. */
export function useLive(onEvent: (e: EventMsg) => void) {
  const [state, setState] = useState<LiveState | null>(() => engine.snapshot());
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    const off = engine.subscribe((e) => cb.current(e));
    const id = window.setInterval(() => setState(engine.snapshot()), 100);
    return () => { off(); window.clearInterval(id); };
  }, []);
  return { state, online: true };
}

/** "Mi imagen" / "Mi sonido": se guarda en este navegador (IndexedDB). */
export async function uploadFile<T>(kind: "image" | "sound", file: File): Promise<T> {
  return (await engine.saveUserFile(kind, file)) as T;
}
