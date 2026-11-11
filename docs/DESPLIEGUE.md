# Pantalla Sana web: cómo desplegarla

El usuario final solo abre un enlace y permite la cámara. No instala nada.

    frontend/   app web (React + MediaPipe en el navegador)  -> Netlify
    proxy/      servicio de IA (guarda tu API key)            -> Render
    render.yaml configuración de Render

## Probar en tu laptop
    cd frontend && npm install && npm test && npm run dev      # http://localhost:5173

## 1) Proxy en Render
1. Sube todo a GitHub (sin claves).
2. Render > New > Blueprint > tu repo. Pega `GEMINI_API_KEY` cuando la pida. Deja `PS_ALLOWED_ORIGINS` vacío por ahora.
3. Abre `https://TU-SERVICIO.onrender.com/health`: debe salir `{"ok":true}`.

## 2) Web en Netlify
1. Add new site > Import from Git > tu repo. Base directory: `frontend` (el build y la carpeta `dist` ya vienen en netlify.toml).
2. Site configuration > Environment variables: `VITE_PROXY_URL` = la URL de Render (sin `/` al final). Redespliega.
3. Copia tu URL (`https://algo.netlify.app`).

## 3) Cerrar el círculo
En Render, pon `PS_ALLOWED_ORIGINS` = tu URL de Netlify y redespliega el proxy. Sin esto el navegador bloquea las llamadas a la IA.

## Limitaciones
- Pestaña en segundo plano: el navegador la frena y los avisos se retrasan. Mejor dejarla en una ventana aparte visible.
- Álbum, semana y ajustes quedan en el navegador de cada persona (no hay cuentas).
- La primera carga baja ~10 MB de modelos de MediaPipe (WASM desde jsDelivr, modelos desde Google).
- Gemini y Claude con clave propia ya no existen en la web: una clave en el navegador no es segura. Solo el servicio del equipo.
