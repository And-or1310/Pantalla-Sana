## 🚀 Inicio rápido (acabo de clonar el repo)
 
### Requisitos
 
- **Git**, **Node 18 o superior** y **Python 3.10 o superior**.
- Una clave de Gemini, solo si quieres probar la IA. Sin ella todo funciona menos «Mejorar con IA».
### 1. Clonar
 
```powershell
git clone https://github.com/TU_USUARIO/pantalla-sana-web.git
cd pantalla-sana-web
```
 
### 2. Frontend (terminal 1)
 
```powershell
cd frontend
npm install
```
 
Crea `frontend\.env.local` (solo si vas a probar la IA):
 
```powershell
"VITE_PROXY_URL=http://127.0.0.1:8787" | Out-File -Encoding ascii .env.local
```
 
Comprueba que todo está bien y arranca:
 
```powershell
npm test          # debe terminar con "Todo bien ✔"
npm run dev       # abre http://localhost:5173
```
 
Acepta el permiso de cámara. La cámara funciona en `localhost` sin HTTPS.
 
> Si cambias `.env.local`, reinicia `npm run dev`: Vite solo lee las variables al arrancar.
 
### 3. Backend (terminal 2, solo si quieres la IA)
 
```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```
 
Usa el comando de Python que tengas (`python` o `py -3.13`). El entorno virtual evita el desajuste entre `pip` y `python`. Si PowerShell bloquea `Activate.ps1`, ejecuta una vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
 
Crea `backend\.env` (sin comillas ni espacios alrededor del `=`):
 
```
GEMINI_API_KEY=tu_clave
PS_ALLOWED_ORIGINS=http://localhost:5173
```
 
Arranca el servidor:
 
```powershell
python -m uvicorn proxy_server:app --port 8787
```
 
Comprueba en otra terminal:
 
```powershell
Invoke-RestMethod http://127.0.0.1:8787/health     # ok : True
```


# 🌿 Pantalla Sana (versión web)

App web que usa la cámara para cuidar tu postura y tus ojos mientras estudias o trabajas. Detecta si te encorvas, si estás muy cerca de la pantalla, si parpadeas poco, si se te cierran los ojos y si llevas mucho rato sentado. Te avisa con imágenes, sonidos o voz, y te recompensa con XP, niveles, rachas y cartas coleccionables.

**Privacidad:** el video se procesa solo en el navegador (MediaPipe en WASM) y nunca sale de la pestaña. Lo único que puede salir a un servidor propio es un JSON de estadísticas agregadas, y solo si la persona activa «Redactar con IA».

---

## 1. Arquitectura en 30 segundos

```
 Navegador del usuario                                  Internet
┌──────────────────────────────────────────┐
│ frontend (React + Vite + MediaPipe)      │   ──►  APIs públicas de imágenes
│  · cámara → MediaPipe → motor de reglas  │        (gatitos, perritos, NASA, PokéAPI…)
│  · progreso, ajustes y métricas en       │
│    localStorage / IndexedDB              │   ──►  backend (FastAPI en Render)
│                                          │        POST /summarize  → Gemini/Claude
└──────────────────────────────────────────┘        (guarda la API key)
        ▲ Netlify                                          ▲ Render
```

- **No hay servidor para la lógica de la app.** Todo el motor corre en el navegador. Por eso `frontend/src/utilidades/router.ts` imita las rutas de una API (`GET /state`, `PUT /settings`…) pero las resuelve localmente.
- **El backend existe solo para esconder la API key** de la IA. Si el usuario no activa la IA, nunca se usa.
- No hay cuentas ni base de datos: cada persona tiene sus datos en su propio navegador.

---

## 2. Estructura de carpetas

```
pantalla-sana/
├── frontend/                 App web (se despliega en Netlify)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── vistas/           Pantallas completas
│   │   ├── componentes/      Piezas reutilizables
│   │   ├── motor/            Lógica de la app (sin interfaz)
│   │   ├── utilidades/       API local, tipos, sonido
│   │   ├── estilos/          CSS
│   │   └── vite-env.d.ts
│   ├── pruebas/              Pruebas del motor
│   ├── .env.example
│   ├── index.html
│   ├── netlify.toml
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/                  Servicio de IA (se despliega en Render)
│   ├── ai.py
│   ├── proxy_server.py
│   └── requirements.txt
├── documentacion/
│   └── DESPLIEGUE.md
├── render.yaml
├── .gitignore
└── README.md
```

