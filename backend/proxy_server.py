"""
proxy_server.py - Servicio del EQUIPO para que cualquiera pruebe la IA sin tener su propia API key
=================================================================================================
La clave vive SOLO aquí (variable de entorno), nunca en la app de los usuarios.
Recibe únicamente el JSON de estadísticas agregadas, lo valida de forma estricta (ai.validate_payload)
y devuelve el resumen. Las cuotas guardan hora e identificador derivado del cliente.
La última redacción para los mismos datos y cliente se reutiliza durante diez minutos.

Variables de entorno:
    PS_PROVIDER       gemini (por defecto) o claude
    GEMINI_API_KEY    clave de Gemini      (o ANTHROPIC_API_KEY si usas claude)
    PS_MODEL          opcional: sobreescribe el modelo
    PS_IP_PER_HOUR    peticiones por IP por hora (12 por defecto)
    PS_GLOBAL_PER_DAY tope diario total, para no gastar la cuota (400 por defecto)
    PS_RATE_DB        archivo SQLite de cuotas (por defecto .runtime/quota.sqlite3)
    PS_ALLOWED_ORIGINS orígenes web permitidos (separados por coma), p. ej. https://mi-app.netlify.app
                      Vacío = ningún navegador podrá llamar al servicio (CORS bloqueado).

En LOCAL las variables se leen de backend/.env (no se sube a git). En RENDER no existe ese archivo:
se usan las variables del panel (Environment). Si una variable ya está definida en el sistema,
el .env NO la sobrescribe.

Ejecutar local:   python -m uvicorn proxy_server:app --port 8787
Desplegar:        Render (comando: uvicorn proxy_server:app --host 0.0.0.0 --port $PORT)
NOTA: ai.py debe estar junto a este archivo.
"""
import json
import asyncio
import hashlib
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
from starlette.concurrency import run_in_threadpool

import ai
from rate_limit import RateLimit


def create_proxy(post=ai._post, clock=time.time, rate_path=None):
    app = FastAPI(title="Pantalla Sana - servicio de resumen", docs_url=None, redoc_url=None, openapi_url=None)
    origins = [o.strip() for o in os.environ.get("PS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if origins:                                            # la versión web llama desde el navegador
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST", "GET"], allow_headers=["Content-Type"])
    limits = RateLimit(
        rate_path or os.environ.get("PS_RATE_DB", str(Path(__file__).with_name(".runtime") / "quota.sqlite3")),
        int(os.environ.get("PS_IP_PER_HOUR", 12)), int(os.environ.get("PS_GLOBAL_PER_DAY", 400)),
    )
    minimum_interval = int(os.environ.get("PS_AI_MIN_INTERVAL_SECONDS", "600"))
    if minimum_interval < 0:
        raise ValueError("El intervalo de IA no puede ser negativo")
    in_flight = {}
    generation_lock = asyncio.Lock()

    @app.get("/health")
    def health():
        return {"ok": True}

    async def read_summary_request(request: Request):
        # Uvicorn resuelve las cabeceras de los proxies de confianza.
        ip = request.client.host if request.client else "unknown"
        origin = request.headers.get("origin")
        if origin is not None and origin not in origins:
            raise HTTPException(403, "Origen no permitido")
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            raise HTTPException(415, "Se requiere JSON")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > ai.MAX_PAYLOAD_BYTES:
                raise HTTPException(413, "Demasiado grande")
        try:
            payload = json.loads(raw)
            ai.validate_payload(payload)                   # SOLO números agregados con la forma exacta
        except (ValueError, TypeError):
            raise HTTPException(422, "Datos no válidos")
        provider = os.environ.get("PS_PROVIDER", "gemini")
        key = os.environ.get("ANTHROPIC_API_KEY" if provider == "claude" else "GEMINI_API_KEY", "")
        if not key:
            raise HTTPException(503, "El servicio no está configurado")
        model = os.environ.get("PS_MODEL", "")
        identifier = hashlib.sha256(json.dumps(
            [ip, provider, model, payload], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        return ip, payload, provider, key, model, identifier

    @app.get("/summary/status")
    async def summary_status(request: Request):
        origin = request.headers.get("origin")
        if origin is not None and origin not in origins:
            raise HTTPException(403, "Origen no permitido")
        ip = request.client.host if request.client else "unknown"
        retry_after = await run_in_threadpool(limits.retry_after, ip, clock(), minimum_interval)
        return {"available": retry_after == 0, "retry_after": retry_after}

    @app.post("/summarize")
    async def summarize(request: Request):
        ip, payload, provider, key, model, identifier = await read_summary_request(request)

        async def generate():
            try:
                result = await run_in_threadpool(ai.summarize_with, provider, payload, key, model, post=post)
                await run_in_threadpool(limits.save_summary, identifier, result, clock())
                return result
            except ai.AIError as error:
                raise HTTPException(502, str(error))
            finally:
                in_flight.pop(identifier, None)

        async with generation_lock:
            cached = await run_in_threadpool(limits.cached_report, identifier, clock())
            if cached is not None:
                return cached["summary"]
            task = in_flight.get(identifier)
            if task is None:
                if not await run_in_threadpool(limits.allow, ip, clock(), minimum_interval):
                    retry_after = await run_in_threadpool(limits.retry_after, ip, clock(), minimum_interval)
                    raise HTTPException(429, "Espera antes de generar otra lectura de IA; hay un límite de uso.",
                                        headers={"Retry-After": str(max(1, retry_after))})
                task = asyncio.create_task(generate())
                in_flight[identifier] = task
        return await asyncio.shield(task)

    return app


app = create_proxy()
