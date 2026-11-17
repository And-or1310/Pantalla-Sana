import { useEffect, useRef, useState } from "react";
import { engine } from "../core/engine";
import { account } from "../core/account";
import { route } from "./router";
import type { EventMsg, LiveState } from "./types";

/** Misma firma que antes, pero ya no hay servidor: las rutas se resuelven dentro del navegador. */
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  return (await route(path, method, body as Record<string, unknown> | undefined)) as T;
}

/** Estado en vivo (~10 Hz) + eventos puntuales, directamente del motor local. */
export function useLive(onEvent: (e: EventMsg) => void, host: Window = window) {
  const [state, setState] = useState<LiveState | null>(() => engine.snapshot());
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    const off = engine.subscribe((e) => cb.current(e));
    const id = host.setInterval(() => setState(engine.snapshot()), 100);
    return () => { off(); host.clearInterval(id); };
  }, [host]);
  return { state, online: true };
}

export async function uploadFile<T>(kind: "image" | "sound", file: File): Promise<T> {
  return (await account.uploadFile(kind, file)) as T;
}
