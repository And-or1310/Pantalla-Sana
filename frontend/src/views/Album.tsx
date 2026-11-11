import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AlbumItem } from "../lib/types";

const RARITY_NAME = { comun: "Común", rara: "Rara", epica: "Épica", brillante: "Brillante" } as const;

export default function Album({ version, packs, onOpenPack }: { version: number; packs: number; onOpenPack: () => void }) {
  const [items, setItems] = useState<AlbumItem[] | null>(null);
  const load = useCallback(() => { api<AlbumItem[]>("/album").then(setItems).catch(() => setItems([])); }, []);
  useEffect(load, [load, version]);

  const pick = (key: string) => api("/companion", "POST", { key }).then(load).catch(() => {});

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h2>Mi álbum · {items?.length ?? 0} coleccionados</h2>
          <p className="muted">Toca una carta para hacerla tu compañero. El color del borde es su rareza.</p>
        </div>
        <button className={`btn ${packs > 0 ? "primary" : ""}`} onClick={onOpenPack}>🎁 Abrir sobre ({packs})</button>
      </div>
      {items && items.length === 0 && (
        <p className="card empty">Todavía vacío: corrige tu postura cuando te avise y tu primera carta aparecerá aquí. 🥚</p>
      )}
      <ul className="grid">
        {items?.map((it) => (
          <li key={it.key}>
            <button className={`tile rar-${it.rarity} ${it.is_companion ? "mine" : ""}`} onClick={() => pick(it.key)}
              aria-pressed={it.is_companion} aria-label={`${it.title}, ${RARITY_NAME[it.rarity]}${it.is_companion ? ", tu compañero" : ""}`}>
              {it.art_url ? <img src={it.art_url} alt="" loading="lazy" /> : <span>🖼️</span>}
              <b>{it.title}</b>
              <small className="rar-label">{RARITY_NAME[it.rarity]}{it.is_companion ? " · ★ compañero" : ""}</small>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
