import os, secrets
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from .routes import router
from .history import init_db

ROOT     = Path(__file__).parent.parent
FRONTEND = ROOT / "index.html"
STATIC   = ROOT / "static"

# CORS: restrict to localhost only
_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:8000 http://127.0.0.1:8000 "
    "http://localhost:8001 http://127.0.0.1:8001 "
    "http://localhost:8002 http://127.0.0.1:8002"
).split()

# Request body size limit (early rejection before reading body)
_MAX_REQUEST_BYTES = 600 * 1024 * 1024  # 600 MB (multiple files in one merge)

class _SizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        try:
            if cl and int(cl) > _MAX_REQUEST_BYTES:
                return Response("Request entity too large", status_code=413)
        except ValueError:
            pass  # malformed header - let the body parser handle it
        return await call_next(request)

# Optional shared-token auth (defense-in-depth for non-loopback binds)
# Off by default. When PDF_BINDER_TOKEN is set, every request must present it via
# the `X-Auth-Token` header or a `token` query param.
_AUTH_TOKEN = os.getenv("PDF_BINDER_TOKEN", "").strip()

# The frontend shell must load unauthenticated so it can render the unlock
# overlay; only the API endpoints below the shell are gated. (/auth-check is
# NOT exempt - the frontend relies on its 401 to know a token is needed.)
def _is_public_path(path: str) -> bool:
    return path == "/" or path.startswith("/static/") or path == "/favicon.ico"

class _AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if _AUTH_TOKEN and not _is_public_path(request.url.path):
            supplied = request.headers.get("x-auth-token") or request.query_params.get("token", "")
            if not secrets.compare_digest(supplied, _AUTH_TOKEN):
                # Distinct header lets the frontend tell an app-token failure
                # apart from a PDF-password 401 and show the unlock overlay.
                return Response("Unauthorized", status_code=401,
                                headers={"X-Auth-Token-Required": "1"})
        return await call_next(request)

# App
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="PDF Binder", lifespan=lifespan)
app.add_middleware(_SizeLimitMiddleware)
app.add_middleware(_AuthMiddleware)
# CORS is added last so it stays outermost and can answer preflight OPTIONS
# (which carry no auth token) before the auth check runs.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
app.include_router(router)

@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    return FRONTEND.read_text(encoding="utf-8")

@app.get("/auth-check")
def auth_check():
    # Reaching here means the auth middleware let the request through, so the
    # token is valid (or no token is configured). The frontend probes this.
    return {"ok": True, "auth_required": bool(_AUTH_TOKEN)}
