## 🚀 Inicio rápido (acabo de clonar el repo)
 
### Requisitos
 
- **Git**, **Node 22 o superior** y **Python 3.11 o superior**.
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

En el recorrido inicial puedes elegir la cámara y calibrar cuando se vean tu cara y tus hombros. Si eliges «Configurar la cámara después», podrás entrar al panel con la cámara apagada y abrir la configuración desde Inicio. Durante el seguimiento, si sales del cuadro se suspenden los avisos y el registro hasta que regreses. El botón «Pausar» libera la cámara.
 
> Si cambias `.env.local`, reinicia `npm run dev`: Vite solo lee las variables al arrancar.

### Cuenta opcional e historial entre dispositivos

Para habilitar «Continuar con Google», agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` a `frontend/.env.local`. Usa la URL del proyecto y la clave publicable. Para probar en local, permite `http://localhost:5173` en la configuración de redirecciones de Supabase y activa Google con la URL de callback de ese proyecto.

En el SQL Editor del proyecto de desarrollo, ejecuta en orden las migraciones de [historial](supabase/migrations/202611170001_account_history.sql), [perfil y archivos privados](supabase/migrations/202611170002_account_profile.sql), [importación de progreso](supabase/migrations/202611170003_guest_progress_merge.sql) y [recuperación de sesiones](supabase/migrations/202611220004_session_recovery.sql). Ejecuta cada migración una vez. Las funciones de la app requieren una sesión de Google y comprueban la identidad de la cuenta. Los secretos del cliente OAuth se configuran en Supabase.

Para verificar la integración, abre la app en dos perfiles de navegador con la misma cuenta de Google. Calibra la cámara en el primer perfil, comprueba que el segundo puede consultar «Mi semana» y, desde el segundo, intenta iniciar el seguimiento y elige «Mover seguimiento a este equipo». Calibra allí y comprueba que el primero se pausa y ambos muestran el mismo historial tras sincronizar. Prueba también con otra cuenta para verificar que su historial es independiente.

En **Ajustes → Cuenta** puedes importar métricas reales de invitado y añadir el álbum, progreso y preferencias de este navegador a una cuenta con o sin progreso previo. El álbum conserva una copia por carta. XP y sobres se suman una sola vez por origen de importación, y las preferencias existentes de la cuenta tienen prioridad. Los archivos elegidos para los avisos se guardan en un área privada de Supabase Storage. La cámara elegida, la calibración y la vista de cámara de Inicio y del widget son locales.

Durante una sesión, cada segundo se guarda una copia de recuperación en este navegador, identificada por cuenta y sesión. Si se pierde la conexión y vence el permiso, la cámara se pausa. Al regresar, se reintenta guardar las métricas con el mismo identificador. El progreso se recupera si su versión sigue vigente. Si otro equipo ya confirmó cambios, se mantiene el progreso remoto y la copia local queda disponible en **Ajustes → Cuenta** para descargarla o descartarla explícitamente. Los cambios posteriores al último guardado local pueden perderse en un cierre abrupto. Borrar los datos del navegador elimina las copias locales.

La copia habitual de la sesión activa no muestra los botones de recuperación. Estos aparecen si falla su sincronización o queda una sesión anterior pendiente. Al pausar, se intenta confirmar y recuperar la última copia automáticamente.

Una calibración válida se conserva durante 30 minutos en el navegador, por cuenta, cámara y resolución. Al abrir la misma cámara, puedes continuar cuando vuelvan a verse cara y hombros. Si cambiaste de posición, usa **Calibrar de nuevo**. El video continúa siendo local. Después de 3 segundos fuera de cuadro durante el seguimiento, se muestra un aviso y suena un pitido si el sonido está habilitado. Con la pestaña oculta se utiliza la notificación del navegador cuando el permiso ya está concedido. Se emite un aviso por ausencia y se habilita otro cuando regresas al cuadro.

Los ajustes se confirman al guardarlos en Supabase. Si la petición falla, la interfaz informa el error para que puedas reintentarlo. La recuperación de sesiones conserva métricas y progreso.

### Resumen local y lectura con IA

