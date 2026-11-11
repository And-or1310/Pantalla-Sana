// "Mi imagen" / "Mi sonido": el archivo se guarda en IndexedDB de ESTE navegador (nunca se sube a ningún servidor).
let imageUrl = "";
let soundUrl = "";

const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open("ps-media", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("f");
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const idb = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const rq = fn(db.transaction("f", mode).objectStore("f"));
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
};

export async function loadUserMedia() {
  try {
    for (const kind of ["image", "sound"] as const) {
      const b = await idb<Blob | undefined>("readonly", (s) => s.get(kind));
      if (b) { const u = URL.createObjectURL(b); if (kind === "image") imageUrl = u; else soundUrl = u; }
    }
  } catch { /* sin IndexedDB */ }
}

export async function saveUserFile(kind: "image" | "sound", file: File) {
  await idb("readwrite", (s) => s.put(file, kind));
  const old = kind === "image" ? imageUrl : soundUrl;
  if (old) URL.revokeObjectURL(old);
  const u = URL.createObjectURL(file);
  if (kind === "image") imageUrl = u; else soundUrl = u;
}

export const getUserImageUrl = () => imageUrl;
export const getUserSoundUrl = () => soundUrl;