> Los nombres de carpetas están en minúsculas a propósito: Netlify y Render corren en Linux, que distingue mayúsculas de minúsculas.

---

## 3. Qué hace cada archivo

### 3.1 Raíz

| Archivo | Qué hace |
|---|---|
| `README.md` | Este documento. |
| `render.yaml` | «Blueprint» de Render: define el servicio del backend (carpeta `backend`, comando de arranque, health check `/health`, variables de entorno y límites). |
| `.gitignore` | Evita subir `node_modules`, `dist`, `.env*` y `__pycache__`. **Nunca subas claves.** |
| `documentacion/DESPLIEGUE.md` | Guía paso a paso para desplegar en Render y Netlify. |

### 3.2 `frontend/` (configuración)

| Archivo | Qué hace |
|---|---|
| `package.json` | Dependencias y scripts (`dev`, `build`, `test`, `types`). Versiones fijas de React 18.3.1, Vite 5.4.11, TypeScript 5.6.3 y `@mediapipe/tasks-vision` 0.10.14. |
| `package-lock.json` | Versiones exactas instaladas. Se sube a git; no se edita a mano. |
| `vite.config.ts` | Configuración de Vite: plugin de React y puerto 5173 en desarrollo. |
| `tsconfig.json` | TypeScript en modo estricto; incluye `src` y `vite.config.ts`. Marca error por variables o parámetros sin usar. |
| `index.html` | Página única. Carga `src/main.tsx` y define el ícono 🌿. |
| `netlify.toml` | Comando de build (`npm run build`), carpeta publicada (`dist`) y cabeceras de seguridad. La más importante: `Permissions-Policy: camera=(self)` permite la cámara solo a esta página. |
| `.env.example` | Plantilla de variables de entorno. Copia a `.env.local` para desarrollo. |

### 3.3 `frontend/src/` (raíz de la app)

| Archivo | Qué hace |
|---|---|
| `main.tsx` | Punto de entrada. Arranca el motor (`engine.start()`), importa los estilos y monta `<App />`. |
| `App.tsx` | Cabecera con navegación, **enrutado por hash** (`#inicio`, `#semana`, `#album`, `#ajustes`), cola de avisos y notificaciones (toasts), modal de sobres y pie de privacidad. Recibe los eventos del motor (sonidos, alertas, rescates, subidas de nivel) y los convierte en interfaz. |
| `vite-env.d.ts` | Tipo de la variable `VITE_PROXY_URL`. |

### 3.4 `frontend/src/vistas/` (pantallas)

| Archivo | Qué hace |
|---|---|
| `Home.tsx` | Pantalla principal: cámara en vivo, mensaje central (hero) con botón «Empezar/Reajustar», chips de lo que se está cuidando, anillo de puntaje del día, estadísticas y compañero con barra de XP. |
| `Week.tsx` | «Mi semana»: resumen en texto, 4 gráficas de barras en SVG (postura por día, avisos por día, cuándo te encorvas, parpadeos por minuto), botón de datos de ejemplo, tarjeta de IA opcional y panel «qué datos usa este resumen». |
| `Album.tsx` | Colección de cartas ganadas. Al tocar una carta se vuelve tu compañero. Botón para abrir sobres. |
| `SettingsView.tsx` | Ajustes: imagen y sonido del aviso, subir imagen/sonido propios, buscar imágenes en internet, vista de cámara, sensibilidad, grupos de reglas, aviso al celular (ntfy), modo demostración y regalo de sobre. |

### 3.5 `frontend/src/componentes/`

| Archivo | Qué hace |
|---|---|
| `Packs.tsx` | Modal de apertura de sobre: 3 cartas boca abajo que se voltean una por una. |
| `Preview.tsx` | Dibuja la cámara (o solo el contorno) en un `<canvas>`, en espejo, con el esqueleto de pose encima. El video no sale de la pestaña. |