El resumen local aplica reglas y calcula la postura ponderada por tiempo. La lectura opcional con IA usa las mismas estadísticas para seleccionar hallazgos y proponer hábitos. FastAPI construye un catálogo de hechos con cifras y unidades explícitas; la IA devuelve sus identificadores y el servidor inserta los textos verificados. Si devuelve identificadores inválidos o cifras fuera de los hechos, se rechaza la respuesta. Las recomendaciones y el título son texto generado.

La última lectura de IA se conserva hasta siete días en este navegador, separada por cuenta y por datos reales o de ejemplo, incluso al recargar. Muestra su fecha de generación y avisa cuando hay datos nuevos y pasó el intervalo para regenerar. La preferencia «Con IA» se mantiene en la cuenta; enviar datos al proveedor requiere pulsar **Mejorar con IA**. En Netlify este flujo usa el servicio de Render configurado en `VITE_PROXY_URL`.

La app permite regenerar después de diez minutos y cuando cambian los datos. El aviso de actualización espera ese mismo intervalo. Las solicitudes simultáneas de una cuenta comparten la misma generación. FastAPI reutiliza durante diez minutos la redacción para el mismo cliente y estadísticas y aplica un intervalo mínimo entre nuevas generaciones por IP, además de las cuotas horaria y diaria. Esto también limita solicitudes hechas fuera de la interfaz. La caché contiene la redacción y un identificador derivado de los datos y del cliente.

La interfaz consulta `GET /summary/status` para deshabilitar el botón durante la espera real del servidor y mostrar los minutos restantes. Esa consulta no envía estadísticas ni llama al proveedor. Un fallo conserva la última lectura disponible y muestra el mensaje hasta la siguiente solicitud o el cambio de modo. El resumen local se recalcula automáticamente cada diez segundos mientras **Mi semana** está abierta y muestra su hora de actualización.

El contador se actualiza cada segundo y muestra segundos durante el último minuto. Cuando el servidor confirma disponibilidad, la espera se elimina. Las respuestas anteriores de disponibilidad se ignoran si ya se inició una consulta más reciente.

Los datos de ejemplo se cargan explícitamente desde **Datos de demostración**, al final de **Mi semana**, y rellenan días sin registros reales. Mientras estén presentes, el resumen y las gráficas se etiquetan como ejemplos o mezcla de datos, y se ofrece **Quitar datos de ejemplo**. Esta acción conserva los días reales. El botón **Mejorar con IA** aparece al seleccionar **Con IA**.
 
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
 
Comprueba en otra terminal(Opcional):
 
```powershell
Invoke-RestMethod http://127.0.0.1:8787/health     # ok : True
```


# 🌿 Pantalla Sana (versión web)

App web que usa la cámara para cuidar tu postura y tus ojos mientras estudias o trabajas. Detecta si te encorvas, si estás muy cerca de la pantalla, si parpadeas poco, si se te cierran los ojos y si llevas mucho rato sentado. Te avisa con imágenes, sonidos o voz, y te recompensa con XP, niveles, rachas y cartas coleccionables.

**Privacidad:** el video se procesa en el navegador (MediaPipe en WASM). Si entras con Google, Supabase sincroniza tu historial y perfil privados, incluidos los archivos de aviso que elijas. Si eliges «Redactar con IA», se envía un resumen numérico al servicio de IA.

---

## 1. Arquitectura en 30 segundos

- **Frontend (React, Vite y MediaPipe).** Procesa la cámara y evalúa las reglas en el navegador. Guarda los datos de invitado localmente y consulta APIs públicas para las imágenes de los avisos. `frontend/src/lib/router.ts` conecta la interfaz con el motor local y el cliente de cuenta.
- **Backend de cuentas (Supabase).** Autentica con Google, aplica permisos por cuenta, guarda el perfil y el historial privados y coordina el seguimiento entre equipos. Las migraciones viven en `supabase/migrations/`.
- **Backend de IA (FastAPI en Render).** Conserva la clave de IA, valida el resumen numérico y lo envía a Gemini o Claude cuando se usa «Redactar con IA».

---

## 2. Estructura de carpetas

