// Archivos de invitado en IndexedDB. Los de cuenta se cargan desde su área privada.
export type MediaKind = "image" | "sound";
let imageUrl = "";
let soundUrl = "";
let generation = 0;

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

export function setMedia(kind: MediaKind, blob?: Blob) {
  const old = kind === "image" ? imageUrl : soundUrl;
  if (old) URL.revokeObjectURL(old);
  const next = blob ? URL.createObjectURL(blob) : "";
  if (kind === "image") imageUrl = next;
  else soundUrl = next;
}

export function clearUserMedia() {
  ++generation;
  setMedia("image");
  setMedia("sound");
}

export const readGuestMedia = (kind: MediaKind) => idb<Blob | undefined>("readonly", (s) => s.get(kind));

export async function loadUserMedia() {
  const current = generation;
  try {
    for (const kind of ["image", "sound"] as const) {
      const blob = await readGuestMedia(kind);
      if (current === generation) setMedia(kind, blob);
    }
  } catch { /* sin IndexedDB */ }
}

export async function saveUserFile(kind: MediaKind, file: File) {
  const current = generation;
  await idb("readwrite", (s) => s.put(file, kind));
  if (current === generation) setMedia(kind, file);
}

export const getUserImageUrl = () => imageUrl;
export const getUserSoundUrl = () => soundUrl;
