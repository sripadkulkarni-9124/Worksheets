import os
import uuid
import time
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from database import init_db
from routes import evaluate, annotate, chat, reattempt, sessions, preprocess, templates

load_dotenv()

# ─── Structured logging ───────────────────────────────────────────────
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
logger = logging.getLogger("ved")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="VED Worksheet Evaluator",
    lifespan=lifespan,
    # Limit request body size at ASGI level (10MB default; override via MAX_BODY_MB env)
)

# CORS origins: comma-separated env var, fallback to common local dev ports
_origins_env = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:8001,http://localhost:3000"
)
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ─── Request body size guard (DoS protection) ──────────────────────────
MAX_BODY_BYTES = int(os.getenv("MAX_BODY_MB", "15")) * 1024 * 1024


@app.middleware("http")
async def body_size_guard(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_BODY_BYTES:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=413,
            content={"detail": f"Payload too large. Max {MAX_BODY_BYTES // (1024*1024)}MB."}
        )
    return await call_next(request)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Attach request ID + timing. Logs every request."""
    req_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.req_id = req_id
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as e:
        dt_ms = (time.perf_counter() - t0) * 1000
        logger.exception(f"[{req_id}] {request.method} {request.url.path} FAILED in {dt_ms:.0f}ms: {e}")
        raise
    dt_ms = (time.perf_counter() - t0) * 1000
    response.headers["x-request-id"] = req_id
    if response.status_code >= 500:
        logger.error(f"[{req_id}] {request.method} {request.url.path} -> {response.status_code} ({dt_ms:.0f}ms)")
    elif response.status_code >= 400:
        logger.warning(f"[{req_id}] {request.method} {request.url.path} -> {response.status_code} ({dt_ms:.0f}ms)")
    else:
        logger.info(f"[{req_id}] {request.method} {request.url.path} -> {response.status_code} ({dt_ms:.0f}ms)")
    return response

app.include_router(evaluate.router, prefix="/api")
app.include_router(annotate.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(reattempt.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(preprocess.router, prefix="/api")
app.include_router(templates.router, prefix="/api")


@app.get("/")
def root():
    return {"status": "VED API running"}
