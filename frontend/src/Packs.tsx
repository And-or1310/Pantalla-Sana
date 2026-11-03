import { useEffect, useState } from "react";
import type { PackOpened } from "./types";

const RARITY_NAME = { comun: "Común", rara: "Rara", epica: "Épica", brillante: "Brillante" } as const;

/** Sobre de recompensa: 3 cartas boca abajo que se voltean una por una cuando llega el resultado. */
export default function Packs({ result, onClose }: { result: PackOpened | null; onClose: () => void }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (!result) return;
    const ids = result.cards.map((_, i) => window.setTimeout(() => setShown(i + 1), 500 + i * 900));
    return () => ids.forEach(window.clearTimeout);
  }, [result]);

  const done = result !== null && shown >= result.cards.length;
  const newCount = result?.cards.filter((c) => c.is_new).length ?? 0;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Sobre de recompensa">
      <div className="card modal-box">
        <h2>🎁 Tu sobre de recompensa</h2>
        <p className="muted" aria-live="polite">
          {!result ? "Abriendo tu sobre…" : !result.ok ? "No pude conseguir imágenes (¿sin internet?). Tu sobre no se gastó."
            : done ? `¡Listo! ${newCount} carta(s) nueva(s) en tu álbum.` : "Mira lo que salió…"}
        </p>
        <div className="pack-row">
          {[0, 1, 2].map((i) => {
            const c = result?.cards[i];
            const up = !!c && shown > i;
            return (
              <div key={i} className={`flipper ${up ? "up" : ""}`}>
                <div className="face back"><span>?</span></div>
                <div className={`face front rar-${c?.rarity ?? "comun"}`}>
                  {c?.art_url ? <img src={c.art_url} alt="" /> : <span>🖼️</span>}
                  <b>{c?.title}</b>
                  <small className="rar-label">{c ? RARITY_NAME[c.rarity].toUpperCase() : ""}</small>
                  <em>{c?.is_new ? "¡NUEVA!" : "Repetida · +3 XP"}</em>
                </div>
              </div>
            );
          })}
        </div>
        <button className="btn primary" onClick={onClose} disabled={!!result && result.ok && !done}>Cerrar</button>
      </div>
    </div>
  );
}