### 3.6 `frontend/src/motor/` (la lógica, sin interfaz)

| Archivo | Qué hace |
|---|---|
| `core.ts` | **Lógica pura**: tabla de reglas (`RULES`), sensibilidades, `Tracker` (suaviza señales, detecta parpadeos y ojos cerrados), `holdStep` (contador con tolerancia), `planAlert` (decide cómo se ve y suena un aviso), `poseRaw` y `earValue` (convierten puntos de MediaPipe en medidas). No toca DOM, red ni cámara. |
| `engine.ts` | **El cerebro.** Clase `Engine`: ciclo de 100 ms, calibración, evaluación de reglas, disparo de avisos, recompensas por corregir, sobres, estado para la interfaz (`snapshot`) y sistema de eventos (`subscribe`/`emit`). Exporta la instancia única `engine`. |
| `vision.ts` | Cámara (`getUserMedia`) y MediaPipe (pose + cara) cargados desde CDN. Produce, ~20 veces por segundo, las medidas crudas y el valor EAR de los ojos. |
| `store.ts` | Ajustes (con validación), progreso (XP, niveles, racha, álbum, sobres) y métricas por día. Todo en `localStorage`. También define `PROXY_URL` y los datos de ejemplo. |
| `sources.ts` | Contenido de los avisos: pide imágenes a APIs públicas, guarda una memoria para usar sin internet, paquetes locales (estiramientos, frases, respira) y envío a ntfy. |
| `media.ts` | «Mi imagen» y «Mi sonido»: guarda los archivos del usuario en IndexedDB (nunca se suben). |
| `summary.ts` | Resumen semanal con reglas locales (`buildSummary`), el JSON que recibiría la IA (`payloadForLlm`) y el cliente del servicio de IA (`pingProxy`, `summarizeViaProxy`). |

### 3.7 `frontend/src/utilidades/`

| Archivo | Qué hace |
|---|---|
| `api.ts` | `api()` (misma firma que un `fetch` a un servidor, pero resuelve dentro del navegador), el hook `useLive()` (estado a ~10 Hz + eventos) y `uploadFile()`. |
| `router.ts` | Tabla de «rutas» (`GET /state`, `POST /calibrate`, `PUT /settings`…) que llaman al motor. Si agregas una acción nueva para la interfaz, va aquí. |
| `sound.ts` | Audio en el navegador: pitido (Web Audio), voz (speechSynthesis) y reproducción de URLs. |
| `types.ts` | Alias cómodos (`LiveState`, `Settings`, `Summary`…) tomados de `api-types.ts`. |
| `api-types.ts` | Tipos TypeScript del contrato de datos. Fue **generado** desde el backend Python original y hoy se mantiene a mano (ver sección 7). |

### 3.8 `frontend/src/estilos/`

| Archivo | Qué hace |
|---|---|
| `styles.css` | Estilos principales con variables CSS (modo oscuro por defecto y claro automático), tarjetas, ajustes, gráficas, sobres y animaciones. Respeta `prefers-reduced-motion`. |
| `web.css` | Ajustes propios de la versión web: el canvas de la cámara y el filtro de las cartas «brillantes». |

### 3.9 `frontend/pruebas/`

| Archivo | Qué hace |
|---|---|
| `engine.test.ts` | Prueba el motor **sin cámara ni internet** con un reloj simulado: ajustes, calibración, 20 s de buena postura sin avisos, encorvarse dispara un aviso, corregir da +10 XP, métricas, resumen y pausa. Se corre con `npm test`. |

### 3.10 `backend/`

| Archivo | Qué hace |
|---|---|
| `proxy_server.py` | Servicio FastAPI con `GET /health` y `POST /summarize`. Valida el JSON, aplica límites por IP y globales, lee la API key del entorno y llama a `ai.py`. Configura CORS solo para los orígenes permitidos. |
| `ai.py` | Solo biblioteca estándar. `validate_payload()` rechaza cualquier cosa que no sea el JSON agregado exacto; llama a Gemini o Claude; `parse_summary()` valida y recorta la respuesta; los errores nunca incluyen la API key. |
| `requirements.txt` | Dependencias de Python: `fastapi` y `uvicorn[standard]`. |

