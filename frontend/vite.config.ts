import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Versión 100% web: no hay servidor local ni proxy en desarrollo.
// Opcional: VITE_PROXY_URL=https://tu-servicio.onrender.com (servicio de IA del equipo).
export default defineConfig({ plugins: [react()], server: { port: 5173 } });
