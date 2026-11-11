"""
proxy_server.py - Servicio del EQUIPO para que cualquiera pruebe la IA sin tener su propia API key
=================================================================================================
La clave vive SOLO aquí (variable de entorno), nunca en la app de los usuarios.
Recibe únicamente el JSON de estadísticas agregadas, lo valida de forma estricta (ai.validate_payload)
y devuelve el resumen. No guarda nada ni escribe el contenido en logs.

Variables de entorno:
    PS_PROVIDER       gemini (por defecto) o claude
    GEMINI_API_KEY    clave de Gemini      (o ANTHROPIC_API_KEY si usas claude)
    PS_MODEL          opcional: sobreescribe el modelo
    PS_IP_PER_HOUR    peticiones por IP por hora (12 por defecto)
    PS_GLOBAL_PER_DAY tope diario total, para no gastar la cuota (400 por defecto)
    PS_ALLOWED_ORIGINS orígenes web permitidos (separados por coma), p. ej. https://mi-app.netlify.app
                      Vacío = ningún navegador podrá llamar al servicio (CORS bloqueado).

En LOCAL las variables se leen de backend/.env (no se sube a git). En RENDER no existe ese archivo:
se usan las variables del panel (Environment). Si una variable ya está definida en el sistema,
el .env NO la sobrescribe.

Ejecutar local:   python -m uvicorn proxy_server:app --port 8787
Desplegar:        Render (comando: uvicorn proxy_server:app --host 0.0.0.0 --port $PORT)
NOTA: ai.py debe estar junto a este archivo.
"""
import collections
import json
import os
import time
from pathlib import Path

# Debe ir ANTES de create_proxy(), que es quien lee PS_ALLOWED_ORIGINS.
try:
    from dotenv import load_dotenv                     # viene incluido con uvicorn[standard]
    load_dotenv(Path(__file__).with_name(".env"))      # ruta fija: funciona sin importar desde dónde lo ejecutes
except ImportError:
    pass                                               # sin python-dotenv: solo variables del sistema

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

import ai


def create_proxy(post=ai._post, clock=time.time):
    app = FastAPI(title="Pantalla Sana - servicio de resumen", docs_url=None, redoc_url=None, openapi_url=None)
    origins = [o.strip() for o in os.environ.get("PS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if origins:                                            # la versión web llama desde el navegador
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST", "GET"], allow_headers=["Content-Type"])
    hits = collections.defaultdict(collections.deque)      # ip -> marcas de tiempo
    day = collections.deque()                              # tope global

    def limit(ip):
        now = clock()
        per_ip, per_day = int(os.environ.get("PS_IP_PER_HOUR", 12)), int(os.environ.get("PS_GLOBAL_PER_DAY", 400))
        q = hits[ip]
        while q and now - q[0] > 3600:
            q.popleft()
        while day and now - day[0] > 86400:
            day.popleft()
        if len(q) >= per_ip or len(day) >= per_day:
            raise HTTPException(429, "Demasiadas peticiones; intenta más tarde")
        q.append(now)
        day.append(now)

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/summarize")
    async def summarize(request: Request):
        ip = (request.headers.get("x-forwarded-for", "") or (request.client.host if request.client else "?")).split(",")[0].strip()
        raw = await request.body()
        if len(raw) > ai.MAX_PAYLOAD_BYTES:
            raise HTTPException(413, "Demasiado grande")
        try:
            payload = json.loads(raw)
            ai.validate_payload(payload)                   # SOLO números agregados con la forma exacta
        except ValueError:
            raise HTTPException(422, "Datos no válidos")
        limit(ip)
        provider = os.environ.get("PS_PROVIDER", "gemini")
        key = os.environ.get("ANTHROPIC_API_KEY" if provider == "claude" else "GEMINI_API_KEY", "")
        if not key:
            raise HTTPException(503, "El servicio no está configurado")
        try:
            return ai.summarize_with(provider, payload, key, os.environ.get("PS_MODEL", ""), post=post)
        except ai.AIError as e:
            raise HTTPException(502, str(e))

    return app


app = create_proxy()