---

## 4. Cómo funciona por dentro

### 4.1 Flujo de datos

```
cámara → vision.ts → poseRaw / earValue → engine.ingest()
                                              │
                                              ▼
                                    Tracker (suaviza, parpadeos)
                                              │
        setInterval 100 ms → engine.step() → evaluate(): aplica RULES
                                              │
                    ┌─────────────────────────┼──────────────────────┐
                    ▼                         ▼                      ▼
              fire() → evento           metrics.record()       prog.good() (XP)
              alert / sound                   │
                    │                         ▼
                    ▼                   localStorage
             App.tsx → toasts, sonido
```

La interfaz lee el estado con `useLive()`, que llama a `engine.snapshot()` cada 100 ms, y recibe los eventos puntuales con `engine.subscribe()`.

### 4.2 Calibración

Al pulsar «Empezar», el motor recoge muestras entre el segundo 1.2 y el 3.7 (`CAL_START`, `CAL_END`). Si hay al menos 15 muestras de cabeza y hombros, guarda la **mediana** como línea base (`baseline`). Las reglas de postura comparan contra esa base, por eso la persona debe estar derecha al calibrar.

### 4.3 Reglas de aviso (`RULES` en `core.ts`)

| Regla | Grupo | Se activa cuando… | Tiempo base | Espera entre avisos |
|---|---|---|---|---|
| `slouch` Espalda | posture | la altura de la cabeza baja respecto a tu base | 6 s | 45 s |
| `close` Distancia | close | la distancia entre orejas crece (estás cerca) | 5 s | 60 s |
| `tilt` Hombros | posture | un hombro está más alto | 8 s | 60 s |
| `roll` Cabeza | posture | la cabeza se ladea | 8 s | 60 s |
| `blink` Parpadeo | blink | parpadeos por minuto bajo el umbral | 5 s | 120 s |
| `sleep` Sueño | sleep | ojos cerrados la mayor parte de los últimos 3 s | 1 s | 30 s |
| `pause` Descanso | pause | minutos seguidos frente a la pantalla | 1 s | 300 s |

- **Sensibilidad** (Tranquilo / Normal / Atento): cada regla tiene tres umbrales (un valor por nivel) y el tiempo se multiplica por `SENS_TIME = [1.5, 1.0, 0.7]`.
- **Tolerancia** (`GRACE = 2 s`): la condición puede fallar hasta 2 s sin reiniciar el contador.
- **Modo demostración:** el tiempo necesario baja a 3 s y la espera a 8 s.

### 4.4 Recompensas (`store.ts`)

- Corregirte dentro de 25 s tras un aviso (`RESCUE_WINDOW`): **+10 XP**, más +5 si la carta es nueva y un bonus por rareza.
- Cada minuto de buena postura: +1 XP.
- Racha: 10 minutos de buena postura en un día suman un día de racha, **+25 XP** y un sobre.
- Cada nivel nuevo regala un sobre. El primer nivel pide 100 XP y cada uno siguiente pide 25 % más.
- Carta repetida: +3 XP.
- Rarezas (probabilidad al corregir): común 70, rara 22, épica 7, brillante 1. En sobres: 50 / 32 / 14 / 4.

### 4.5 Dónde se guardan los datos (solo en el navegador)

| Clave | Contenido |
|---|---|
| `localStorage` → `ps.settings` | Ajustes |
| `localStorage` → `ps.progress` | XP, racha, álbum, sobres, compañero |
| `localStorage` → `ps.metrics` | Números por día (últimos 60 días) |
| `localStorage` → `ps.cache.<paquete>` | Últimas 30 imágenes vistas, para usar sin internet |
| `IndexedDB` → `ps-media` | Imagen y sonido propios |

### 4.6 Servicios externos que usa el navegador

| Servicio | Para qué |
|---|---|
| `cdn.jsdelivr.net` | WASM de MediaPipe |
| `storage.googleapis.com` | Modelos de pose y cara |
| TheCatAPI, Dog CEO, randomfox.ca, Art Institute of Chicago, NASA APOD (`DEMO_KEY`), Dragon Ball API, PokéAPI | Imágenes de los avisos |
| `ntfy.sh` | Aviso al celular (opcional) |
| Tu backend en Render | Resumen con IA (opcional) |

