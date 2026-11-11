import { useEffect, useRef } from "react";
import { engine } from "../core/engine";
import type { Preview } from "../lib/types";

/** Dibuja la cámara (o solo el contorno) en un canvas local. El video nunca sale de la pestaña. */
export default function CameraPreview({ mode }: { mode: Preview }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const cv = ref.current, v = engine.vision.video;
      if (cv && v && v.videoWidth) {
        if (cv.width !== v.videoWidth) { cv.width = v.videoWidth; cv.height = v.videoHeight; }
        const ctx = cv.getContext("2d")!, w = cv.width, h = cv.height;
        ctx.save();
        ctx.translate(w, 0); ctx.scale(-1, 1);                // espejo, como un espejo de verdad
        if (mode === "Mostrar") ctx.drawImage(v, 0, 0, w, h);
        else { ctx.fillStyle = "#1f2d44"; ctx.fillRect(0, 0, w, h); }
        const lm = engine.vision.lastPose;
        if (lm) {
          ctx.strokeStyle = "#6ee7b7"; ctx.lineWidth = 3; ctx.fillStyle = "#fbbf24";
          for (const { start, end } of engine.vision.connections) {
            const a = lm[start], b = lm[end];
            if (!a || !b || (a.visibility ?? 0) < 0.5 || (b.visibility ?? 0) < 0.5) continue;
            ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
          }
          for (const p of lm) if ((p.visibility ?? 0) >= 0.5) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 4, 0, 6.3); ctx.fill(); }
        }
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode]);
  return <canvas ref={ref} role="img" aria-label="Vista previa de tu cámara (se procesa solo en tu navegador)" />;
}
