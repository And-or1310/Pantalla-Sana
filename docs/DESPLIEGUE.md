# Pantalla Sana web: cómo desplegarla

El usuario final solo abre un enlace y permite la cámara. No instala nada.

    frontend/   app web (React + MediaPipe en el navegador)  -> Netlify
    backend/    servicio de IA (guarda tu API key)           -> Render
    supabase/migrations/  historial, perfil y permisos      -> Supabase
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

## 4) Habilitar cuentas en el sitio publicado

1. Aplica en orden las migraciones de [historial](../supabase/migrations/202611170001_account_history.sql) y [perfil](../supabase/migrations/202611170002_account_profile.sql) en el proyecto Supabase que usará el sitio.
2. Configura el proveedor Google en Supabase. Usa la URL de Netlify como URL de la app y autoriza el regreso a esa URL. En Google Cloud, registra el origen publicado y la URL de callback del proyecto Supabase.
3. Agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` a la configuración del frontend en Netlify y vuelve a desplegar.
4. Prueba el inicio de sesión desde la URL publicada. Verifica el historial y el álbum con dos perfiles de navegador de la misma cuenta, y comprueba que una segunda cuenta ve su propio perfil.

## Limitaciones
- Pestaña en segundo plano: el navegador la frena y los avisos se retrasan. Mejor dejarla en una ventana aparte visible.
- El álbum, el historial y los ajustes del invitado quedan en su navegador. Con una cuenta, Supabase los sincroniza entre equipos.
- La primera carga baja ~10 MB de modelos de MediaPipe (WASM desde jsDelivr, modelos desde Google).
- Gemini y Claude con clave propia ya no existen en la web: una clave en el navegador no es segura. Solo el servicio del equipo.