La primera carga baja unos 10 MB de modelos.

---

## 5. El backend

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Devuelve `{"ok": true}`. Sirve para despertar el servicio. |
| POST | `/summarize` | Recibe el JSON agregado y devuelve `{headline, points, tips, goal}`. |

### Variables de entorno (Render)

| Variable | Descripción |
|---|---|
| `GEMINI_API_KEY` | Clave de Gemini (o `ANTHROPIC_API_KEY` si `PS_PROVIDER=claude`). **Se pega en Render, nunca en el repo.** |
| `PS_PROVIDER` | `gemini` (por defecto) o `claude`. |
| `PS_MODEL` | Opcional: sobrescribe el modelo definido en `ai.py`. |
| `PS_ALLOWED_ORIGINS` | URL(s) de tu sitio en Netlify, separadas por coma. Sin esto el navegador bloquea las llamadas (CORS). |
| `PS_IP_PER_HOUR` | Peticiones por IP por hora (12). |
| `PS_GLOBAL_PER_DAY` | Tope diario total (400). |

### Garantías de privacidad que el código hace cumplir

1. `validate_payload()` solo acepta las claves exactas, números dentro de rango y sin texto libre.
2. El JSON no puede pasar de 4096 bytes.
3. La respuesta de la IA se valida y se recorta; si no cumple, el frontend muestra el resumen local.
4. Los mensajes de error nunca incluyen la API key.

### Correr el backend en local

```bash
cd backend
pip install -r requirements.txt
export GEMINI_API_KEY=tu_clave      # en Windows: set GEMINI_API_KEY=tu_clave
uvicorn proxy_server:app --port 8787
```

---

## 6. Correr el proyecto en tu computadora

Requisitos: Node 18 o superior, y Python 3.10 o superior si vas a probar el backend.

```bash
cd frontend
npm install
npm test            # pruebas del motor, sin cámara
npm run dev         # http://localhost:5173
```

Para probar la IA en local, crea `frontend/.env.local`:

```
VITE_PROXY_URL=http://localhost:8787
```

y arranca el backend con `PS_ALLOWED_ORIGINS=http://localhost:5173`.

La cámara solo funciona en `https://` o en `localhost`.

---

## 7. Cómo modificar cosas (recetas)

### Agregar o cambiar una regla de aviso
1. En `motor/core.ts`, agrega o edita el objeto en `RULES` (clave, grupo, entradas, tiempos, textos y condición con 3 umbrales).
2. Si es una regla nueva, agrega su nombre y consejo en `RULE_NAME` y `ALERT_TIPS` de `motor/summary.ts`.
3. **Agrega la clave al conjunto `RULES` de `backend/ai.py`.** Si no, el backend rechazará el resumen con IA en cuanto esa regla aparezca en las estadísticas.
4. Si es un grupo nuevo, añádelo a `GROUP_NAMES` en `vistas/Home.tsx`, a `GROUPS` en `vistas/SettingsView.tsx` y a `groups` de `DEFAULT_SETTINGS` en `motor/store.ts`.
5. Corre `npm test`.

### Cambiar sensibilidad o tiempos
Edita los arreglos `[tranquilo, normal, atento]` dentro de `cond` en `RULES`, o `SENS_TIME` en `core.ts`.

### Agregar un paquete de imágenes
1. `motor/sources.ts`: añade el paquete a `PACKS` (emoji y color) y una función en `PROVIDERS` que devuelva `mk(...)`. Si debe salir en sobres, agrégalo a `ART_PACKS`.
2. `motor/store.ts`: añade el nombre a `ENUMS.img_mode`.
3. `vistas/SettingsView.tsx`: añádelo a la lista `IMG`.
4. `utilidades/api-types.ts`: añade el nombre a los dos enums `img_mode` (en `Settings` y `SettingsPatch`).
5. La API debe permitir CORS desde el navegador y no pedir clave.

