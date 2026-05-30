import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from .routes import router

ROOT     = Path(__file__).parent.parent
FRONTEND = ROOT / "index.html"
STATIC   = ROOT / "static"

# ── CORS: restrict to localhost only ─────────────────────────────────────────
_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:8000 http://127.0.0.1:8000 "
    "http://localhost:8001 http://127.0.0.1:8001 "
    "http://localhost:8002 http://127.0.0.1:8002"
).split()

# ── Request body size limit (early rejection before reading body) ─────────────
_MAX_REQUEST_BYTES = 600 * 1024 * 1024  # 600 MB (multiple files in one merge)

class _SizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and int(cl) > _MAX_REQUEST_BYTES:
            return Response("Request entity too large", status_code=413)
        return await call_next(request)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="PDF Binder")
app.add_middleware(_SizeLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
app.include_router(router)

@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    return FRONTEND.read_text(encoding="utf-8")