```
pantalla-sana/
├── frontend/                 App web (se despliega en Netlify)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── views/           Pantallas completas
│   │   ├── components/      Piezas reutilizables
│   │   ├── core/            Lógica de la app (sin interfaz)
│   │   ├── lib/       API local, tipos, sonido
│   │   ├── styles/          CSS
│   │   └── vite-env.d.ts
│   ├── tests/              Pruebas del motor
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
├── supabase/
│   └── migrations/          Esquema, permisos y funciones del backend de cuentas
├── docs/
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
| `docs/DESPLIEGUE.md` | Guía paso a paso para desplegar en Render y Netlify. |

### 3.2 `frontend/` (configuración)

| Archivo | Qué hace |
|---|---|
| `package.json` | Dependencias y scripts (`dev`, `build`, `test`, `test:db`, `types`). React 18.3.1, Vite 6.4.6, TypeScript 5.6.3 y `@mediapipe/tasks-vision` 0.10.14. |
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

### 3.4 `frontend/src/views/` (pantallas)

| Archivo | Qué hace |
|---|---|
| `Home.tsx` | Pantalla principal: cámara en vivo, mensaje central (hero) con botón «Empezar/Reajustar», chips de lo que se está cuidando, anillo de puntaje del día, estadísticas y compañero con barra de XP. |
| `Week.tsx` | «Mi semana»: resumen en texto, 4 gráficas de barras en SVG (postura por día, avisos por día, cuándo te encorvas, parpadeos por minuto), botón de datos de ejemplo, tarjeta de IA opcional y panel «qué datos usa este resumen». |
| `Album.tsx` | Colección de cartas ganadas. Al tocar una carta se vuelve tu compañero. Botón para abrir sobres. |
| `SettingsView.tsx` | Ajustes: imagen y sonido del aviso, subir imagen/sonido propios, buscar imágenes en internet, vista de cámara, sensibilidad, grupos de reglas, aviso al celular (ntfy), modo demostración y regalo de sobre. |

### 3.5 `frontend/src/components/`

| Archivo | Qué hace |
|---|---|
| `Packs.tsx` | Modal de apertura de sobre: 3 cartas boca abajo que se voltean una por una. |
| `Preview.tsx` | Dibuja la cámara (o solo el contorno) en un `<canvas>`, en espejo, con el esqueleto de pose encima. El video no sale de la pestaña. |

### 3.6 `frontend/src/core/` (la lógica, sin interfaz)

| Archivo | Qué hace |
|---|---|
| `core.ts` | **Lógica pura**: tabla de reglas (`RULES`), sensibilidades, `Tracker` (suaviza señales, detecta parpadeos y ojos cerrados), `holdStep` (contador con tolerancia), `planAlert` (decide cómo se ve y suena un aviso), `poseRaw` y `earValue` (convierten puntos de MediaPipe en medidas). No toca DOM, red ni cámara. |
| `engine.ts` | **El cerebro.** Clase `Engine`: ciclo de 100 ms, calibración, evaluación de reglas, disparo de avisos, recompensas por corregir, sobres, estado para la interfaz (`snapshot`) y sistema de eventos (`subscribe`/`emit`). Exporta la instancia única `engine`. |
| `vision.ts` | Cámara (`getUserMedia`) y MediaPipe (pose + cara) cargados desde CDN. Produce, ~20 veces por segundo, las medidas crudas y el valor EAR de los ojos. |
| `store.ts` | Ajustes (con validación), progreso y métricas por día. También define `PROXY_URL` y los datos de ejemplo. |
| `account.ts` | Sesión de Google, sincronización opcional de métricas con Supabase y coordinación de un seguimiento activo por cuenta. |
| `sources.ts` | Contenido de los avisos: pide imágenes a APIs públicas, guarda una memoria para usar sin internet, paquetes locales (estiramientos, frases, respira) y envío a ntfy. |
| `media.ts` | «Mi imagen» y «Mi sonido»: IndexedDB para invitados y carga local de los archivos privados de la cuenta. |
| `summary.ts` | Resumen semanal con reglas locales (`buildSummary`), el JSON que recibiría la IA (`payloadForLlm`) y el cliente del servicio de IA (`pingProxy`, `summarizeViaProxy`). |

### 3.7 `frontend/src/lib/`

| Archivo | Qué hace |
|---|---|
| `api.ts` | `api()` (misma firma que un `fetch` a un servidor, pero resuelve dentro del navegador), el hook `useLive()` (estado a ~10 Hz + eventos) y `uploadFile()`. |
| `router.ts` | Tabla de «rutas» (`GET /state`, `POST /calibrate`, `PUT /settings`…) que llaman al motor. Si agregas una acción nueva para la interfaz, va aquí. |
| `sound.ts` | Audio en el navegador: pitido (Web Audio), voz (speechSynthesis) y reproducción de URLs. |
| `types.ts` | Alias cómodos (`LiveState`, `Settings`, `Summary`…) tomados de `api-types.ts`. |
| `api-types.ts` | Tipos TypeScript del contrato de datos. Fue **generado** desde el backend Python original y hoy se mantiene a mano (ver sección 7). |

### 3.8 `frontend/src/styles/`

| Archivo | Qué hace |
|---|---|
| `styles.css` | Estilos principales con variables CSS (modo oscuro por defecto y claro automático), tarjetas, ajustes, gráficas, sobres y animaciones. Respeta `prefers-reduced-motion`. |
| `web.css` | Ajustes propios de la versión web: el canvas de la cámara y el filtro de las cartas «brillantes». |

### 3.9 `frontend/tests/`

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

### 4.5 Dónde se guardan los datos

| Clave | Contenido |
|---|---|
| `localStorage` → `ps.settings` | Ajustes |
| `localStorage` → `ps.progress` | XP, racha, álbum, sobres, compañero |
| `localStorage` → `ps.metrics` | Métricas de invitado por día (últimos 60 días) |
| Supabase | Métricas, álbum, progreso, preferencias y archivos de aviso privados de la cuenta |
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

## 5. El backend de IA (FastAPI)

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
| `PS_AI_MIN_INTERVAL_SECONDS` | Intervalo entre nuevas generaciones por IP (600 segundos). Las respuestas reutilizadas no consumen una generación. |
| `PS_RATE_DB` | Ruta del archivo SQLite de cuotas. Conserva las cuotas mientras se conserve ese archivo. |
| `FORWARDED_ALLOW_IPS` | Lista de proxies de confianza que Uvicorn puede usar para resolver la IP. Configúrala según la red del despliegue. |

El backend lee el cliente resuelto por Uvicorn y no interpreta directamente `X-Forwarded-For`. Las cuotas se actualizan en una transacción SQLite y sobreviven al reinicio del proceso con el mismo archivo. El almacenamiento del plan gratuito de Render es efímero, por lo que las cuotas pueden reiniciarse al reemplazar la instancia. Para conservarlas entre reemplazos se necesita almacenamiento persistente y `PS_RATE_DB` apuntando a él. Los límites del proyecto del proveedor de IA complementan estas cuotas.

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

Requisitos: Node 22 o superior, y Python 3.11 o superior si vas a probar el backend.

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

### Comprobaciones automáticas

Desde `frontend`, instala con `npm ci` y ejecuta `npm test`, `npm run test:db` y `npm run build`. Las pruebas de base de datos aplican todas las migraciones en PostgreSQL embebido (PGlite), con contratos locales para Auth y Storage. Verifican permisos, importaciones, traspaso, recuperación de sesiones y reintentos sin duplicados.

Desde `backend`, instala `python -m pip install -r requirements-dev.txt` y ejecuta `python -m unittest discover -s tests -v`. Las peticiones al proveedor de IA se simulan en estas pruebas. El servicio publicado utiliza su clave real del entorno.

`.github/workflows/verify.yml` ejecuta las comprobaciones en cada push a `main`, `mejoras` o `codex/**`, y en pull requests hacia `main`. El backend se prueba con Python 3.11 y 3.12. Los trabajos usan entornos nuevos y no requieren las claves del proyecto. Para exigir pruebas aprobadas antes de integrar, configura la protección de `main` en GitHub. Render permite seleccionar **After CI Checks Pass** en su configuración de despliegue automático.

El entorno `backend/.venv` se crea en cada computadora con `python -m venv .venv`. Git ignora el directorio. Al actualizar una copia que antes lo tenía versionado, Git puede intentar retirar sus archivos anteriores, por lo que conviene recrear el entorno siguiendo Inicio rápido si dejó de funcionar.

### Cambios relevantes para el documento técnico, noviembre de 2026

- Se agregó recuperación de métricas y progreso con copias locales por cuenta y sesión, control de versiones en PostgreSQL y revisión explícita cuando otro equipo ya guardó cambios.
- Se agregaron pruebas automáticas de base de datos y FastAPI y un flujo de integración continua en GitHub Actions.
- Se reemplazaron las cuotas en memoria del servicio de IA por transacciones SQLite y se limitaron los cuerpos recibidos durante su lectura. Las llamadas externas se ejecutan fuera del bucle asíncrono.
- El resumen semanal pondera la postura por tiempo analizado, muestra la cobertura y relaciona sugerencias con observaciones. Los días sin muestras quedan identificados.
- Se retiró el entorno virtual del control de versiones y se documentó la instalación desde cero.
- Se actualizaron Vite a 6.4.6 y tsx a 4.23.15 para resolver los avisos detectados por npm. FastAPI y Uvicorn tienen versiones directas fijadas en requirements.txt.

---

## 7. Cómo modificar cosas (recetas)

### Agregar o cambiar una regla de aviso
1. En `core/core.ts`, agrega o edita el objeto en `RULES` (clave, grupo, entradas, tiempos, textos y condición con 3 umbrales).
2. Si es una regla nueva, agrega su nombre y consejo en `RULE_NAME` y `ALERT_TIPS` de `core/summary.ts`.
3. **Agrega la clave al conjunto `RULES` de `backend/ai.py`.** Si no, el backend rechazará el resumen con IA en cuanto esa regla aparezca en las estadísticas.
4. Si es un grupo nuevo, añádelo a `GROUP_NAMES` en `views/Home.tsx`, a `GROUPS` en `views/SettingsView.tsx` y a `groups` de `DEFAULT_SETTINGS` en `core/store.ts`.
5. Corre `npm test`.

### Cambiar sensibilidad o tiempos
Edita los arreglos `[tranquilo, normal, atento]` dentro de `cond` en `RULES`, o `SENS_TIME` en `core.ts`.

### Agregar un paquete de imágenes
1. `core/sources.ts`: añade el paquete a `PACKS` (emoji y color) y una función en `PROVIDERS` que devuelva `mk(...)`. Si debe salir en sobres, agrégalo a `ART_PACKS`.
2. `core/store.ts`: añade el nombre a `ENUMS.img_mode`.
3. `views/SettingsView.tsx`: añádelo a la lista `IMG`.
4. `lib/api-types.ts`: añade el nombre a los dos enums `img_mode` (en `Settings` y `SettingsPatch`).
5. La API debe permitir CORS desde el navegador y no pedir clave.

### Agregar un ajuste nuevo
1. `core/store.ts`: agrégalo a `DEFAULT_SETTINGS` (y a `ENUMS` si tiene valores fijos). `mergeSettings` valida el tipo contra el valor por defecto.
2. `lib/api-types.ts`: agrégalo a `Settings` y `SettingsPatch`.
3. `views/SettingsView.tsx`: agrega el control con `save({ campo: valor })`.
4. Lee el valor en el motor con `this.settings.campo`.

### Agregar una pantalla nueva
1. Crea `views/MiVista.tsx`.
2. En `App.tsx`, añádela a `View`, a `VIEWS` y al render condicional.

### Agregar una acción que la interfaz pueda llamar
Añade un `case` en `lib/router.ts` y llámala con `api("/ruta", "POST", cuerpo)`.

### Cambiar textos, colores o estilos
- Textos de avisos: `RULES` en `core.ts`.
- Frases y estiramientos: `STRETCHES` y `QUOTES` en `sources.ts`.
- Colores: variables al inicio de `styles/styles.css`.

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

Guía detallada: [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

---

## 9. Limitaciones conocidas

- Si la pestaña queda en segundo plano, el navegador frena el procesamiento y los avisos se retrasan. Lo ideal es una ventana aparte visible.
- En modo invitado, el álbum, el historial y los ajustes se guardan en ese navegador y se pierden si se borran los datos del sitio. Con una cuenta, Supabase sincroniza los datos confirmados y conserva copias locales de las sesiones pendientes para su recuperación. Un cierre abrupto puede perder la última fracción de segundo todavía no guardada.
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
| `npm run build` marca imports rotos | Tras mover carpetas, corrige las rutas relativas (`../core/...`, `../lib/...`). |
| El avatar o las cartas no cargan | La API de imágenes está caída o sin internet; se usa la memoria guardada. |