### Agregar un ajuste nuevo
1. `motor/store.ts`: agrégalo a `DEFAULT_SETTINGS` (y a `ENUMS` si tiene valores fijos). `mergeSettings` valida el tipo contra el valor por defecto.
2. `utilidades/api-types.ts`: agrégalo a `Settings` y `SettingsPatch`.
3. `vistas/SettingsView.tsx`: agrega el control con `save({ campo: valor })`.
4. Lee el valor en el motor con `this.settings.campo`.

### Agregar una pantalla nueva
1. Crea `vistas/MiVista.tsx`.
2. En `App.tsx`, añádela a `View`, a `VIEWS` y al render condicional.

### Agregar una acción que la interfaz pueda llamar
Añade un `case` en `utilidades/router.ts` y llámala con `api("/ruta", "POST", cuerpo)`.

### Cambiar textos, colores o estilos
- Textos de avisos: `RULES` en `core.ts`.
- Frases y estiramientos: `STRETCHES` y `QUOTES` en `sources.ts`.
- Colores: variables al inicio de `estilos/styles.css`.

### Cambiar el modelo de IA
Cambia `GEMINI_MODEL` o `CLAUDE_MODEL` en `backend/ai.py`, o define `PS_MODEL` en Render sin tocar código.

### Sobre `api-types.ts`
El script `npm run types` genera este archivo desde `../openapi.json`, que pertenecía al backend Python original y **ya no está en este repositorio**. No lo ejecutes; edita `api-types.ts` a mano cuando cambien los tipos y deja que `npm run build` te avise de cualquier incoherencia.

---

## 8. Despliegue y flujo con git

| Servicio | Qué despliega | Configuración |
|---|---|---|
| **Netlify** | `frontend/` | Base directory `frontend`. Variable `VITE_PROXY_URL` = URL de Render, sin `/` final. |
| **Render** | `backend/` | Blueprint `render.yaml` (`rootDir: backend`). Variables `GEMINI_API_KEY` y `PS_ALLOWED_ORIGINS`. |

Rutina de trabajo:

```bash
cd frontend && npm run build && npm test    # comprueba que todo compila y pasa
git add -A
git commit -m "Describe el cambio"
git push
```

Un `git push` puede redesplegar los dos servicios. Para evitar redespliegues innecesarios, usa **Build Filters** en Render (`backend/**`) e **Ignore build** en Netlify.

Guía detallada: [`documentacion/DESPLIEGUE.md`](documentacion/DESPLIEGUE.md).

---

## 9. Limitaciones conocidas

- Si la pestaña queda en segundo plano, el navegador frena el procesamiento y los avisos se retrasan. Lo ideal es una ventana aparte visible.
- Álbum, semana y ajustes viven en el navegador de cada persona: si borra los datos del sitio o cambia de equipo, se pierden.
- El plan gratuito de Render duerme el servicio; la primera petición de IA puede tardar hasta un minuto (el botón «Probar conexión» lo despierta).
- No se permiten claves de IA propias en la web: una clave en el navegador no es segura. Solo se usa el servicio del equipo.
- Los límites de la API de NASA con `DEMO_KEY` son bajos; si fallan, la app usa la memoria de imágenes guardadas o un estiramiento local.

---

## 10. Solución de problemas

| Síntoma | Causa probable |
|---|---|
| «No encuentro tu cámara» | Falta el permiso (candado junto a la dirección) o otra app usa la cámara. |
| La IA falla desde Netlify con error de red | `PS_ALLOWED_ORIGINS` no coincide con tu URL de Netlify, o `VITE_PROXY_URL` está mal o lleva `/` al final. |
| Render responde 422 | El JSON no pasó `validate_payload` (por ejemplo, una regla nueva que falta en `ai.py`). |
| Render responde 429 | Se alcanzó el límite por IP o el tope diario. |
| El build de Render falla | El archivo debe llamarse `requirements.txt` y la carpeta debe coincidir con `rootDir`. |
| La cámara está bloqueada en Netlify | Revisa que `netlify.toml` se llame exactamente así y esté dentro de `frontend/`. |
| `npm run build` marca imports rotos | Tras mover carpetas, corrige las rutas relativas (`../motor/...`, `../utilidades/...`). |
| El avatar o las cartas no cargan | La API de imágenes está caída o sin internet; se usa la memoria guardada. |